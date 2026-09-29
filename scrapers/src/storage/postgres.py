import os
import asyncio
import asyncpg
from asyncpg.exceptions import UniqueViolationError
from datetime import datetime, timezone
from loguru import logger
from src.models.zvg import ZvgListing
from src.utils.analysis_version import with_schema_version
from src.utils.ki_tiers import interpret_full_claim
from src.utils.data_quality import VERKEHRSWERT_UPSERT_PLAUSIBLE_RANGE
from src.utils.geocoding import parse_usable_geo_point
from src.utils.zvg_identity import normalize_amtsgericht, orts_compatible
from typing import Callable, Optional
from uuid import uuid4
import re

ZVG_BUNDESLAND_SLUG_UNIQUE = "zvg_listings_bundesland_slug_unique"

# Wie viel sich der Verkehrswert zwischen zwei Scrapes maximal ändern darf,
# bevor ein Update als unplausibler Sprung (statt einer echten
# Wertänderung, z.B. nach einem Wiederholungstermin) behandelt und NICHT
# übernommen wird. Bewusst kein COALESCE (siehe upsert_zvg_listing) - eine
# echte Reduktion um z.B. 30-50% nach einem Wiederholungstermin bleibt
# erlaubt, ein Faktor-10-Sprung in eine Richtung ist dagegen bei einem
# bereits plausiblen Altwert praktisch immer ein Parser-/Kollisionsfehler.
_VERKEHRSWERT_JUMP_FACTOR = 10


def _enqueue_ki_analysis(listing_id: str) -> None:
    """No-op: historische Redis-Liste `ki_analysis_queue` hat keinen Consumer.
    KI läuft über Prefect/DB-Poll (`ki_analysis.py`), nicht über Redis."""
    logger.debug(f"KI-Queue (deprecated/noop): {listing_id}")


def _slugify(text: str) -> str:
    text = text.lower()
    for old, new in [("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")]:
        text = text.replace(old, new)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def unique_slug_candidate(
    base: str,
    is_taken: Callable[[str], bool],
    *,
    max_n: int = 40,
) -> str:
    slug = (base or "objekt").strip("-") or "objekt"
    if not is_taken(slug):
        return slug
    for n in range(2, max_n + 2):
        candidate = f"{slug}-{n}"
        if not is_taken(candidate):
            return candidate
    return f"{slug}-{uuid4().hex[:8]}"


def is_slug_unique_violation(exc: BaseException) -> bool:
    constraint = getattr(exc, "constraint_name", None) or ""
    return ZVG_BUNDESLAND_SLUG_UNIQUE in constraint or ZVG_BUNDESLAND_SLUG_UNIQUE in str(exc)


# Vorher öffnete jede Funktion in
# diesem Modul per asyncpg.connect() eine eigene, kurzlebige Verbindung statt
# einen Pool wiederzuverwenden. Aktuell entschärft (Pipeline läuft
# sequenziell), aber strukturell fragil, sobald z.B. die KI-Analyse künftig
# parallelisiert wird. _pool wird lazy + einmalig pro Prozess angelegt (ein
# Lock verhindert doppelte Pool-Erstellung bei gleichzeitigem ersten Zugriff
# aus mehreren Tasks). get_connection()/release_connection() behalten
# bewusst dieselbe Signatur wie vorher (conn = await get_connection() ...
# finally: await conn.close() -> finally: await release_connection(conn)),
# damit alle bestehenden Aufrufstellen unten nur minimal angepasst werden
# müssen und ihre try/finally-Struktur unverändert bleibt.
_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        async with _pool_lock:
            if _pool is None:  # doppelt geprüft: erste Task nach Lock-Erwerb gewinnt
                _pool = await asyncpg.create_pool(
                    os.environ["DATABASE_URL"],
                    min_size=2,
                    max_size=10,
                )
                logger.info("asyncpg-Connection-Pool erstellt (min=2, max=10)")
    return _pool


async def get_connection() -> asyncpg.pool.PoolConnectionProxy:
    """Leiht eine Verbindung aus dem Pool aus (statt eine neue zu öffnen)."""
    pool = await get_pool()
    return await pool.acquire()


async def release_connection(conn: asyncpg.pool.PoolConnectionProxy) -> None:
    """Gibt eine geliehene Verbindung an den Pool zurück (statt sie zu schließen)."""
    if _pool is not None:
        await _pool.release(conn)


async def _adopt_legacy_row(conn, listing: ZvgListing, amtsgericht: str) -> None:
    """Trägt das Amtsgericht in eine Altzeile nach, die noch keines hat.

    Migration 0020 hat 54 Aktenzeichen dokumentiert, die im selben Land an
    mehr als einem Gericht vorkommen. Ein blindes UPDATE auf
    (aktenzeichen, source, bundesland) würde eine solche NULL-Zeile an das
    zuerst gesehene Gericht binden — oder UniqueViolation auf
    uq_zvg_listings_identitaet auslösen, wenn (bundesland, Gericht, AZ)
    schon existiert, und den ganzen Upsert samt last_seen_at abbrechen.
    Adopt nur, wenn kein Gericht-Satz da ist und der Ort nicht widerspricht.
    """
    court = normalize_amtsgericht(amtsgericht)
    if not court:
        return
    row = await conn.fetchrow(
        """
        SELECT id, ort
        FROM zvg_listings
        WHERE aktenzeichen = $1 AND source = $2 AND bundesland = $3
          AND amtsgericht IS NULL
        LIMIT 1
        """,
        listing.aktenzeichen,
        listing.source,
        listing.bundesland,
    )
    if row is None or not orts_compatible(row["ort"], listing.ort):
        return
    collision = await conn.fetchval(
        """
        SELECT 1 FROM zvg_listings
        WHERE bundesland = $1
          AND COALESCE(amtsgericht, '') = $2
          AND aktenzeichen = $3
        LIMIT 1
        """,
        listing.bundesland,
        court,
        listing.aktenzeichen,
    )
    if collision:
        return
    await conn.execute(
        """
        UPDATE zvg_listings
        SET amtsgericht = $1, updated_at = NOW()
        WHERE id = $2 AND amtsgericht IS NULL
        """,
        court,
        row["id"],
    )


async def _append_auction_event(
    conn,
    listing_id: str,
    listing: ZvgListing,
    verkehrswert: int | None,
    termin_date=None,
) -> None:
    """Haengt einen Terminstand an, sobald er sich geaendert hat.

    Bisher wurde termin_date bei jedem Scrape ueberschrieben. Damit waren
    Wiederholungstermine und Verkehrswert-Reduktionen - die beiden staerksten
    Hidden-Gem-Signale - nicht rekonstruierbar. Angehaengt wird nur, wenn sich
    Termin oder Verkehrswert gegenueber der letzten Beobachtung unterscheiden,
    damit taegliche Scrapes die Historie nicht mit Duplikaten fluten.

    `verkehrswert` und `termin_date` sind die tatsaechlich gespeicherten Werte,
    nicht der gerade gescrapte Stand: der Upsert haelt per COALESCE einen
    bekannten Termin, und der Sprungschutz verwirft unplausible Verkehrswerte.
    Ohne diese Unterscheidung landete ein leerer Rescrape als NULL-Termin in
    der Historie bzw. ein verworfener Teilobjekt-Wert wie eine Wertreduktion.
    """
    if termin_date is None and verkehrswert is None:
        return

    try:
        async with conn.transaction():
            await conn.execute(
                """
                WITH letzter AS (
                    SELECT termin_date, verkehrswert
                    FROM zvg_auction_events
                    WHERE listing_id = $1
                    ORDER BY erfasst_am DESC, id DESC
                    LIMIT 1
                )
                INSERT INTO zvg_auction_events (listing_id, termin_date, verkehrswert, status, quelle)
                SELECT $1, $2, $3, $4, $5
                WHERE NOT EXISTS (
                    SELECT 1 FROM letzter
                    WHERE termin_date IS NOT DISTINCT FROM $2
                      AND verkehrswert IS NOT DISTINCT FROM $3::numeric
                )
                """,
                listing_id,
                termin_date,
                verkehrswert,
                "aufgehoben" if getattr(listing, "termin_aufgehoben", False) else "angesetzt",
                listing.source,
            )
    except UniqueViolationError:
        return


async def update_auction_terms(
    listing_id: str,
    geringstes_gebot_eur: int | None,
    bestehende_rechte_eur: int | None,
    bestehende_rechte_text: str | None,
    quelle: str = "expose_pdf",
) -> bool:
    """Schreibt gelesene Terminsdaten an den juengsten Stand des aktuellen Termins.

    Ohne diese Zahlen muss die Oberflaeche das gerichtliche Mindestgebot raten
    (frueher verkehrswert * 0,75). Bereits vorhandene Werte werden nicht
    ueberschrieben, damit ein spaeterer, schlechter lesbarer PDF-Durchlauf eine
    gute Lesung nicht kaputtmacht. Ein Wiederholungstermin bekommt eine neue
    Event-Zeile; alte Gebote duerfen dort nicht landen.
    """
    if geringstes_gebot_eur is None and bestehende_rechte_eur is None:
        return False

    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            """
            UPDATE zvg_auction_events e SET
                geringstes_gebot = COALESCE(e.geringstes_gebot, $2::numeric),
                bestehende_rechte_eur = COALESCE(e.bestehende_rechte_eur, $3::numeric),
                bestehende_rechte_text = COALESCE(e.bestehende_rechte_text, $4),
                terms_quelle = COALESCE(e.terms_quelle, $5)
            WHERE e.id = (
                SELECT e2.id FROM zvg_auction_events e2
                JOIN zvg_listings l ON l.id = e2.listing_id
                WHERE e2.listing_id = $1::uuid
                  AND e2.termin_date IS NOT DISTINCT FROM l.termin_date
                ORDER BY e2.erfasst_am DESC, e2.id DESC
                LIMIT 1
            )
            RETURNING e.id
            """,
            listing_id,
            geringstes_gebot_eur,
            bestehende_rechte_eur,
            bestehende_rechte_text,
            quelle,
        )
        return row is not None
    finally:
        await release_connection(conn)


async def upsert_zvg_listing(listing: ZvgListing) -> tuple[str, bool] | None:
    """Einfügen oder aktualisieren eines ZVG-Listings. Gibt (id, is_new) zurück."""
    conn = await get_connection()
    listing = listing.model_copy(update={"amtsgericht": normalize_amtsgericht(listing.amtsgericht)})
    try:
        async with conn.transaction():
            if listing.amtsgericht:
                await _adopt_legacy_row(conn, listing, listing.amtsgericht)

            existing_id = await conn.fetchval(
                """
                SELECT id FROM zvg_listings
                WHERE bundesland = $1
                  AND COALESCE(amtsgericht, '') = COALESCE($2, '')
                  AND aktenzeichen = $3
                LIMIT 1
                """,
                listing.bundesland,
                listing.amtsgericht,
                listing.aktenzeichen,
            )
            if existing_id is None:
                rows = await conn.fetch(
                    "SELECT slug FROM zvg_listings WHERE bundesland = $1",
                    listing.bundesland,
                )
                taken = {row["slug"] for row in rows}
                listing = listing.model_copy(
                    update={"slug": unique_slug_candidate(listing.slug, taken.__contains__)},
                )

            coords = parse_usable_geo_point(listing.lat, listing.lng)

            row = None
            slug_attempts = 0
            while row is None:
                try:
                    async with conn.transaction():
                        row = await conn.fetchrow(
                            """
                    INSERT INTO zvg_listings (
                        aktenzeichen, bundesland, bundesland_name, slug, source, source_url, direktlink,
                        typ, kategorie, adresse, strasse, hausnummer, plz, ort, stadtteil,
                        lat, lng, verkehrswert,
                        wohnflaeche_m2, grundstuecksflaeche_m2, nutzflaeche_m2, gesamtflaeche_m2,
                        baujahr, zimmer, etage, amtsgericht, versteigerungsort,
                        termin_date, termin_saal, ist_neu, denkmalschutz, vermietet,
                        beschreibung, miteigentumsanteil, sondereigentum,
                        gutachten_url, expose_url, raw_data, last_seen_at, scrape_completed_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7,
                        $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18,
                        $19, $20, $21, $22,
                        $23, $24, $25, $26, $27,
                        $28, $29, $30, $31, $32,
                        $33, $34, $35,
                        $36, $37, $38::jsonb, NOW(), $39
                    )
                    ON CONFLICT (bundesland, COALESCE(amtsgericht, ''), aktenzeichen) DO UPDATE SET
                        updated_at = NOW(),
                        last_seen_at = NOW(),
                        direktlink = COALESCE(NULLIF(BTRIM(EXCLUDED.direktlink), ''), zvg_listings.direktlink),
                        termin_date = COALESCE(EXCLUDED.termin_date, zvg_listings.termin_date),
                        -- bisher
                        -- fehlten genau diese Felder hier - bei einer (durch die vorher
                        -- zu weit gefassten Constraint verursachten) Aktenzeichen-
                        -- Kollision "fror" die Zeile dadurch auf den Ortsdaten des
                        -- ZUERST gesehenen Objekts ein, obwohl termin_date/verkehrswert
                        -- schon vom (real anderen) Objekt B stammten. bundesland ist
                        -- jetzt Teil des Conflict-Keys selbst (EXCLUDED.bundesland ist
                        -- hier per Definition bereits identisch) - trotzdem der
                        -- Vollstaendigkeit halber mitgefuehrt.
                        -- Leere Rescrape-Felder dürfen einen bekannten Termin oder
                        -- eine bekannte Adresse nicht auf NULL setzen.
                        bundesland = EXCLUDED.bundesland,
                        ort = CASE
                          WHEN NULLIF(BTRIM(EXCLUDED.plz), '') IS NOT NULL
                           AND NULLIF(BTRIM(zvg_listings.plz), '') IS NOT NULL
                           AND BTRIM(EXCLUDED.plz) IS DISTINCT FROM BTRIM(zvg_listings.plz)
                           AND NULLIF(BTRIM(EXCLUDED.ort), '') IS NULL
                          THEN NULL
                          ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.ort), ''), zvg_listings.ort)
                        END,
                        plz = COALESCE(NULLIF(BTRIM(EXCLUDED.plz), ''), zvg_listings.plz),
                        adresse = CASE
                          WHEN NULLIF(BTRIM(EXCLUDED.plz), '') IS NOT NULL
                           AND NULLIF(BTRIM(zvg_listings.plz), '') IS NOT NULL
                           AND BTRIM(EXCLUDED.plz) IS DISTINCT FROM BTRIM(zvg_listings.plz)
                           AND NULLIF(BTRIM(EXCLUDED.adresse), '') IS NULL
                          THEN NULL
                          ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.adresse), ''), zvg_listings.adresse)
                        END,
                        lat = CASE
                            WHEN (
                              NULLIF(BTRIM(EXCLUDED.adresse), '') IS NOT NULL
                              AND NULLIF(BTRIM(zvg_listings.adresse), '') IS NOT NULL
                              AND BTRIM(EXCLUDED.adresse) IS DISTINCT FROM BTRIM(zvg_listings.adresse)
                            ) OR (
                              NULLIF(BTRIM(EXCLUDED.plz), '') IS NOT NULL
                              AND NULLIF(BTRIM(zvg_listings.plz), '') IS NOT NULL
                              AND BTRIM(EXCLUDED.plz) IS DISTINCT FROM BTRIM(zvg_listings.plz)
                            ) OR (
                              NULLIF(BTRIM(EXCLUDED.ort), '') IS NOT NULL
                              AND NULLIF(BTRIM(zvg_listings.ort), '') IS NOT NULL
                              AND replace(replace(replace(replace(LOWER(BTRIM(EXCLUDED.ort)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
                                  IS DISTINCT FROM replace(replace(replace(replace(LOWER(BTRIM(zvg_listings.ort)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
                            )
                            THEN EXCLUDED.lat
                            ELSE COALESCE(zvg_listings.lat, EXCLUDED.lat)
                        END,
                        lng = CASE
                            WHEN (
                              NULLIF(BTRIM(EXCLUDED.adresse), '') IS NOT NULL
                              AND NULLIF(BTRIM(zvg_listings.adresse), '') IS NOT NULL
                              AND BTRIM(EXCLUDED.adresse) IS DISTINCT FROM BTRIM(zvg_listings.adresse)
                            ) OR (
                              NULLIF(BTRIM(EXCLUDED.plz), '') IS NOT NULL
                              AND NULLIF(BTRIM(zvg_listings.plz), '') IS NOT NULL
                              AND BTRIM(EXCLUDED.plz) IS DISTINCT FROM BTRIM(zvg_listings.plz)
                            ) OR (
                              NULLIF(BTRIM(EXCLUDED.ort), '') IS NOT NULL
                              AND NULLIF(BTRIM(zvg_listings.ort), '') IS NOT NULL
                              AND replace(replace(replace(replace(LOWER(BTRIM(EXCLUDED.ort)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
                                  IS DISTINCT FROM replace(replace(replace(replace(LOWER(BTRIM(zvg_listings.ort)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
                            )
                            THEN EXCLUDED.lng
                            ELSE COALESCE(zvg_listings.lng, EXCLUDED.lng)
                        END,
                        strasse = CASE
                          WHEN NULLIF(BTRIM(EXCLUDED.plz), '') IS NOT NULL
                           AND NULLIF(BTRIM(zvg_listings.plz), '') IS NOT NULL
                           AND BTRIM(EXCLUDED.plz) IS DISTINCT FROM BTRIM(zvg_listings.plz)
                           AND NULLIF(BTRIM(EXCLUDED.strasse), '') IS NULL
                          THEN NULL
                          ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.strasse), ''), zvg_listings.strasse)
                        END,
                        amtsgericht = COALESCE(NULLIF(BTRIM(EXCLUDED.amtsgericht), ''), zvg_listings.amtsgericht),
                        -- Verkehrswert vor
                        -- unplausiblem Überschreiben schützen, OHNE blindes COALESCE
                        -- (das würde legitime Reduktionen nach einem
                        -- Wiederholungstermin dauerhaft verhindern). Ein bereits
                        -- unplausibler Altwert (außerhalb VERKEHRSWERT_UPSERT_PLAUSIBLE_RANGE,
                        -- $40/$41 - z.B. Folge des _parse_euro-Konkatenationsbugs,
                        -- siehe Fix 1) ist nicht schützenswert und wird immer
                        -- ersetzt. War der Altwert plausibel, wird ein Faktor-
                        -- $42-Sprung (in beide Richtungen) NICHT übernommen,
                        -- sondern sichtbar geloggt (siehe Python-Code direkt nach
                        -- diesem Query) und der Altwert beibehalten.
                        verkehrswert = CASE
                            WHEN EXCLUDED.verkehrswert IS NULL THEN zvg_listings.verkehrswert
                            WHEN zvg_listings.verkehrswert IS NULL THEN EXCLUDED.verkehrswert
                            WHEN zvg_listings.verkehrswert < $40 OR zvg_listings.verkehrswert > $41
                                THEN EXCLUDED.verkehrswert
                            WHEN GREATEST(zvg_listings.verkehrswert, EXCLUDED.verkehrswert)
                                 > LEAST(zvg_listings.verkehrswert, EXCLUDED.verkehrswert) * $42
                                THEN zvg_listings.verkehrswert
                            ELSE EXCLUDED.verkehrswert
                        END,
                        raw_data = CASE
                            WHEN EXCLUDED.raw_data IS NOT NULL AND EXCLUDED.raw_data != '{}'::jsonb
                            THEN COALESCE(zvg_listings.raw_data, '{}'::jsonb) || EXCLUDED.raw_data
                            ELSE zvg_listings.raw_data
                        END,
                        gutachten_url = CASE
                            WHEN (
                              zvg_listings.gutachten_url LIKE '%/zvg-images/%'
                              OR zvg_listings.gutachten_url LIKE 'zvg-images/%'
                            ) AND (
                              EXCLUDED.gutachten_url IS NULL
                              OR (
                                EXCLUDED.gutachten_url NOT LIKE '%/zvg-images/%'
                                AND EXCLUDED.gutachten_url NOT LIKE 'zvg-images/%'
                              )
                            )
                            THEN zvg_listings.gutachten_url
                            ELSE COALESCE(EXCLUDED.gutachten_url, zvg_listings.gutachten_url)
                        END,
                        expose_url = CASE
                            WHEN (
                              zvg_listings.expose_url LIKE '%/zvg-images/%'
                              OR zvg_listings.expose_url LIKE 'zvg-images/%'
                            ) AND (
                              EXCLUDED.expose_url IS NULL
                              OR (
                                EXCLUDED.expose_url NOT LIKE '%/zvg-images/%'
                                AND EXCLUDED.expose_url NOT LIKE 'zvg-images/%'
                              )
                            )
                            THEN zvg_listings.expose_url
                            ELSE COALESCE(EXCLUDED.expose_url, zvg_listings.expose_url)
                        END,
                        beschreibung = COALESCE(NULLIF(BTRIM(EXCLUDED.beschreibung), ''), zvg_listings.beschreibung),
                        typ = COALESCE(NULLIF(BTRIM(EXCLUDED.typ), ''), zvg_listings.typ),
                        kategorie = COALESCE(NULLIF(BTRIM(EXCLUDED.kategorie), ''), zvg_listings.kategorie),
                        hausnummer = COALESCE(NULLIF(BTRIM(EXCLUDED.hausnummer), ''), zvg_listings.hausnummer),
                        stadtteil = COALESCE(NULLIF(BTRIM(EXCLUDED.stadtteil), ''), zvg_listings.stadtteil),
                        versteigerungsort = COALESCE(NULLIF(BTRIM(EXCLUDED.versteigerungsort), ''), zvg_listings.versteigerungsort),
                        termin_saal = COALESCE(NULLIF(BTRIM(EXCLUDED.termin_saal), ''), zvg_listings.termin_saal),
                        etage = COALESCE(EXCLUDED.etage, zvg_listings.etage),
                        wohnflaeche_m2 = COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0), zvg_listings.wohnflaeche_m2),
                        grundstuecksflaeche_m2 = COALESCE(NULLIF(EXCLUDED.grundstuecksflaeche_m2, 0), zvg_listings.grundstuecksflaeche_m2),
                        nutzflaeche_m2 = COALESCE(NULLIF(EXCLUDED.nutzflaeche_m2, 0), zvg_listings.nutzflaeche_m2),
                        gesamtflaeche_m2 = COALESCE(NULLIF(EXCLUDED.gesamtflaeche_m2, 0), zvg_listings.gesamtflaeche_m2),
                        baujahr = COALESCE(NULLIF(EXCLUDED.baujahr, 0), zvg_listings.baujahr),
                        zimmer = COALESCE(NULLIF(EXCLUDED.zimmer, 0), zvg_listings.zimmer),
                        denkmalschutz = COALESCE(EXCLUDED.denkmalschutz, zvg_listings.denkmalschutz),
                        vermietet = COALESCE(EXCLUDED.vermietet, zvg_listings.vermietet),
                        ist_neu = zvg_listings.created_at >= (NOW() - INTERVAL '24 hours'),
                        -- Vollständigkeits-Gate (0006): nur überschreiben, wenn DIESER
                        -- Lauf tatsächlich eine abgeschlossene Detail-Anreicherung
                        -- liefert - ein Lauf mit fetch_images=False oder abgebrochener
                        -- Anreicherung darf ein zuvor gesetztes scrape_completed_at
                        -- NICHT wieder auf NULL zurücksetzen.
                        scrape_completed_at = COALESCE(EXCLUDED.scrape_completed_at, zvg_listings.scrape_completed_at),
                        ist_aktiv = TRUE
                    RETURNING id, (xmax = 0) AS is_new, verkehrswert, termin_date
                    """,
                            listing.aktenzeichen,
                            listing.bundesland,
                            listing.bundesland_name,
                            listing.slug,
                            listing.source,
                            listing.source_url,
                            listing.direktlink,
                            listing.typ,
                            listing.kategorie,
                            listing.adresse,
                            listing.strasse,
                            listing.hausnummer,
                            listing.plz,
                            listing.ort,
                            listing.stadtteil,
                            coords[0] if coords else None,
                            coords[1] if coords else None,
                            listing.verkehrswert,
                            float(listing.wohnflaeche_m2) if listing.wohnflaeche_m2 else None,
                            float(listing.grundstuecksflaeche_m2)
                            if listing.grundstuecksflaeche_m2
                            else None,
                            float(listing.nutzflaeche_m2) if listing.nutzflaeche_m2 else None,
                            float(listing.gesamtflaeche_m2) if listing.gesamtflaeche_m2 else None,
                            listing.baujahr,
                            float(listing.zimmer) if listing.zimmer else None,
                            listing.etage,
                            listing.amtsgericht,
                            listing.versteigerungsort,
                            listing.termin_date,
                            listing.termin_saal,
                            listing.ist_neu,
                            listing.denkmalschutz,
                            listing.vermietet,
                            listing.beschreibung,
                            listing.miteigentumsanteil,
                            listing.sondereigentum,
                            listing.gutachten_url,
                            listing.expose_url,
                            __import__("json").dumps(listing.raw_data)
                            if listing.raw_data
                            else "{}",
                            datetime.now(timezone.utc) if listing.detail_scrape_complete else None,
                            *VERKEHRSWERT_UPSERT_PLAUSIBLE_RANGE,
                            _VERKEHRSWERT_JUMP_FACTOR,
                        )
                except UniqueViolationError as exc:
                    if existing_id is not None or not is_slug_unique_violation(exc):
                        raise
                    slug_attempts += 1
                    if slug_attempts >= 8:
                        raise
                    taken_rows = await conn.fetch(
                        "SELECT slug FROM zvg_listings WHERE bundesland = $1",
                        listing.bundesland,
                    )
                    taken = {r["slug"] for r in taken_rows}
                    listing = listing.model_copy(
                        update={"slug": unique_slug_candidate(listing.slug, taken.__contains__)},
                    )

            listing_id = str(row["id"])
            is_new = row["is_new"]
            logger.info(
                f"{'NEU' if is_new else 'UPDATE'}: {listing.aktenzeichen} [{listing.source}] → {listing_id}"
            )

            # sichtbar machen, wenn der
            # Verkehrswert-Schutz gegriffen und den neu gescrapten Wert NICHT
            # übernommen hat (der zurückgegebene Wert weicht dann vom versuchten
            # EXCLUDED.verkehrswert ab) - "sichtbar statt still verworfen"-
            # Prinzip aus docs/DATA_QUALITY.md.
            if (
                not is_new
                and listing.verkehrswert is not None
                and row["verkehrswert"] is not None
                and int(row["verkehrswert"]) != int(listing.verkehrswert)
            ):
                logger.warning(
                    f"Verkehrswert-Schutz aktiv: {listing.aktenzeichen} [{listing.source}] - "
                    f"neuer Wert {listing.verkehrswert:,} EUR wirkt gegenüber dem gespeicherten "
                    f"Wert {int(row['verkehrswert']):,} EUR wie ein unplausibler Sprung "
                    f"(Faktor {_VERKEHRSWERT_JUMP_FACTOR}) und wurde NICHT übernommen. "
                    f"Alter Wert bleibt bestehen."
                )

            gespeicherter_verkehrswert = (
                int(row["verkehrswert"]) if row["verkehrswert"] is not None else None
            )
            await _append_auction_event(
                conn,
                listing_id,
                listing,
                gespeicherter_verkehrswert,
                row["termin_date"],
            )

        if is_new:
            _enqueue_ki_analysis(listing_id)
        return listing_id, bool(is_new)
    except Exception as e:
        logger.error(f"Fehler beim Upsert {listing.aktenzeichen}: {e}")
        return None
    finally:
        await release_connection(conn)


def storage_path_from_public_url(
    public_url: str | None, bucket: str = "zvg-images"
) -> Optional[str]:
    if not public_url:
        return None
    raw = public_url.strip()
    marker = f"/{bucket}/"
    if marker in raw:
        path = raw.split(marker, 1)[1].strip()
        return path or None
    prefix = f"{bucket}/"
    if raw.startswith(prefix):
        path = raw[len(prefix) :].strip()
        return path or None
    return None


async def count_zvg_images(listing_id: str) -> int:
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            "SELECT count(*)::int AS n FROM zvg_images WHERE listing_id = $1::uuid",
            listing_id,
        )
        return int(row["n"]) if row and row["n"] is not None else 0
    finally:
        await release_connection(conn)


async def persist_zvg_gallery(
    listing_id: str,
    images: list[tuple[str, str, int]],
    intended_count: int,
) -> int:
    """Schreibt die Galerie, wenn der Satz vollständig ist. Ein Teil-Upload
    landet, wenn das Listing noch keine Fotos hat oder der neue Satz
    strikt mehr Fotos hat — sonst bleibt die bestehende Galerie."""
    if not images:
        return 0
    if len(images) != intended_count:
        existing = await count_zvg_images(listing_id)
        if existing > 0 and len(images) <= existing:
            return 0
    await replace_zvg_images(listing_id, images)
    return len(images)


async def replace_zvg_images(listing_id: str, images: list[tuple[str, str, int]]) -> None:
    """Ersetzt die Galerie eines ZVG-Listings. Leere Liste: bestehende behalten."""
    if not images:
        return
    conn = await get_connection()
    try:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM zvg_images WHERE listing_id = $1::uuid",
                listing_id,
            )
            await conn.executemany(
                """
                INSERT INTO zvg_images (listing_id, storage_path, public_url, position, is_cover)
                VALUES ($1::uuid, $2, $3, $4, $5)
                """,
                [(listing_id, path, url, pos, pos == 0) for path, url, pos in images],
            )
    finally:
        await release_connection(conn)


async def mark_scrape_completed(listing_id: str) -> bool:
    """
    Setzt scrape_completed_at=NOW() für ein einzelnes Listing (Vollständigkeits-
    Gate, Migration 0006). Für zvg_com_daily.py gedacht, wo Bild-/Dokument-
    Download erst NACH upsert_zvg_listing() (mit bekannter listing_id)
    erfolgt - anders als bei zvg_portal.py/hanmark.py, wo die Anreicherung
    bereits vor dem Upsert abgeschlossen ist und direkt darüber gesetzt wird
    (siehe ZvgListing.detail_scrape_complete).
    """
    conn = await get_connection()
    try:
        result = await conn.execute(
            "UPDATE zvg_listings SET scrape_completed_at = NOW() WHERE id = $1::uuid",
            listing_id,
        )
        return result == "UPDATE 1"
    except Exception as e:
        logger.error(f"Fehler beim Setzen von scrape_completed_at für {listing_id}: {e}")
        return False
    finally:
        await release_connection(conn)


async def update_gutachten_url(listing_id: str, gutachten_url: str) -> bool:
    """Aktualisiert die gutachten_url eines Listings."""
    conn = await get_connection()
    try:
        result = await conn.execute(
            "UPDATE zvg_listings SET gutachten_url = $1, updated_at = NOW() WHERE id = $2::uuid",
            gutachten_url,
            listing_id,
        )
        return result == "UPDATE 1"
    except Exception as e:
        logger.error(f"Fehler beim Aktualisieren der gutachten_url: {e}")
        return False
    finally:
        await release_connection(conn)


async def get_listings_without_gutachten(limit: int = 50) -> list[dict]:
    """Holt zvg.com Listings ohne hochgeladenes Gutachten aus der DB."""
    conn = await get_connection()
    try:
        rows = await conn.fetch(
            """
            SELECT id, aktenzeichen, source, gutachten_url
            FROM zvg_listings
            WHERE source = 'zvg.com'
              AND ist_aktiv = TRUE
              AND gutachten_url IS NOT NULL
              AND gutachten_url NOT LIKE 'http://localhost:9000/%'
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )
        return [dict(r) for r in rows]
    finally:
        await release_connection(conn)


async def deactivate_zvg_listings(zvg_ids: list[int]) -> int:
    """
    Setzt ist_aktiv = FALSE für alle zvg.com-Listings mit den übergebenen zvg_ids.
    Die zvg_id steckt in raw_data->>'zvg_id' (JSONB).
    Gibt die Anzahl deaktivierter Einträge zurück.

    Wird ausschließlich für explizit von zvg.com als "aufgehoben" markierte
    Termine (terminAufgehoben==1) verwendet – ein definitives, sofortiges
    Signal (im Gegensatz zum bloßen Nicht-mehr-Auftauchen in den
    Scrape-Ergebnissen, das über last_seen_at + die tolerante
    "Verschwunden"-Erkennung in archive_past_listings.py läuft, siehe dort).
    """
    if not zvg_ids:
        return 0
    conn = await get_connection()
    try:
        # IDs als Text-Array übergeben (raw_data->>'zvg_id' ist TEXT)
        id_strings = [str(i) for i in zvg_ids]
        result = await conn.execute(
            """
            UPDATE zvg_listings
            SET ist_aktiv = FALSE, updated_at = NOW()
            WHERE raw_data->>'zvg_id' = ANY($1::text[])
              AND source = 'zvg.com'
              AND ist_aktiv = TRUE
            """,
            id_strings,
        )
        count = int(result.split()[-1]) if result else 0
        if count > 0:
            logger.info(f"Deaktiviert: {count} zvg.com-Listings (IDs: {zvg_ids[:5]}...)")
        return count
    except Exception as e:
        logger.error(f"Fehler beim Deaktivieren von Listings: {e}")
        return 0
    finally:
        await release_connection(conn)


async def deactivate_hanmark_listing(
    aktenzeichen: str,
    bundesland: str,
    amtsgericht: str | None = None,
) -> bool:
    """
    Setzt ist_aktiv = FALSE für ein einzelnes hanmark.de-Listing.

    hanmark.de markiert aufgehobene Termine
    direkt auf der Listen-/Detailseite als Text ("Termin aufgehoben"/"aufgehoben",
    HTTP 200 - siehe src/sources/hanmark.py). Analog zu deactivate_zvg_listings()
    oben, aber pro Listing statt per zvg_id-Batch, da hanmark.de (anders als
    zvg.com) keine stabile numerische ID liefert, die sich in einem einzigen
    globalen Aufruf sammeln ließe - die Erkennung passiert bereits während des
    normalen Scrape-Durchlaufs pro Aktenzeichen (siehe hanmark_daily.py).
    Bewusst KEIN last_seen_at-Update (im Gegensatz zum normalen Upsert) - ein
    aufgehobenes Listing soll nicht wie ein normal weiterhin aktives behandelt
    werden.

    Matching-Hinweis (per Live-Check an "3 K 40/25"/AG Freising entdeckt):
    Auf gemeinsamen Amtsgerichts-Sammelseiten (mehrere Amtsgerichte auf einer
    hanmark-Seite, z.B. amtsgericht-80.html für Erding/Freising/Landau/...)
    enthält die Aktenzeichen-Zelle bei Zeilen OHNE Link (u.a. bei "Termin
    aufgehoben") den Amtsgerichtsnamen als Suffix direkt im Aktenzeichen-Text
    ("3 K 40/25 AG Freising"), während dieselbe Zeile in der DB noch die
    "saubere" Version aus einer früheren, noch verlinkten Scrape-Phase trägt
    ("3 K 40/25"). Ein reiner Exact-Match würde solche gerade erst
    aufgehobenen Fälle verfehlen - daher wird hier zusätzlich mit
    abgeschnittenem " AG ..."/" Amtsgericht ..."-Suffix verglichen.
    """
    conn = await get_connection()
    try:
        result = await conn.execute(
            """
            UPDATE zvg_listings
            SET ist_aktiv = FALSE, updated_at = NOW()
            WHERE (
                aktenzeichen = $1
                OR regexp_replace(aktenzeichen, '\\s+(AG|Amtsgericht)\\s+.*$', '', 'i')
                   = regexp_replace($1, '\\s+(AG|Amtsgericht)\\s+.*$', '', 'i')
            )
              AND bundesland = $2
              AND source = 'hanmark.de'
              AND ist_aktiv = TRUE
              AND (
                $3::text IS NULL
                OR COALESCE(amtsgericht, '') = $3
              )
            """,
            aktenzeichen,
            bundesland,
            normalize_amtsgericht(amtsgericht),
        )
        count = int(result.split()[-1]) if result else 0
        if count > 0:
            logger.info(f"Deaktiviert (Termin aufgehoben): {aktenzeichen} [hanmark.de]")
        return count > 0
    except Exception as e:
        logger.error(f"Fehler beim Deaktivieren von hanmark-Listing {aktenzeichen}: {e}")
        return False
    finally:
        await release_connection(conn)


class ArchiveMissingShareBlocked(RuntimeError):
    def __init__(
        self,
        kandidaten: int,
        aktiv: int,
        expired: list[dict],
        max_share: int,
    ):
        self.kandidaten = kandidaten
        self.aktiv = aktiv
        self.expired = expired
        self.max_share = max_share
        share = kandidaten * 100 // aktiv if aktiv else 0
        super().__init__(
            f"last_seen_at-Bremse: {kandidaten} von {aktiv} ({share} %) > {max_share} %"
        )


async def archive_expired_and_missing_listings(missing_tolerance_days: int = 3) -> list[dict]:
    """
    Konsolidierter Archivierungs-Mechanismus (2026-07-04): setzt ist_aktiv=FALSE für
    alle aktiven Listings, die EINES der beiden folgenden Kriterien erfüllen:

    1. termin_date ist vorbei: date-only (Berlin 00:00) erst nach dem
       Versteigerungstag, echte Uhrzeiten sobald termin_date < NOW().
       Entspricht isUpcomingTermin / upcomingTerminSql in der Web-App.
    2. "Verschwunden"-Erkennung: last_seen_at wurde seit `missing_tolerance_days`
       Tagen nicht mehr aktualisiert, d.h. das Listing ist seitdem an
       `missing_tolerance_days` aufeinanderfolgenden täglichen Scrape-Läufen der
       eigenen Quelle nicht mehr in deren Ergebnissen aufgetaucht (upsert_zvg_listing
       aktualisiert last_seen_at bei jedem Treffer). Deckt alle drei Quellen
       einheitlich ab (justizportal, zvg.com, hanmark.de) – ersetzt die früheren,
       separaten Sofort-Deaktivierungen pro Quelle (deactivate_stale_listings,
       Orphan-Teil von deactivate_cancelled_listings in zvg_com_daily.py), die ohne
       Toleranzfenster bei einem einzelnen Scraper-Hänger/Netzwerkfehler fälschlich
       aktive Listings archiviert hätten.

    Ein Toleranzfenster von mehreren Tagen statt einer sofortigen Ein-Tages-Prüfung
    ist bewusst gewählt, um einmalige Scraper-Ausfälle nicht sofort als
    "Objekt verschwunden" fehlzuinterpretieren.

    Kriterium 2 hat dieselbe 20-Prozent-Bremse wie archive_expired.sh: wenn zu
    viele aktive Zeilen nur wegen last_seen_at fallen würden, bleibt der
    Termin-Schnitt und der Massenabgang wird nicht ausgeführt.

    Gibt die archivierten Zeilen zurück (inkl. reason).
    """
    max_missing_share = int(os.environ.get("MAX_MISSING_SHARE_PERCENT", "20"))
    expired_termin = """
                termin_date IS NOT NULL AND (
                  (
                    ((termin_date AT TIME ZONE 'Europe/Berlin')::time = TIME '00:00:00')
                    AND ((termin_date AT TIME ZONE 'Europe/Berlin')::date
                      < (NOW() AT TIME ZONE 'Europe/Berlin')::date)
                  )
                  OR
                  (
                    ((termin_date AT TIME ZONE 'Europe/Berlin')::time <> TIME '00:00:00')
                    AND termin_date < NOW()
                  )
                )
    """
    conn = await get_connection()
    try:
        expired = await conn.fetch(
            f"""
            UPDATE zvg_listings
            SET ist_aktiv = FALSE, updated_at = NOW()
            WHERE ist_aktiv = TRUE
              AND ({expired_termin})
            RETURNING id, source, aktenzeichen, ort, termin_date, last_seen_at,
                      'termin_abgelaufen'::text AS reason
            """,
        )
        counts = await conn.fetchrow(
            """
            SELECT
              count(*) FILTER (WHERE ist_aktiv)::int AS aktiv,
              count(*) FILTER (
                WHERE ist_aktiv
                  AND last_seen_at IS NOT NULL
                  AND last_seen_at < NOW() - ($1::int * INTERVAL '1 day')
              )::int AS kandidaten
            FROM zvg_listings
            """,
            missing_tolerance_days,
        )
        aktiv = int(counts["aktiv"] if counts else 0)
        kandidaten = int(counts["kandidaten"] if counts else 0)
        missing: list = []
        if kandidaten > 0 and aktiv > 0 and (kandidaten * 100 // aktiv) > max_missing_share:
            logger.error(
                f"ALARM: {kandidaten} von {aktiv} aktiven Listings "
                f"({kandidaten * 100 // aktiv} %) wären wegen last_seen_at "
                f"archiviert worden – über {max_missing_share} %. "
                f"Verschwunden-Archiv nicht ausgeführt."
            )
            raise ArchiveMissingShareBlocked(
                kandidaten,
                aktiv,
                [dict(r) for r in expired],
                max_missing_share,
            )
        elif kandidaten > 0:
            missing = await conn.fetch(
                """
                UPDATE zvg_listings
                SET ist_aktiv = FALSE, updated_at = NOW()
                WHERE ist_aktiv = TRUE
                  AND last_seen_at IS NOT NULL
                  AND last_seen_at < NOW() - ($1::int * INTERVAL '1 day')
                RETURNING id, source, aktenzeichen, ort, termin_date, last_seen_at,
                          'quelle_verschwunden'::text AS reason
                """,
                missing_tolerance_days,
            )
        return [dict(r) for r in expired] + [dict(r) for r in missing]
    except ArchiveMissingShareBlocked:
        raise
    except Exception as e:
        logger.error(f"Fehler bei der konsolidierten Archivierung: {e}")
        raise
    finally:
        await release_connection(conn)


async def update_expose_url(listing_id: str, expose_url: str) -> bool:
    """Aktualisiert die expose_url eines Listings."""
    conn = await get_connection()
    try:
        result = await conn.execute(
            "UPDATE zvg_listings SET expose_url = $1, updated_at = NOW() WHERE id = $2::uuid",
            expose_url,
            listing_id,
        )
        return result == "UPDATE 1"
    except Exception as e:
        logger.error(f"Fehler beim Aktualisieren der expose_url: {e}")
        return False
    finally:
        await release_connection(conn)


async def update_listing_grunddaten(
    listing_id: str,
    wohnflaeche_m2: float | None,
    grundstuecksflaeche_m2: float | None,
    baujahr: int | None,
    zimmer: float | None,
    beschreibung: str | None,
) -> None:
    """Schreibt KI-extrahierte Grunddaten zurück in zvg_listings.
    Überschreibt nur NULL-Felder (vorhandene Scraper-Daten bleiben erhalten)."""
    updates = []
    values: list = []
    idx = 1

    if wohnflaeche_m2 is not None:
        updates.append(f"wohnflaeche_m2 = COALESCE(wohnflaeche_m2, ${idx})")
        values.append(wohnflaeche_m2)
        idx += 1
    if grundstuecksflaeche_m2 is not None:
        updates.append(f"grundstuecksflaeche_m2 = COALESCE(grundstuecksflaeche_m2, ${idx})")
        values.append(grundstuecksflaeche_m2)
        idx += 1
    if baujahr is not None:
        updates.append(f"baujahr = COALESCE(baujahr, ${idx})")
        values.append(baujahr)
        idx += 1
    if zimmer is not None:
        updates.append(f"zimmer = COALESCE(zimmer, ${idx})")
        values.append(zimmer)
        idx += 1
    if beschreibung is not None:
        updates.append(f"beschreibung = COALESCE(beschreibung, ${idx})")
        values.append(beschreibung)
        idx += 1

    if not updates:
        return

    values.append(listing_id)
    sql = f"UPDATE zvg_listings SET {', '.join(updates)}, updated_at=NOW() WHERE id=${idx}::uuid"

    conn = await get_connection()
    try:
        result = await conn.execute(sql, *values)
        logger.debug(f"Grunddaten aktualisiert für {listing_id}: {result}")
    except Exception as e:
        logger.error(f"Fehler beim Aktualisieren der Grunddaten für {listing_id}: {e}")
    finally:
        await release_connection(conn)


def _parse_ki_analyse_json(row: dict) -> dict:
    """asyncpg liefert jsonb-Spalten ohne registrierten Type-Codec als reinen
    JSON-Text zurück (kein automatisches Decoding) - `ki_analyse` (aus
    to_jsonb(k)) daher hier explizit parsen. Gibt {} zurück, wenn keine
    KI-Analyse existiert (k.* ist dann NULL → to_jsonb(NULL) = 'null')."""
    import json

    raw = row.get("ki_analyse")
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


async def get_listing_for_quality_check(listing_id: str) -> Optional[dict]:
    """Holt ein einzelnes Listing (+ KI-Analyse, falls vorhanden) für die
    Datenqualitätsprüfung nach der KI-Analyse (siehe data_quality.py)."""
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            """
            SELECT l.*, to_jsonb(k) AS ki_analyse
            FROM zvg_listings l
            LEFT JOIN zvg_ki_analyses k ON k.listing_id = l.id
            WHERE l.id = $1::uuid
            """,
            listing_id,
        )
        if not row:
            return None
        result = dict(row)
        result["ki_analyse"] = _parse_ki_analyse_json(result)
        return result
    finally:
        await release_connection(conn)


async def get_listings_for_fix_flip_deal_reanalysis(limit: int = 50) -> list[dict]:
    """Holt Listings mit bereits erkannten Fix&Flip-Maßnahmen, deren
    Deal-Kalkulation (Ziel 6) noch fehlt - für reanalyze_fix_flip_deal()
    (siehe src/flows/ki_analysis.py), das NUR den zweiten ARV-LLM-Call +
    Python-Kalkulation nachholt (kein vollständiger Gutachten-Re-Scan
    nötig)."""
    conn = await get_connection()
    try:
        rows = await conn.fetch(
            """
            SELECT l.id, l.aktenzeichen, l.typ, l.kategorie, l.verkehrswert, l.beschreibung,
                   l.lat, l.lng, l.gutachten_url, l.expose_url,
                   l.plz, l.ort, l.bundesland, l.source, l.ist_aktiv, l.termin_date,
                   l.wohnflaeche_m2, l.grundstuecksflaeche_m2, l.nutzflaeche_m2,
                   l.gesamtflaeche_m2, l.zimmer, l.baujahr,
                   k.fix_flip_massnahmen, k.fix_flip_gesamtkosten_min_eur, k.fix_flip_gesamtkosten_max_eur
            FROM zvg_listings l
            JOIN zvg_ki_analyses k ON k.listing_id = l.id
            WHERE l.ist_aktiv = TRUE
              AND l.verkehrswert > 0
              AND jsonb_typeof(k.fix_flip_massnahmen) = 'array'
              AND jsonb_array_length(k.fix_flip_massnahmen) > 0
              AND k.arv_min_eur IS NULL
            ORDER BY l.updated_at DESC
            LIMIT $1
            """,
            limit,
        )
        return [dict(r) for r in rows]
    finally:
        await release_connection(conn)


async def update_fix_flip_deal(
    listing_id: str,
    felder: dict,
    model_used: str | None = None,
    tokens_used: int = 0,
) -> None:
    """Schreibt die geschätzten Flip-Fakten zurück (ARV, Haltedauer, Konfidenz).

    Die Euro-Beträge dazu standen hier früher mit: sie kommen jetzt aus
    apps/web/lib/underwriting und werden beim Lesen gerechnet. Die Spalten
    bleiben additiv bestehen, werden aber nicht mehr beschrieben.
    """
    conn = await get_connection()
    try:
        await conn.execute(
            """
            UPDATE zvg_ki_analyses SET
                arv_min_eur = COALESCE($2, arv_min_eur),
                arv_max_eur = COALESCE($3, arv_max_eur),
                arv_begruendung = COALESCE($4, arv_begruendung),
                arv_konfidenz = COALESCE($5, arv_konfidenz),
                holding_monate = COALESCE($6, holding_monate),
                fix_flip_werteinschaetzung = COALESCE($7, fix_flip_werteinschaetzung),
                model_used = COALESCE($8, model_used),
                tokens_used = COALESCE(tokens_used, 0) + $9
            WHERE listing_id = $1::uuid
            """,
            listing_id,
            felder.get("arv_min_eur"),
            felder.get("arv_max_eur"),
            felder.get("arv_begruendung"),
            felder.get("arv_konfidenz"),
            felder.get("holding_monate"),
            felder.get("fix_flip_werteinschaetzung"),
            with_schema_version(model_used) if model_used is not None else None,
            tokens_used,
        )
    finally:
        await release_connection(conn)


async def update_investment_enrichment(
    listing_id: str,
    analyse: dict,
    model_used: str,
    tokens_used: int,
) -> None:
    import json

    payload = json.dumps(analyse, ensure_ascii=False)
    conn = await get_connection()
    try:
        await conn.execute(
            """
            UPDATE zvg_ki_analyses SET
                analyzed_at = NOW(),
                investment_score = $2::jsonb->>'investment_score',
                investment_score_begruendung = $2::jsonb->>'investment_score_begruendung',
                risiken_investor = $2::jsonb->'risiken_investor',
                fix_flip_massnahmen = CASE
                  WHEN jsonb_typeof($2::jsonb->'fix_flip_massnahmen') = 'array'
                   AND jsonb_array_length($2::jsonb->'fix_flip_massnahmen') > 0
                  THEN $2::jsonb->'fix_flip_massnahmen'
                  ELSE fix_flip_massnahmen
                END,
                fix_flip_werteinschaetzung = COALESCE(
                    $2::jsonb->>'fix_flip_werteinschaetzung', fix_flip_werteinschaetzung
                ),
                fix_flip_gesamtkosten_min_eur = COALESCE(
                    ($2::jsonb->>'fix_flip_gesamtkosten_min_eur')::int,
                    fix_flip_gesamtkosten_min_eur
                ),
                fix_flip_gesamtkosten_max_eur = COALESCE(
                    ($2::jsonb->>'fix_flip_gesamtkosten_max_eur')::int,
                    fix_flip_gesamtkosten_max_eur
                ),
                arv_min_eur = COALESCE(($2::jsonb->>'arv_min_eur')::int, arv_min_eur),
                arv_max_eur = COALESCE(($2::jsonb->>'arv_max_eur')::int, arv_max_eur),
                arv_begruendung = COALESCE($2::jsonb->>'arv_begruendung', arv_begruendung),
                arv_konfidenz = COALESCE($2::jsonb->>'arv_konfidenz', arv_konfidenz),
                holding_monate = COALESCE(($2::jsonb->>'holding_monate')::int, holding_monate),
                model_used = $3,
                tokens_used = COALESCE(tokens_used, 0) + $4,
                analysis_tier = 'full',
                full_status = 'idle'
            WHERE listing_id = $1::uuid
            """,
            listing_id,
            payload,
            with_schema_version(model_used, tier="full"),
            tokens_used,
        )
    finally:
        await release_connection(conn)


async def mark_ki_analysis_schema_current(
    listing_id: str,
    model_used: str | None,
    analyzed_after: datetime,
) -> bool:
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            """
            UPDATE zvg_ki_analyses k
            SET model_used = $2
            FROM zvg_listings l
            WHERE k.listing_id = $1::uuid
              AND l.id = k.listing_id
              AND k.analyzed_at >= $3
              AND k.investment_score IS NOT NULL
              AND NULLIF(BTRIM(k.investment_score_begruendung), '') IS NOT NULL
              AND jsonb_typeof(k.risiken_investor) = 'array'
              AND jsonb_array_length(k.risiken_investor) > 0
              AND jsonb_typeof(k.fix_flip_massnahmen) = 'array'
              AND (
                COALESCE(l.verkehrswert, 0) <= 0
                OR jsonb_array_length(k.fix_flip_massnahmen) = 0
                OR k.arv_min_eur IS NOT NULL
              )
            RETURNING k.listing_id
            """,
            listing_id,
            with_schema_version(model_used),
            analyzed_after,
        )
        return row is not None
    finally:
        await release_connection(conn)


async def get_active_listings_for_quality_check(
    batch_size: int = 500, offset: int = 0
) -> list[dict]:
    """Holt einen Batch aktiver Listings (+ KI-Analyse) für den täglichen
    Datenqualitäts-Check über ALLE aktiven Objekte (siehe
    src/flows/data_quality.py). Rein lesende SQL-Abfrage, keine externen
    API-Calls - daher unproblematisch, jeden Tag über alle ~680+ aktiven
    Objekte laufen zu lassen."""
    conn = await get_connection()
    try:
        rows = await conn.fetch(
            """
            SELECT l.*, to_jsonb(k) AS ki_analyse
            FROM zvg_listings l
            LEFT JOIN zvg_ki_analyses k ON k.listing_id = l.id
            WHERE l.ist_aktiv = TRUE
            ORDER BY l.id
            LIMIT $1 OFFSET $2
            """,
            batch_size,
            offset,
        )
        results = []
        for r in rows:
            d = dict(r)
            d["ki_analyse"] = _parse_ki_analyse_json(d)
            results.append(d)
        return results
    finally:
        await release_connection(conn)


async def update_data_quality_flags(listing_id: str, flags: list[dict], needs_review: bool) -> None:
    """Schreibt das Ergebnis der Plausibilitätsprüfung (data_quality.py) für
    ein Listing zurück - überschreibt frühere Flags vollständig (die Prüfung
    ist deterministisch und deckt bei jedem Lauf alle Felder neu ab, ein
    Zusammenführen mit alten Flags würde nur veraltete Einträge anhäufen)."""
    import json

    conn = await get_connection()
    try:
        await conn.execute(
            """
            UPDATE zvg_listings
            SET data_quality_flags = $1::jsonb,
                needs_review = $2,
                data_quality_checked_at = NOW()
            WHERE id = $3::uuid
            """,
            json.dumps(flags),
            needs_review,
            listing_id,
        )
    except Exception as e:
        logger.error(f"Fehler beim Schreiben der Data-Quality-Flags für {listing_id}: {e}")
    finally:
        await release_connection(conn)


async def get_data_quality_summary() -> dict:
    """Aggregiert den aktuellen Stand für den täglichen Report (Anzahl aktiver
    Objekte, Anzahl mit needs_review, Aufschlüsselung nach Quelle + nach
    Problemtyp/reason über alle Flags)."""
    conn = await get_connection()
    try:
        total_active = await conn.fetchval(
            "SELECT count(*) FROM zvg_listings WHERE ist_aktiv = TRUE"
        )
        total_needs_review = await conn.fetchval(
            "SELECT count(*) FROM zvg_listings WHERE ist_aktiv = TRUE AND needs_review = TRUE"
        )
        by_source_rows = await conn.fetch(
            """
            SELECT source, count(*) AS n
            FROM zvg_listings
            WHERE ist_aktiv = TRUE AND needs_review = TRUE
            GROUP BY source
            """
        )
        by_reason_rows = await conn.fetch(
            """
            SELECT flag->>'field' AS field, flag->>'reason' AS reason, count(*) AS n
            FROM zvg_listings l, jsonb_array_elements(l.data_quality_flags) AS flag
            WHERE l.ist_aktiv = TRUE
            GROUP BY flag->>'field', flag->>'reason'
            ORDER BY n DESC
            """
        )
        return {
            "total_active": total_active,
            "total_needs_review": total_needs_review,
            "by_source": {r["source"]: r["n"] for r in by_source_rows},
            "by_reason": [
                {"field": r["field"], "reason": r["reason"], "count": r["n"]}
                for r in by_reason_rows
            ],
        }
    finally:
        await release_connection(conn)


async def save_data_quality_daily_stats(summary: dict) -> None:
    """Persistiert die Tageszusammenfassung für den Trendvergleich zum Vortag
    (siehe data_quality_daily_stats, angelegt in Migration 0005)."""
    import json

    conn = await get_connection()
    try:
        by_reason_map = {
            f"{r['field']}:{r['reason']}": r["count"] for r in summary.get("by_reason", [])
        }
        await conn.execute(
            """
            INSERT INTO data_quality_daily_stats
                (stat_date, total_active, total_needs_review, by_source, by_reason)
            VALUES (CURRENT_DATE, $1, $2, $3::jsonb, $4::jsonb)
            ON CONFLICT (stat_date) DO UPDATE SET
                total_active = EXCLUDED.total_active,
                total_needs_review = EXCLUDED.total_needs_review,
                by_source = EXCLUDED.by_source,
                by_reason = EXCLUDED.by_reason
            """,
            summary["total_active"],
            summary["total_needs_review"],
            json.dumps(summary.get("by_source", {})),
            json.dumps(by_reason_map),
        )
    except Exception as e:
        logger.error(f"Fehler beim Speichern der Data-Quality-Tagesstatistik: {e}")
    finally:
        await release_connection(conn)


def data_quality_previous_payload(row: Optional[dict]) -> Optional[dict]:
    """Nur JSON-sichere Felder für den Report-POST — kein UUID/Date aus SELECT *."""
    if not row:
        return None
    try:
        return {"total_needs_review": int(row["total_needs_review"])}
    except (KeyError, TypeError, ValueError):
        return None


async def get_previous_data_quality_stats(days_back: int = 1) -> Optional[dict]:
    """Holt die Tagesstatistik von vor `days_back` Tagen für den Trendvergleich."""
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            """
            SELECT total_needs_review FROM data_quality_daily_stats
            WHERE stat_date = CURRENT_DATE - $1::int
            """,
            days_back,
        )
        return data_quality_previous_payload(dict(row) if row else None)
    finally:
        await release_connection(conn)


def _parse_date_flexible(value) -> "Optional[datetime.date]":
    """Konvertiert String-Datum (z.B. '11.02.2026' oder '2026-02-11') in ein date-Objekt."""
    import datetime as _dt

    if value is None:
        return None
    if isinstance(value, (_dt.date, _dt.datetime)):
        return value if isinstance(value, _dt.date) else value.date()
    if isinstance(value, str):
        for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                return _dt.datetime.strptime(value.strip(), fmt).date()
            except ValueError:
                continue
        logger.warning(f"Unbekanntes Datumsformat: {value!r} – wird ignoriert")
    return None


async def get_ki_analysis_status(listing_id: str) -> Optional[dict]:
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            """
            SELECT analysis_tier, full_status, full_requested_by, full_requested_at
            FROM zvg_ki_analyses
            WHERE listing_id = $1::uuid
            """,
            listing_id,
        )
        return dict(row) if row else None
    finally:
        await release_connection(conn)


async def count_full_requests_today(user_id: str) -> int:
    conn = await get_connection()
    try:
        value = await conn.fetchval(
            """
            SELECT count(*)
            FROM zvg_ki_analyses
            WHERE full_requested_by = $1::uuid
              AND full_requested_at >= (timezone('Europe/Berlin', now()))::date
                    AT TIME ZONE 'Europe/Berlin'
            """,
            user_id,
        )
        return int(value or 0)
    finally:
        await release_connection(conn)


async def try_claim_full_analysis(listing_id: str, user_id: Optional[str]) -> dict:
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO zvg_ki_analyses (
                listing_id, analysis_tier, full_status, full_requested_by, full_requested_at
            ) VALUES ($1::uuid, 'basic', 'queued', $2::uuid, NOW())
            ON CONFLICT (listing_id) DO UPDATE SET
                full_status = 'queued',
                full_requested_by = COALESCE(
                    zvg_ki_analyses.full_requested_by, EXCLUDED.full_requested_by
                ),
                full_requested_at = COALESCE(zvg_ki_analyses.full_requested_at, NOW())
            WHERE zvg_ki_analyses.analysis_tier IS DISTINCT FROM 'full'
              AND COALESCE(zvg_ki_analyses.full_status, 'idle') NOT IN ('queued', 'running')
            RETURNING listing_id, analysis_tier, full_status
            """,
            listing_id,
            user_id,
        )
        current = None
        if not row:
            current = await conn.fetchrow(
                """
                SELECT analysis_tier, full_status
                FROM zvg_ki_analyses
                WHERE listing_id = $1::uuid
                """,
                listing_id,
            )
        returning = dict(row) if row else None
        existing = dict(current) if current else None
        outcome = interpret_full_claim(returning, existing)
        payload = existing or returning or {}
        return {
            "outcome": outcome,
            "analysis_tier": payload.get("analysis_tier"),
            "full_status": payload.get("full_status"),
        }
    finally:
        await release_connection(conn)


async def set_full_analysis_status(listing_id: str, full_status: str) -> None:
    conn = await get_connection()
    try:
        await conn.execute(
            """
            UPDATE zvg_ki_analyses
            SET full_status = $2
            WHERE listing_id = $1::uuid
            """,
            listing_id,
            full_status,
        )
    finally:
        await release_connection(conn)


async def upsert_ki_analyse(
    listing_id: str,
    analyse: dict,
    model_used: str,
    tokens_used: int = 0,
    *,
    analysis_tier: str = "full",
    full_status: Optional[str] = None,
) -> None:
    """Speichert KI-Analyse-Ergebnis. Daily darf eine Vollanalyse nicht auf Basis zurücksetzen."""
    import json

    model_used = with_schema_version(model_used, tier=analysis_tier)
    resolved_status = full_status or ("idle" if analysis_tier == "full" else "idle")
    conn = await get_connection()
    try:
        await conn.execute(
            """
            INSERT INTO zvg_ki_analyses (
                listing_id, grundbuch_blatt, grundbuch_flurstueck, grundbuch_gemarkung,
                flurstuecke, maengel, belastungen, modernisierungen,
                bodenrichtwert_eur_m2, bodenrichtwert_stichtag, bodenrichtwert_berechnung,
                energieausweis_vorhanden, effizienzklasse, ausweisjahr, energietraeger,
                endenergieverbrauch_kwh, innenbesichtigung, restnutzungsdauer_j,
                heizung, wohnraeume, zustand_aussen, zustand_innen, maengel_kurz,
                baubeschreibung, instandhaltung, baulasten,
                lage_einwohner, lage_region, lage_verkehr, lage_charakter, lage_umgebung,
                moegliche_kaltmiete, hausgeld, jahresrohertrag, liegenschaftszinssatz, ertragswert,
                investment_score, investment_score_begruendung, risiken_investor,
                fix_flip_massnahmen, fix_flip_werteinschaetzung,
                fix_flip_gesamtkosten_min_eur, fix_flip_gesamtkosten_max_eur,
                arv_min_eur, arv_max_eur, arv_begruendung, arv_konfidenz, holding_monate,
                orte_in_der_naehe,
                model_used, tokens_used,
                analysis_tier, full_status
            ) VALUES (
                $1::uuid, $2, $3, $4,
                $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
                $9, $10, $11,
                $12, $13, $14, $15,
                $16, $17, $18,
                $19, $20, $21, $22, $23,
                $24, $25, $26,
                $27, $28, $29, $30, $31,
                $32, $33, $34, $35, $36,
                $37, $38, $39::jsonb,
                $40::jsonb, $41,
                $42, $43,
                $44, $45, $46, $47, $48,
                $49::jsonb,
                $50, $51,
                $52, $53
            )
            ON CONFLICT (listing_id) DO UPDATE SET
                analyzed_at = NOW(),
                model_used = EXCLUDED.model_used,
                tokens_used = EXCLUDED.tokens_used,
                grundbuch_blatt = EXCLUDED.grundbuch_blatt,
                grundbuch_flurstueck = EXCLUDED.grundbuch_flurstueck,
                grundbuch_gemarkung = EXCLUDED.grundbuch_gemarkung,
                flurstuecke = EXCLUDED.flurstuecke,
                modernisierungen = EXCLUDED.modernisierungen,
                bodenrichtwert_eur_m2 = EXCLUDED.bodenrichtwert_eur_m2,
                bodenrichtwert_stichtag = EXCLUDED.bodenrichtwert_stichtag,
                bodenrichtwert_berechnung = EXCLUDED.bodenrichtwert_berechnung,
                energieausweis_vorhanden = EXCLUDED.energieausweis_vorhanden,
                effizienzklasse = EXCLUDED.effizienzklasse,
                ausweisjahr = EXCLUDED.ausweisjahr,
                energietraeger = EXCLUDED.energietraeger,
                endenergieverbrauch_kwh = EXCLUDED.endenergieverbrauch_kwh,
                innenbesichtigung = EXCLUDED.innenbesichtigung,
                restnutzungsdauer_j = EXCLUDED.restnutzungsdauer_j,
                heizung = EXCLUDED.heizung,
                wohnraeume = EXCLUDED.wohnraeume,
                zustand_aussen = EXCLUDED.zustand_aussen,
                zustand_innen = EXCLUDED.zustand_innen,
                maengel_kurz = EXCLUDED.maengel_kurz,
                baubeschreibung = EXCLUDED.baubeschreibung,
                instandhaltung = EXCLUDED.instandhaltung,
                baulasten = EXCLUDED.baulasten,
                lage_einwohner = EXCLUDED.lage_einwohner,
                lage_region = EXCLUDED.lage_region,
                lage_verkehr = EXCLUDED.lage_verkehr,
                lage_charakter = EXCLUDED.lage_charakter,
                lage_umgebung = EXCLUDED.lage_umgebung,
                moegliche_kaltmiete = EXCLUDED.moegliche_kaltmiete,
                hausgeld = EXCLUDED.hausgeld,
                jahresrohertrag = EXCLUDED.jahresrohertrag,
                liegenschaftszinssatz = EXCLUDED.liegenschaftszinssatz,
                ertragswert = EXCLUDED.ertragswert,
                maengel = EXCLUDED.maengel,
                belastungen = EXCLUDED.belastungen,
                investment_score = EXCLUDED.investment_score,
                investment_score_begruendung = EXCLUDED.investment_score_begruendung,
                risiken_investor = EXCLUDED.risiken_investor,
                fix_flip_massnahmen = EXCLUDED.fix_flip_massnahmen,
                fix_flip_werteinschaetzung = EXCLUDED.fix_flip_werteinschaetzung,
                fix_flip_gesamtkosten_min_eur = EXCLUDED.fix_flip_gesamtkosten_min_eur,
                fix_flip_gesamtkosten_max_eur = EXCLUDED.fix_flip_gesamtkosten_max_eur,
                arv_min_eur = EXCLUDED.arv_min_eur,
                arv_max_eur = EXCLUDED.arv_max_eur,
                arv_begruendung = EXCLUDED.arv_begruendung,
                arv_konfidenz = EXCLUDED.arv_konfidenz,
                holding_monate = EXCLUDED.holding_monate,
                orte_in_der_naehe = EXCLUDED.orte_in_der_naehe,
                analysis_tier = CASE
                    WHEN zvg_ki_analyses.analysis_tier = 'full' THEN 'full'
                    ELSE EXCLUDED.analysis_tier
                END,
                full_status = CASE
                    WHEN EXCLUDED.analysis_tier = 'full' THEN 'idle'
                    WHEN zvg_ki_analyses.full_status IN ('queued', 'running')
                    THEN zvg_ki_analyses.full_status
                    ELSE COALESCE(EXCLUDED.full_status, zvg_ki_analyses.full_status, 'idle')
                END
            WHERE zvg_ki_analyses.analysis_tier IS DISTINCT FROM 'full'
               OR EXCLUDED.analysis_tier = 'full'
            """,
            listing_id,
            analyse.get("grundbuch_blatt"),
            analyse.get("grundbuch_flurstueck"),
            analyse.get("grundbuch_gemarkung"),
            json.dumps(analyse.get("flurstuecke", [])),
            json.dumps(analyse.get("maengel", [])),
            json.dumps(analyse.get("belastungen", [])),
            json.dumps(analyse.get("modernisierungen", [])),
            analyse.get("bodenrichtwert_eur_m2"),
            _parse_date_flexible(analyse.get("bodenrichtwert_stichtag")),
            analyse.get("bodenrichtwert_berechnung"),
            analyse.get("energieausweis_vorhanden"),
            analyse.get("effizienzklasse"),
            analyse.get("ausweisjahr"),
            analyse.get("energietraeger"),
            analyse.get("endenergieverbrauch_kwh"),
            analyse.get("innenbesichtigung"),
            analyse.get("restnutzungsdauer_j"),
            analyse.get("heizung"),
            analyse.get("wohnraeume"),
            analyse.get("zustand_aussen"),
            analyse.get("zustand_innen"),
            analyse.get("maengel_kurz"),
            analyse.get("baubeschreibung"),
            analyse.get("instandhaltung"),
            analyse.get("baulasten"),
            analyse.get("lage_einwohner"),
            analyse.get("lage_region"),
            analyse.get("lage_verkehr"),
            analyse.get("lage_charakter"),
            analyse.get("lage_umgebung"),
            analyse.get("moegliche_kaltmiete"),
            analyse.get("hausgeld"),
            analyse.get("jahresrohertrag"),
            analyse.get("liegenschaftszinssatz"),
            analyse.get("ertragswert"),
            analyse.get("investment_score"),
            analyse.get("investment_score_begruendung"),
            json.dumps(analyse.get("risiken_investor", [])),
            json.dumps(analyse.get("fix_flip_massnahmen", [])),
            analyse.get("fix_flip_werteinschaetzung"),
            analyse.get("fix_flip_gesamtkosten_min_eur"),
            analyse.get("fix_flip_gesamtkosten_max_eur"),
            analyse.get("arv_min_eur"),
            analyse.get("arv_max_eur"),
            analyse.get("arv_begruendung"),
            analyse.get("arv_konfidenz"),
            analyse.get("holding_monate"),
            json.dumps(analyse.get("orte_in_der_naehe") or []),
            model_used,
            tokens_used,
            analysis_tier,
            resolved_status,
        )
        logger.info(f"KI-Analyse gespeichert: {listing_id}")
    except Exception as e:
        logger.error(f"Fehler beim Speichern der KI-Analyse: {e}")
        raise
    finally:
        await release_connection(conn)
