from bs4 import BeautifulSoup

from src.utils.content_slicer import _generic_heuristic, _json_ld_price_snippet


def test_generic_heuristic_skips_nebenkosten():
    soup = BeautifulSoup(
        "<h1>Wohnung</h1><span>Nebenkosten 350 €</span><p>Lange Beschreibung "
        + ("x" * 50)
        + "</p>",
        "html.parser",
    )
    text = _generic_heuristic(soup)
    assert text is not None
    assert "Preis: 350" not in text


def test_generic_heuristic_takes_labeled_rent():
    soup = BeautifulSoup(
        "<h1>Wohnung</h1><span>Kaltmiete 1.250 €</span>",
        "html.parser",
    )
    text = _generic_heuristic(soup)
    assert text is not None
    assert "Kaltmiete: 1250 €" in text
    assert "Preis: 1250" not in text


def test_generic_heuristic_labels_kaufpreis():
    soup = BeautifulSoup(
        "<h1>Haus</h1><span>Kaufpreis 198.000 €</span>",
        "html.parser",
    )
    text = _generic_heuristic(soup)
    assert text is not None
    assert "Kaufpreis: 198000 €" in text


def test_json_ld_skips_chf_and_yearly_rent():
    chf = BeautifulSoup(
        """<script type="application/ld+json">
        {"name":"Haus","offers":{"price":890000,"priceCurrency":"CHF"}}
        </script>""",
        "html.parser",
    )
    assert _json_ld_price_snippet(chf) is None

    yearly = BeautifulSoup(
        """<script type="application/ld+json">
        {"name":"Wohnung","offers":{"price":18000,"priceCurrency":"EUR","unitText":"YEAR"}}
        </script>""",
        "html.parser",
    )
    assert _json_ld_price_snippet(yearly) is None


def test_json_ld_accepts_eur_without_unit():
    soup = BeautifulSoup(
        """<script type="application/ld+json">
        {"name":"Wohnung","offers":{"price":198000,"priceCurrency":"EUR"}}
        </script>""",
        "html.parser",
    )
    text = _json_ld_price_snippet(soup)
    assert text is not None
    assert "Preis: 198000 EUR" in text
    assert "Titel: Wohnung" in text


def test_json_ld_labels_monthly_rent_and_prefers_sale():
    monthly = BeautifulSoup(
        """<script type="application/ld+json">
        {"name":"Wohnung","offers":{"price":1250,"priceCurrency":"EUR","unitText":"MONTH"}}
        </script>""",
        "html.parser",
    )
    text = _json_ld_price_snippet(monthly)
    assert text is not None
    assert "Kaltmiete: 1250 EUR" in text
    assert "Preis: 1250" not in text

    mixed = BeautifulSoup(
        """<script type="application/ld+json">
        {"@graph":[
          {"@type":"RentAction","name":"Wohnung","offers":{"price":1250,"priceCurrency":"EUR"}},
          {"@type":"RealEstateListing","name":"Wohnung","offers":{"price":198000,"priceCurrency":"EUR"}}
        ]}
        </script>""",
        "html.parser",
    )
    text = _json_ld_price_snippet(mixed)
    assert text is not None
    assert "Preis: 198000 EUR" in text
    assert "1250" not in text


def test_json_ld_reads_graph_and_skips_addon_offer():
    soup = BeautifulSoup(
        """<script type="application/ld+json">
        {"@graph":[
          {"@type":"WebSite","name":"Portal"},
          {"@type":"Offer","name":"Stellplatz","price":15000,"priceCurrency":"EUR"},
          {"@type":"RealEstateListing","name":"Wohnung","offers":{"price":198000,"priceCurrency":"EUR"}}
        ]}
        </script>""",
        "html.parser",
    )
    text = _json_ld_price_snippet(soup)
    assert text is not None
    assert "Preis: 198000 EUR" in text
    assert "15000" not in text
