"""
Ernte von Vergleichsangeboten für die unabhängige Marktreferenz.

Warum das der Kern ist: die bisherige Aussage "unter Markt" verglich
ZVG-Verkehrswerte gegen ZVG-Verkehrswerte, also gerichtliche Schätzungen gegen
gerichtliche Schätzungen. Erst ein Preis, den jemand tatsächlich fordert, macht
eine Unterbewertung überprüfbar.

Der Flow erntet Suchergebnisseiten je Mikromarkt (dreistelliges PLZ-Präfix),
Kategorie und Angebotstyp. Er priorisiert Mikromärkte, in denen aktive
ZVG-Objekte liegen und in denen die Stichprobe noch zu klein oder zu alt ist —
das Anfrage-Budget wandert damit dorthin, wo es die Aussage verbessert.

Kleinanzeigen zuerst, weil die Suche ohne Region-ID auskommt. Quellen mit
Bot-Schutz werden nicht abgerufen (siehe scrape_ladder.py); weitere Quellen
brauchen nur einen zusätzlichen Parser.
"""

import asyncio
import random

from prefect import flow, get_run_logger, task

from src.sources.kleinanzeigen_search import (
    folgeseiten_urls,
    ist_plausibel,
    parse_suchergebnis,
    such_url,
)
from src.storage.market import (
    ernte_ziele,
    markiere_verschwundene,
    upsert_market_comparables,
)
from src.utils.scrape_ladder import fetch_page_resilient
from src.utils.scrape_rate_limit import KONTINGENT_ERNTE, MIN_INTERVAL_SEC

# Die Signale "Marktlücke" und "Preislücke" verlangen n>=15 im Mikromarkt des
# Objekts. Eine Suche mit 20 km Radius liefert aber Treffer aus mehreren
# benachbarten Mikromärkten, die sich die Ausbeute teilen. Deshalb wird tief
# paginiert: eine Seite je Ziel füllte nur rund neun Anzeigen je Mikromarkt und
# hätte die Schwelle nie erreicht.
ZIEL_STICHPROBE = 150
SEITEN_MAX = 7

# Der Ernter läuft auf einem eigenen Stundenkontingent, damit eine Massenernte
# das Budget der nutzerausgelösten Custom-URL-Analyse nicht aufbraucht. Das
# Mindestintervall je Domain gilt trotzdem, deshalb die Pause; sie schützt das
# Portal, nicht uns. Ist auch das Ernte-Kontingent erschöpft, endet der Lauf
# sauber — der nächste setzt an derselben Stelle fort, weil die Zielauswahl
# nach kleinster Stichprobe sortiert.
PAUSE_SEK = (MIN_INTERVAL_SEC + 2, MIN_INTERVAL_SEC + 6)


class BudgetErschoepft(Exception):
    """Signalisiert dem Flow, dass das Stundenlimit der Domain erreicht ist."""


async def _abrufen(url: str) -> str | None:
    ergebnis = await fetch_page_resilient(url, kontingent=KONTINGENT_ERNTE)
    if ergebnis.success and ergebnis.raw_html:
        return ergebnis.raw_html
    if ergebnis.error_code == "SCRAPE_RATE_LIMITED":
        raise BudgetErschoepft(url)
    return None


@task(name="ernte-mikromarkt", retries=0)
async def ernte_mikromarkt(plz: str, kategorie: str, angebotstyp: str) -> int:
    logger = get_run_logger()

    einstieg = await _abrufen(such_url(plz, kategorie, angebotstyp, radius_km=20))
    if einstieg is None:
        logger.warning(f"Suche {plz} {kategorie}/{angebotstyp} nicht abrufbar")
        return 0

    gesammelt = [
        a for a in parse_suchergebnis(einstieg, kategorie, angebotstyp) if ist_plausibel(a)
    ]

    for url in folgeseiten_urls(einstieg, SEITEN_MAX):
        if len(gesammelt) >= ZIEL_STICHPROBE:
            break
        await asyncio.sleep(random.uniform(*PAUSE_SEK))
        weitere = await _abrufen(url)
        if weitere is None:
            break
        gesammelt.extend(
            a for a in parse_suchergebnis(weitere, kategorie, angebotstyp) if ist_plausibel(a)
        )

    geschrieben = await upsert_market_comparables(gesammelt)
    logger.info(
        f"{plz} {kategorie}/{angebotstyp}: {len(gesammelt)} verwertbar, {geschrieben} gespeichert"
    )
    return geschrieben


@flow(name="market-harvest", log_prints=True)
async def market_harvest_flow(maerkte: int = 10, angebotstypen: list[str] | None = None) -> dict:
    """
    `maerkte` begrenzt die Zahl der Mikromarkt-Kategorie-Kombinationen je Lauf.
    Der Standard ist am Ernte-Stundenkontingent bemessen; ein Radius von 20 km
    füllt ohnehin mehrere benachbarte Mikromärkte gleichzeitig, die Abdeckung
    wächst also schneller als die Zahl der abgefragten Ziele.
    """
    logger = get_run_logger()
    typen = angebotstypen or ["kauf", "miete"]

    ziele = await ernte_ziele(maerkte)
    logger.info(f"{len(ziele)} Mikromarkt-Kategorien in der Warteschlange")

    gesamt = 0
    budget_erschoepft = False
    abgeschlossen: list[tuple[str, str, str]] = []
    for ziel in ziele:
        if budget_erschoepft:
            break
        for angebotstyp in typen:
            try:
                gesamt += await ernte_mikromarkt(ziel["plz"], ziel["kategorie"], angebotstyp)
                abgeschlossen.append((str(ziel["mikromarkt"]), ziel["kategorie"], angebotstyp))
            except BudgetErschoepft:
                logger.info("Stundenlimit der Domain erreicht — Lauf endet hier")
                budget_erschoepft = True
                break
            await asyncio.sleep(random.uniform(*PAUSE_SEK))

    verschwunden = 0
    if abgeschlossen:
        verschwunden = await markiere_verschwundene(maerkte=abgeschlossen)
    logger.info(f"Ernte fertig: {gesamt} Angebote, {verschwunden} als verschwunden markiert")
    return {
        "gespeichert": gesamt,
        "verschwunden": verschwunden,
        "ziele": len(ziele),
        "budget_erschoepft": budget_erschoepft,
    }


if __name__ == "__main__":
    asyncio.run(market_harvest_flow())
