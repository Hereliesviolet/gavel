import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.sources.kleinanzeigen_search import (  # noqa: E402
    folgeseiten_urls,
    href_kategorie,
    ist_plausibel,
    parse_suchergebnis,
)

KARTE = """
<li data-adid="3464212773" data-href="/s-anzeige/reihenhaus/3464212773-208-1234">
  <script type="application/ld+json">{"title":"Charmantes Mittelreihenhaus"}</script>
  <div><span>23611 Bad Schwartau</span><span>(2 km)</span></div>
  <p>TAGS</p>
  <p>229.000 €</p>
</li>
"""


def _karte(tags: str) -> str:
    return KARTE.replace("TAGS", tags)


def test_parst_wohnflaeche_zimmer_preis_und_plz() -> None:
    (angebot,) = parse_suchergebnis(_karte("115 m² · 5 Zi."), "haus", "kauf")
    assert angebot.plz == "23611"
    assert angebot.ort == "Bad Schwartau"
    assert angebot.wohnflaeche_m2 == 115
    assert angebot.zimmer == 5
    assert angebot.preis_eur == 229_000
    assert angebot.mikromarkt == "236"
    assert angebot.url.endswith("3464212773-208-1234")
    assert ist_plausibel(angebot)


def test_verwirft_flaeche_ohne_zimmerzahl() -> None:
    """Ohne Zimmerzahl ist die Fläche meist das Grundstück, nicht der Wohnraum."""
    (angebot,) = parse_suchergebnis(_karte("859 m²"), "haus", "kauf")
    assert angebot.wohnflaeche_m2 == 859
    assert angebot.zimmer is None
    assert not ist_plausibel(angebot)


def test_href_kategorie_liest_kleinanzeigen_id() -> None:
    assert href_kategorie("/s-anzeige/reihenhaus/3464212773-208-1234") == ("haus", "kauf")
    assert href_kategorie("/s-anzeige/wohnung/1-203-99") == ("wohnung", "miete")
    assert href_kategorie("/s-anzeige/ohne-kategorie/123") is None


def test_verwirft_karte_mit_anderer_kategorie() -> None:
    miete = KARTE.replace("3464212773-208-1234", "3464212773-205-1234")
    wohnung = KARTE.replace("3464212773-208-1234", "3464212773-196-1234")
    assert parse_suchergebnis(miete, "haus", "kauf") == []
    assert parse_suchergebnis(wohnung, "haus", "kauf") == []
    (angebot,) = parse_suchergebnis(miete, "haus", "miete")
    assert angebot.angebotstyp == "miete"
    assert angebot.kategorie == "haus"


def test_folgeseiten_nur_bis_zur_grenze() -> None:
    seite = (
        '<a href="/s-immobilien/seite:2/c208l1234"></a>'
        '<a href="/s-immobilien/seite:3/c208l1234"></a>'
        '<a href="/s-immobilien/seite:9/c208l1234"></a>'
    )
    urls = folgeseiten_urls(seite, bis_seite=3)
    assert [u.rsplit("/", 2)[-2] for u in urls] == ["seite:2", "seite:3"]
