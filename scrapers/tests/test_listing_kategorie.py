from bs4 import BeautifulSoup

from src.sources.hanmark import _detect_kategorie as hanmark_kategorie
from src.sources.hanmark import _parse_euro as hanmark_parse_euro
from src.sources.zvg_com import _detect_kategorie as zvg_com_kategorie
from src.sources.zvg_portal import BASE_URL
from src.sources.zvg_portal import _detect_kategorie as portal_kategorie
from src.sources.zvg_portal import _parse_euro as portal_parse_euro
from src.sources.zvg_portal import _parse_objekte_from_soup
from src.sources.zvg_portal import _split_objekt_lage
from src.sources.zvg_portal import is_portal_detail_url
from src.utils.listing_kategorie import detect_listing_kategorie


def test_split_objekt_lage_keeps_typ_when_it_starts_with_a_digit():
    typ, adresse = _split_objekt_lage("2-Zimmer-Wohnung, Musterstr. 1, 80331 München")
    assert typ == "2-Zimmer-Wohnung"
    assert adresse == "Musterstr. 1, 80331 München"
    assert portal_kategorie(typ) == "wohnung"


def test_split_objekt_lage_plain_typ_and_plz():
    typ, adresse = _split_objekt_lage("Einfamilienhaus, 80331 München")
    assert typ == "Einfamilienhaus"
    assert adresse == "80331 München"
    assert portal_kategorie(typ) == "haus"


def test_split_objekt_lage_without_comma_uses_full_string_as_typ():
    typ, adresse = _split_objekt_lage("2-Zimmer-Wohnung")
    assert typ == "2-Zimmer-Wohnung"
    assert adresse == "2-Zimmer-Wohnung"
    assert portal_kategorie(typ) == "wohnung"


def test_hanmark_does_not_map_stellplatz_to_wohnung():
    assert hanmark_kategorie("Tiefgaragenstellplatz") is None
    assert hanmark_kategorie("3-Zimmer-Wohnung") == "wohnung"


def test_zvg_com_does_not_map_zimmer_in_house_titles_to_wohnung():
    assert zvg_com_kategorie("Einfamilienhaus, 5 Zimmer") == "haus"
    assert zvg_com_kategorie("3-Zimmer-Wohnung") == "wohnung"
    assert zvg_com_kategorie("Hotelzimmer") is None


def test_kategorie_detection_is_shared_across_sources():
    cases = {
        "Erbbaurecht an einem Grundstück": "grundstueck",
        "Land-/forstwirtschaftliche Fläche": "grundstueck",
        "Anwesen mit Nebengebäuden": "haus",
        "Resthof": "haus",
        "Ruine eines Bauernhauses": "haus",
        "Urlaubsland": None,
        "Freilandhaltung": None,
        "Hotelzimmer": None,
        "3-Zimmer-Wohnung": "wohnung",
        "Apartment": "wohnung",
        "Einfamilienhaus, 5 Zimmer": "haus",
        "Tiefgaragenstellplatz": None,
        "Wohn-/Geschäftshaus": "gewerbe",
        "Geschäftshaus Friedrichstraße": "gewerbe",
        "Mehrfamilienhaus mit Laden": "haus",
    }
    for typ, expected in cases.items():
        assert detect_listing_kategorie(typ) == expected
        assert portal_kategorie(typ) == expected
        assert hanmark_kategorie(typ) == expected
        assert zvg_com_kategorie(typ) == expected


def test_hanmark_parse_euro_does_not_concatenate_teilobjekt_digits():
    text = "Lfd. Nr. 1 - 114.000,00 Euro Lfd. Nr. 2 - 3.700,00 Euro"
    assert portal_parse_euro(text) == 114_000
    assert hanmark_parse_euro(text) == 114_000
    assert portal_parse_euro("Gesamtwert: 544.000,00 €") == 544_000
    assert hanmark_parse_euro("70.000,00 EUR") == 70_000
    assert hanmark_parse_euro is portal_parse_euro


def test_portal_detail_url_requires_showzvg_and_id():
    assert is_portal_detail_url(f"{BASE_URL}/index.php?button=showZvg&zvg_id=99&land_abk=by")
    assert not is_portal_detail_url(f"{BASE_URL}/index.php?button=Termine+suchen&land_abk=by")
    assert not is_portal_detail_url(f"{BASE_URL}/index.php?button=Suchen")
    assert not is_portal_detail_url(None)


def test_portal_grid_without_showzvg_does_not_use_search_as_direktlink():
    html = """
    <table>
      <tr><td>Aktenzeichen</td><td>0021 K 0024/2025</td></tr>
      <tr><td>Objekt/Lage</td><td>Einfamilienhaus, 80331 München</td></tr>
      <tr><td>Verkehrswert</td><td>250.000,00 €</td></tr>
    </table>
    """
    listings = _parse_objekte_from_soup(
        BeautifulSoup(html, "html.parser"), "bayern", "Bayern", "by"
    )
    assert len(listings) == 1
    assert listings[0].direktlink is None
    assert "Termine+suchen" in (listings[0].source_url or "")


def test_portal_grid_with_showzvg_keeps_detail_link():
    html = """
    <table>
      <tr><td>Aktenzeichen</td><td>
        <a href="index.php?button=showZvg&amp;zvg_id=99&amp;land_abk=by">0021 K 0024/2025</a>
      </td></tr>
      <tr><td>Objekt/Lage</td><td>Einfamilienhaus, 80331 München</td></tr>
    </table>
    """
    listings = _parse_objekte_from_soup(
        BeautifulSoup(html, "html.parser"), "bayern", "Bayern", "by"
    )
    assert len(listings) == 1
    assert listings[0].direktlink == (f"{BASE_URL}/index.php?button=showZvg&zvg_id=99&land_abk=by")
    assert listings[0].direktlink == listings[0].source_url
