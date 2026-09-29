"""
Parser für Kleinanzeigen-Suchergebnisseiten.

Liefert Vergleichsangebote für market_comparables. Bewusst getrennt vom
Custom-URL-Pfad in src/api/app.py: dort wird ein einzelnes Exposé per LLM
ausgewertet, hier werden Dutzende Treffer je Seite rein aus dem Markup
gelesen. Ein LLM-Call je Vergleichsangebot wäre bei einigen tausend Anzeigen
je Vollauffrischung weder bezahlbar noch nötig — die Suchergebnisliste trägt
Preis, Fläche, Zimmer und PLZ bereits strukturiert.

Kleinanzeigen zuerst, weil die Suche ohne Region-ID auskommt: das Formular
unter /s-suchanfrage.html löst eine reine PLZ zur kanonischen Such-URL auf.
"""

import html
import re
from dataclasses import dataclass

from loguru import logger

QUELLE = "kleinanzeigen.de"

# Kategorie-IDs der Kleinanzeigen-Immobiliensuche, empirisch über die
# Weiterleitung von /s-suchanfrage.html bestimmt.
KATEGORIE_IDS: dict[tuple[str, str], int] = {
    ("haus", "kauf"): 208,
    ("haus", "miete"): 205,
    ("wohnung", "kauf"): 196,
    ("wohnung", "miete"): 203,
}
KATEGORIE_BY_ID: dict[int, tuple[str, str]] = {vid: key for key, vid in KATEGORIE_IDS.items()}
_HREF_KATEGORIE = re.compile(r"-(\d+)-(\d+)(?:[/?#]|$)")


def href_kategorie(href: str) -> tuple[str, str] | None:
    treffer = _HREF_KATEGORIE.search(href)
    if not treffer:
        return None
    return KATEGORIE_BY_ID.get(int(treffer.group(1)))


@dataclass(slots=True)
class MarktAngebot:
    quelle: str
    externe_id: str
    url: str
    angebotstyp: str
    kategorie: str
    titel: str | None
    plz: str
    ort: str | None
    wohnflaeche_m2: float | None
    zimmer: float | None
    preis_eur: int | None

    @property
    def mikromarkt(self) -> str:
        return self.plz[:3]

    @property
    def preis_pro_m2(self) -> float | None:
        if not self.preis_eur or not self.wohnflaeche_m2 or self.wohnflaeche_m2 <= 0:
            return None
        return round(self.preis_eur / self.wohnflaeche_m2, 2)


def such_url(plz: str, kategorie: str, angebotstyp: str, radius_km: int) -> str:
    """
    Sucheinstieg über das Formular. Der Umweg lohnt sich, weil Kleinanzeigen
    hier eine reine PLZ akzeptiert und selbst zur kanonischen URL mit der
    internen Orts-ID weiterleitet — sonst bräuchten wir ein eigenes Verzeichnis
    dieser IDs.
    """
    kategorie_id = KATEGORIE_IDS[(kategorie, angebotstyp)]
    return (
        "https://www.kleinanzeigen.de/s-suchanfrage.html"
        f"?categoryId={kategorie_id}&locationStr={plz}&radius={radius_km}"
    )


_FOLGESEITE = re.compile(r'href="(/s-[^"]*?/seite:(\d+)/[^"]*?)"')


def folgeseiten_urls(seite_html: str, bis_seite: int) -> list[str]:
    """
    Die kanonischen Links der Trefferliste statt selbst konstruierter
    Seitenparameter: ein `pageNum` am Formular-Einstieg verliert die Seitenzahl
    beim Redirect und liefert wieder Seite 1.
    """
    gefunden: dict[int, str] = {}
    for pfad, nummer in _FOLGESEITE.findall(seite_html):
        seite = int(nummer)
        if 2 <= seite <= bis_seite:
            gefunden.setdefault(seite, f"https://www.kleinanzeigen.de{pfad}")
    return [gefunden[seite] for seite in sorted(gefunden)]


# Ausgewertet wird der sichtbare Text je Karte, nicht die Klassenstruktur:
# Kleinanzeigen liefert je nach Client zwei verschiedene Layouts aus (klassisch
# mit .aditem-Klassen, neu mit Utility-Klassen). Nur data-adid, data-href und
# die Textform der Werte sind in beiden identisch.
_BLOCK_TRENNER = re.compile(r'data-adid="')
_HREF = re.compile(r'data-href="([^"]+)"')
_SCRIPT = re.compile(r"<script.*?</script>", re.S)
_SVG = re.compile(r"<svg.*?</svg>", re.S)
_TEXTKNOTEN = re.compile(r">([^<>]+)<")
_ORT = re.compile(r"^(\d{5})\s+([^(]+)")
_TAGS = re.compile(r"^([\d.,]+)\s*m²(?:\s*·\s*([\d.,]+)\s*Zi)?")
_PREIS = re.compile(r"^([\d.]+)\s*€")
_LD_TITEL = re.compile(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)"')


def _zahl(text: str) -> float | None:
    """Deutsche Zahlnotation: Punkt gruppiert Tausender, Komma trennt Dezimalen."""
    bereinigt = text.replace(".", "").replace(",", ".")
    try:
        return float(bereinigt)
    except ValueError:
        return None


def _textknoten(block: str) -> list[str]:
    ohne_skript = _SVG.sub("", _SCRIPT.sub("", block))
    knoten = (
        re.sub(r"\s+", " ", html.unescape(text)).strip()
        for text in _TEXTKNOTEN.findall(ohne_skript)
    )
    return [text for text in knoten if text]


def parse_suchergebnis(seite_html: str, kategorie: str, angebotstyp: str) -> list[MarktAngebot]:
    angebote: list[MarktAngebot] = []

    for block in _BLOCK_TRENNER.split(seite_html)[1:]:
        externe_id = block.split('"', 1)[0]
        if not externe_id.isdigit():
            continue

        plz = ort = None
        flaeche = zimmer = preis = None
        for text in _textknoten(block):
            if plz is None and (treffer := _ORT.match(text)):
                plz, ort = treffer.group(1), treffer.group(2).strip()
            elif flaeche is None and (treffer := _TAGS.match(text)):
                flaeche, zimmer = treffer.group(1), treffer.group(2)
            elif preis is None and (treffer := _PREIS.match(text)):
                preis = treffer.group(1)

        if plz is None:
            continue

        href = _HREF.search(block)
        if href:
            karten_typ = href_kategorie(href.group(1))
            if karten_typ is not None and karten_typ != (kategorie, angebotstyp):
                continue
        titel = _LD_TITEL.search(block)
        angebote.append(
            MarktAngebot(
                quelle=QUELLE,
                externe_id=externe_id,
                url=(
                    f"https://www.kleinanzeigen.de{href.group(1)}"
                    if href
                    else f"https://www.kleinanzeigen.de/s-anzeige/{externe_id}"
                ),
                angebotstyp=angebotstyp,
                kategorie=kategorie,
                titel=titel.group(1) if titel else None,
                plz=plz,
                ort=ort,
                wohnflaeche_m2=_zahl(flaeche) if flaeche else None,
                zimmer=_zahl(zimmer) if zimmer else None,
                preis_eur=int(_zahl(preis) or 0) or None if preis else None,
            )
        )

    verwertbar = [a for a in angebote if a.preis_pro_m2 is not None]
    logger.info(
        f"Kleinanzeigen-Suchergebnis: {len(angebote)} Treffer, "
        f"{len(verwertbar)} mit Preis und Fläche"
    )
    return angebote


def ist_plausibel(angebot: MarktAngebot) -> bool:
    """
    Grobfilter gegen offensichtliche Fehleingaben, bevor eine Anzeige in den
    Median eingeht. Bewusst weit gefasst: der Median ist robust, aber eine
    Wohnung für 1 € oder mit 5 m² verzerrt die Stichprobengröße und damit die
    Aussage "belastbar ab n>=15".
    """
    if angebot.preis_pro_m2 is None or angebot.wohnflaeche_m2 is None:
        return False
    # Eine Flächenangabe ohne Zimmerzahl ist auf Kleinanzeigen in der Regel die
    # Grundstücksfläche: ein Grundstücksangebot mit 859 m² erschien so als Haus
    # für 988 €/m² und riss den Median seines Mikromarkts mit nach unten.
    if angebot.zimmer is None:
        return False
    if angebot.wohnflaeche_m2 < 15 or angebot.wohnflaeche_m2 > 1_000:
        return False
    if angebot.angebotstyp == "kauf":
        return 200 <= angebot.preis_pro_m2 <= 25_000
    return 2 <= angebot.preis_pro_m2 <= 60
