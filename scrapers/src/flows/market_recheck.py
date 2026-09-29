"""
Wöchentliche Nachprüfung analysierter Marktobjekte.

Zweck: Standzeit und Preisreduktion sind der direkteste Hinweis auf
Verhandlungsspielraum, und sie kalibrieren die Preislücken-Schwelle, ohne dass
wir dafür je bieten müssen — verschwindet eine Anzeige nach einer Senkung, war
der geforderte Preis vorher zu hoch.

Bewusst ohne LLM: für ein Ereignis genügen Preis und Erreichbarkeit. Eine
Volanalyse je Nachprüfung wäre wöchentlich nicht bezahlbar und würde nichts
Zusätzliches beobachten.
"""

import asyncio
import random

from prefect import flow, get_run_logger, task

from src.storage.postgres import get_connection, release_connection
from src.utils.content_price import nachpruef_typ, preis_aus_text
from src.utils.manual_content import MANUAL_UPLOAD_HOST
from src.utils.scrape_ladder import fetch_page_resilient
from src.utils.scrape_rate_limit import KONTINGENT_ERNTE, MIN_INTERVAL_SEC

PAUSE_SEK = (MIN_INTERVAL_SEC + 2, MIN_INTERVAL_SEC + 6)
NACHPRUEFUNG_AB_TAGEN = 7


class BudgetErschoepft(Exception):
    """Stundenlimit der Domain erreicht — der nächste Lauf macht weiter."""


async def faellige_objekte(limit: int) -> list[dict]:
    conn = await get_connection()
    try:
        rows = await conn.fetch(
            """
            SELECT l.id, l.source_url, l.preis, l.angebotstyp
            FROM real_estate_listings l
            WHERE l.ist_aktiv
              AND l.source_url IS NOT NULL
              AND l.source_url NOT LIKE $3
              AND COALESCE(l.raw_data#>>'{scrape_metadata,fetch_source}', '')
                    IN ('http', 'scrapling')
              AND lower(COALESCE(l.raw_data#>>'{scrape_metadata,session_cookie_used}', ''))
                    NOT IN ('true', 't', '1')
              AND COALESCE(
                    (SELECT max(beobachtet_am) FROM market_listing_events e
                     WHERE e.listing_id = l.id),
                    l.first_seen_at
                  ) < NOW() - make_interval(days => $2)
            ORDER BY l.last_seen_at ASC NULLS FIRST
            LIMIT $1
            """,
            limit,
            NACHPRUEFUNG_AB_TAGEN,
            f"%//{MANUAL_UPLOAD_HOST}/%",
        )
        return [dict(row) for row in rows]
    finally:
        await release_connection(conn)


async def schreibe_ereignis(
    listing_id: str,
    preis: int | None,
    status: str,
    *,
    angebotstyp: str | None = None,
) -> None:
    typ = angebotstyp if angebotstyp in ("kauf", "miete") else None
    conn = await get_connection()
    try:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO market_listing_events (listing_id, preis_eur, status)
                VALUES ($1, $2, $3)
                """,
                listing_id,
                preis,
                status,
            )
            if status == "verschwunden":
                await conn.execute(
                    "UPDATE real_estate_listings SET ist_aktiv = false WHERE id = $1",
                    listing_id,
                )
            elif preis is not None:
                await conn.execute(
                    """
                    UPDATE real_estate_listings
                    SET preis = $2::integer,
                        preis_pro_m2 = CASE
                          WHEN wohnflaeche_m2 IS NOT NULL AND wohnflaeche_m2 > 0
                          THEN round($2::numeric / wohnflaeche_m2, 2) ELSE preis_pro_m2 END,
                        last_seen_at = NOW(),
                        angebotstyp = COALESCE($3::text, angebotstyp),
                        kaltmiete_eur = CASE
                          WHEN COALESCE($3::text, angebotstyp) = 'miete'
                          THEN $2::integer
                          WHEN $3::text = 'kauf'
                          THEN NULL
                          ELSE kaltmiete_eur
                        END
                    WHERE id = $1
                    """,
                    listing_id,
                    preis,
                    typ,
                )
            else:
                await conn.execute(
                    "UPDATE real_estate_listings SET last_seen_at = NOW() WHERE id = $1",
                    listing_id,
                )
    finally:
        await release_connection(conn)


@task(name="pruefe-marktobjekt", retries=0)
async def pruefe_objekt(objekt: dict) -> str:
    logger = get_run_logger()
    ergebnis = await fetch_page_resilient(objekt["source_url"], kontingent=KONTINGENT_ERNTE)

    if not ergebnis.success:
        if ergebnis.error_code == "SCRAPE_RATE_LIMITED":
            raise BudgetErschoepft(objekt["source_url"])
        # Nur ein eindeutiges "gibt es nicht mehr" zählt als verschwunden.
        # Eine Bot-Wall heißt, dass wir nichts wissen, nicht dass verkauft wurde.
        if ergebnis.status_code in (404, 410):
            await schreibe_ereignis(objekt["id"], None, "verschwunden")
            return "verschwunden"
        logger.warning(f"Nachprüfung ohne Ergebnis: {objekt['source_url']} ({ergebnis.error_code})")
        return "unklar"

    text = ergebnis.markdown or ergebnis.raw_html or ""
    gespeichert = (objekt.get("angebotstyp") or "").strip()
    angebotstyp, typwechsel = nachpruef_typ(gespeichert, text)
    if angebotstyp not in ("kauf", "miete"):
        return "unklar"

    preis = preis_aus_text(text, angebotstyp)
    if typwechsel:
        if preis is None:
            return "unklar"
        await schreibe_ereignis(objekt["id"], preis, "online", angebotstyp=angebotstyp)
        logger.info(f"{objekt['source_url']}: {gespeichert} → {angebotstyp} ({preis} €)")
        return "online"

    alt = objekt.get("preis")
    if preis is None:
        await schreibe_ereignis(objekt["id"], None, "online")
        return "online"
    if alt is None or preis == alt:
        await schreibe_ereignis(objekt["id"], preis, "online")
        return "online"
    # Ein Faktor drei ist keine Preisanpassung, sondern ein Parserfehler.
    # Lieber kein Ereignis als ein erfundenes.
    if preis * 3 < alt or preis > alt * 3:
        logger.warning(f"Unplausibler Preissprung {alt} → {preis}: {objekt['source_url']}")
        return "unklar"
    status = "preis_gesenkt" if preis < alt else "preis_erhoeht"
    await schreibe_ereignis(objekt["id"], preis, status)
    logger.info(f"{objekt['source_url']}: {alt} → {preis} € ({status})")
    return status


@flow(name="market-recheck", log_prints=True)
async def market_recheck_flow(objekte: int = 40) -> dict:
    logger = get_run_logger()
    faellig = await faellige_objekte(objekte)
    logger.info(f"{len(faellig)} Marktobjekte zur Nachprüfung fällig")

    zaehler: dict[str, int] = {}
    for objekt in faellig:
        try:
            status = await pruefe_objekt(objekt)
        except BudgetErschoepft:
            logger.info("Stundenlimit der Domain erreicht — Lauf endet hier")
            zaehler["budget_erschoepft"] = 1
            break
        zaehler[status] = zaehler.get(status, 0) + 1
        await asyncio.sleep(random.uniform(*PAUSE_SEK))

    logger.info(f"Nachprüfung fertig: {zaehler}")
    return zaehler


if __name__ == "__main__":
    asyncio.run(market_recheck_flow())
