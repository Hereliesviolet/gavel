"""
DB-Zugriff für die Marktreferenz (market_comparables, market_listing_events).

Bewusst getrennt von real_estate.py: dort liegen die vom Nutzer eingereichten
Einzelobjekte, hier der systematisch geerntete Referenzbestand ohne
Nutzerbezug. Gemeinsam ist nur der Connection-Pool aus postgres.py.
"""

from loguru import logger

from src.sources.kleinanzeigen_search import MarktAngebot
from src.storage.postgres import get_connection, release_connection
from src.utils.url_safety import canonicalize_listing_url


async def upsert_market_comparables(angebote: list[MarktAngebot]) -> int:
    """
    Schreibt Vergleichsangebote. Ein erneutes Sehen derselben Anzeige
    aktualisiert Preis und zuletzt_gesehen_am, behält aber erfasst_am — daraus
    ergibt sich die Standzeit. kandidat_status bleibt unangetastet, sonst würde
    eine Auffrischung eine bereits getroffene Beförderungsentscheidung
    zurücksetzen.
    """
    if not angebote:
        return 0

    conn = await get_connection()
    geschrieben = 0
    try:
        for angebot in angebote:
            try:
                async with conn.transaction():
                    row = await conn.fetchrow(
                        """
                        WITH alt AS (
                          SELECT preis_eur, angebotstyp FROM market_comparables
                          WHERE quelle = $1 AND externe_id = $2
                        ), neu AS (
                          INSERT INTO market_comparables (
                            quelle, externe_id, url, angebotstyp, kategorie, titel,
                            plz, mikromarkt, ort, wohnflaeche_m2, zimmer,
                            preis_eur, preis_pro_m2
                          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                          ON CONFLICT (quelle, externe_id) DO UPDATE SET
                            url = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.url
                              ELSE EXCLUDED.url
                            END,
                            titel = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.titel
                              ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.titel), ''), market_comparables.titel)
                            END,
                            kategorie = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.kategorie
                              ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.kategorie), ''), market_comparables.kategorie)
                            END,
                            plz = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.plz
                              ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.plz), ''), market_comparables.plz)
                            END,
                            mikromarkt = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.mikromarkt
                              ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.mikromarkt), ''), market_comparables.mikromarkt)
                            END,
                            ort = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.ort
                              ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.ort), ''), market_comparables.ort)
                            END,
                            preis_eur = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.preis_eur
                              ELSE COALESCE(NULLIF(EXCLUDED.preis_eur, 0), market_comparables.preis_eur)
                            END,
                            wohnflaeche_m2 = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.wohnflaeche_m2
                              ELSE COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0), market_comparables.wohnflaeche_m2)
                            END,
                            zimmer = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.zimmer
                              ELSE COALESCE(NULLIF(EXCLUDED.zimmer, 0), market_comparables.zimmer)
                            END,
                            preis_pro_m2 = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.preis_pro_m2
                              WHEN COALESCE(NULLIF(EXCLUDED.preis_eur, 0), market_comparables.preis_eur) IS NOT NULL
                               AND COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0), market_comparables.wohnflaeche_m2) > 0
                              THEN ROUND(
                                COALESCE(NULLIF(EXCLUDED.preis_eur, 0), market_comparables.preis_eur)::numeric
                                / COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0), market_comparables.wohnflaeche_m2),
                                2)
                              ELSE COALESCE(NULLIF(EXCLUDED.preis_pro_m2, 0), market_comparables.preis_pro_m2)
                            END,
                            zuletzt_gesehen_am = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.zuletzt_gesehen_am
                              ELSE NOW()
                            END,
                            ist_aktiv = CASE
                              WHEN EXCLUDED.angebotstyp IS DISTINCT FROM market_comparables.angebotstyp
                              THEN market_comparables.ist_aktiv
                              ELSE true
                            END
                          RETURNING id
                        )
                        SELECT neu.id, alt.preis_eur AS alt_preis,
                               alt.angebotstyp AS alt_angebotstyp
                        FROM neu LEFT JOIN alt ON true
                        """,
                        angebot.quelle,
                        angebot.externe_id,
                        canonicalize_listing_url(angebot.url),
                        angebot.angebotstyp,
                        angebot.kategorie,
                        angebot.titel,
                        angebot.plz,
                        angebot.mikromarkt,
                        angebot.ort,
                        angebot.wohnflaeche_m2,
                        angebot.zimmer,
                        angebot.preis_eur,
                        angebot.preis_pro_m2,
                    )
                    alt_preis = row["alt_preis"] if row else None
                    alt_typ = row["alt_angebotstyp"] if row else None
                    if (
                        alt_preis is not None
                        and angebot.preis_eur
                        and alt_preis != angebot.preis_eur
                        and alt_typ == angebot.angebotstyp
                    ):
                        await conn.execute(
                            """
                            INSERT INTO market_listing_events (comparable_id, preis_eur, status)
                            VALUES ($1, $2, $3)
                            """,
                            row["id"],
                            angebot.preis_eur,
                            "preis_gesenkt" if angebot.preis_eur < alt_preis else "preis_erhoeht",
                        )
                    geschrieben += 1
            except Exception as e:
                logger.warning(
                    f"Vergleichsangebot {angebot.quelle}/{angebot.externe_id} "
                    f"nicht gespeichert: {e}"
                )
    finally:
        await release_connection(conn)

    return geschrieben


async def record_price_change(comparable_id: str, preis_eur: int | None, status: str) -> None:
    conn = await get_connection()
    try:
        await conn.execute(
            """
            INSERT INTO market_listing_events (comparable_id, preis_eur, status)
            VALUES ($1, $2, $3)
            """,
            comparable_id,
            preis_eur,
            status,
        )
    finally:
        await release_connection(conn)


async def ernte_ziele(limit: int) -> list[dict]:
    """
    Mikromärkte, in denen aktive ZVG-Objekte liegen, sortiert nach Dringlichkeit:
    zuerst die, für die Kauf- oder Mietreferenz noch zu dünn ist (das Minimum
    beider Stichproben), danach die mit der ältesten Sichtung. So wandert das
    Anfrage-Budget dahin, wo Marktlücke und Buy-&-Hold-Miete fehlen.

    Als PLZ wird die häufigste PLZ des Mikromarkts genommen — sie liegt
    definitionsgemäß in ihm, und der Radius deckt den Rest ab.
    """
    conn = await get_connection()
    try:
        rows = await conn.fetch(
            """
            WITH bedarf AS (
              SELECT left(digits, 3) AS mikromarkt,
                     CASE WHEN l.kategorie IN ('haus', 'wohnung')
                          THEN l.kategorie ELSE 'haus' END AS kategorie,
                     mode() WITHIN GROUP (ORDER BY digits) AS plz,
                     count(*) AS zvg_objekte
              FROM zvg_listings l
              CROSS JOIN LATERAL (
                SELECT regexp_replace(trim(coalesce(l.plz, '')), '[^0-9]', '', 'g') AS digits
              ) d
              WHERE l.ist_aktiv
                AND digits ~ '^[0-9]{5}$'
                AND l.kategorie IN ('haus', 'wohnung')
              GROUP BY 1, 2
            )
            SELECT b.mikromarkt, b.kategorie, b.plz, b.zvg_objekte,
                   LEAST(COALESCE(c.n_kauf, 0), COALESCE(c.n_miete, 0)) AS bestand,
                   c.aeltester
            FROM bedarf b
            LEFT JOIN (
              SELECT mikromarkt, kategorie,
                     count(*) FILTER (WHERE angebotstyp = 'kauf') AS n_kauf,
                     count(*) FILTER (WHERE angebotstyp = 'miete') AS n_miete,
                     min(zuletzt_gesehen_am) AS aeltester
              FROM market_comparables
              WHERE ist_aktiv
                AND zuletzt_gesehen_am > NOW() - INTERVAL '120 days'
              GROUP BY 1, 2
            ) c ON c.mikromarkt = b.mikromarkt AND c.kategorie = b.kategorie
            ORDER BY LEAST(COALESCE(c.n_kauf, 0), COALESCE(c.n_miete, 0)) ASC,
                     b.zvg_objekte DESC, c.aeltester ASC NULLS FIRST
            LIMIT $1
            """,
            limit,
        )
        return [dict(row) for row in rows]
    finally:
        await release_connection(conn)


async def markiere_verschwundene(
    tage: int = 120,
    maerkte: list[tuple[str, str, str]] | None = None,
) -> int:
    """
    Anzeigen in den in diesem Lauf fertig geernteten Tripeln
    (mikromarkt, kategorie, angebotstyp), die seit `tage` nicht mehr
    gesehen wurden. Ohne abgeschlossene Märkte gibt es keine Volkszählung
    über den Rest der Stichprobe.
    """
    if not maerkte:
        return 0
    conn = await get_connection()
    try:
        mikromaerkte = [m[0] for m in maerkte]
        kategorien = [m[1] for m in maerkte]
        angebotstypen = [m[2] for m in maerkte]
        async with conn.transaction():
            rows = await conn.fetch(
                """
                UPDATE market_comparables AS c
                SET ist_aktiv = false
                FROM UNNEST($2::text[], $3::text[], $4::text[])
                  AS z(mikromarkt, kategorie, angebotstyp)
                WHERE c.ist_aktiv
                  AND c.mikromarkt = z.mikromarkt
                  AND c.kategorie = z.kategorie
                  AND c.angebotstyp = z.angebotstyp
                  AND c.zuletzt_gesehen_am < NOW() - make_interval(days => $1)
                RETURNING c.id, c.preis_eur
                """,
                tage,
                mikromaerkte,
                kategorien,
                angebotstypen,
            )
            for row in rows:
                await conn.execute(
                    """
                    INSERT INTO market_listing_events (comparable_id, preis_eur, status)
                    VALUES ($1, $2, 'verschwunden')
                    """,
                    row["id"],
                    row["preis_eur"],
                )
            return len(rows)
    finally:
        await release_connection(conn)
