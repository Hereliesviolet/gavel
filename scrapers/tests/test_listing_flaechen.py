from src.utils.listing_flaechen import extract_flaechen_from_text, parse_de_area

FRIEDRICHSTRASSE = (
    'Es handelt sich um die als "Quartier 206 der Friedrichstadt-Passagen" bekannte, '
    "mehrgeschossige Einkaufspassage mit Ladeneinheiten (Einzelhandelsflächen) nebst "
    "darüber liegenden Büro-/Praxisetagen sowie 11 Wohnungen. Die Nutzflächen "
    "betragen: ca. 8.110 m² Einzelhandelsflächen, ca. 15.125 m² Büro-/ Praxisflächen, "
    "ca. 940 m² Lagerflächen, ca. 1.270 m² Wohnflächen. Die zwei Tiefgaragen-Ebenen "
    "verfügen über 262 Pkw-Stellplätze. Baujahr des Gebäudes: 1996."
)

EISLINGEN = (
    "Das UG verfügt über ca. 26 m² Wohnfläche sowie ca. 33 m² Kellerräume. "
    "Das EG umfasst ca. 75 m² Wohnfläche. Das DG umfasst ca. 65 m² Wohnfläche."
)

ZINGST = (
    "WE 1 (EG, 49 m²), WE 2 (EG, 45,39 m²), WE 3 (OG, 44,85 m²), "
    "WE 4 (EG, 79,74 m²) und WE 5 (OG, 66,61 m²)"
)


def test_parse_de_area_thousands_and_decimals():
    assert parse_de_area("8.110") == 8110
    assert parse_de_area("15.125") == 15125
    assert parse_de_area("1.270") == 1270
    assert parse_de_area("45,39") == 45.39
    assert parse_de_area("45.39") == 45.39
    assert parse_de_area("940") == 940


def test_friedrichstrasse_sums_nutzflaeche_keeps_wohnanteil():
    got = extract_flaechen_from_text(FRIEDRICHSTRASSE)
    assert got["nutzflaeche_m2"] == 25445
    assert got["wohnflaeche_m2"] == 1270


def test_eislingen_sums_wohnflaeche_skips_keller():
    got = extract_flaechen_from_text(EISLINGEN)
    assert got["wohnflaeche_m2"] == 166
    assert "nutzflaeche_m2" not in got


def test_zingst_sums_we_wohnflaechen():
    got = extract_flaechen_from_text(ZINGST)
    assert got["wohnflaeche_m2"] == 285.59


def test_single_wohnflaeche_unchanged():
    got = extract_flaechen_from_text("Einfamilienhaus mit ca. 128 m² Wohnfläche.")
    assert got["wohnflaeche_m2"] == 128


def test_gesamt_wohnflaeche_schlaegt_etagensumme():
    got = extract_flaechen_from_text(
        "EG: Wohnfläche ca. 92,98 m²; DG: Wohnfläche ca. 66,33 m²; Gesamt-Wohnfläche ca. 159,31 m²."
    )
    assert got["wohnflaeche_m2"] == 159.31


def test_doppelte_beschreibung_zaehlt_wohnflaeche_einmal():
    got = extract_flaechen_from_text(
        "Wohnfläche ca. 251 m², Grundstücksgröße 1337 m²\n"
        "Wohnfläche ca. 251 m², Grundstücksgröße 1337 m²"
    )
    assert got["wohnflaeche_m2"] == 251


def test_grundstueck_nicht_als_wohnflaeche():
    got = extract_flaechen_from_text("Grundstücksgröße:435 m²\nWohnfläche insg. ca. 190m²")
    assert got["wohnflaeche_m2"] == 190
    got = extract_flaechen_from_text("Grundstück zur Größe von 1.107 m² Wohnfläche ca. 150 m²")
    assert got["wohnflaeche_m2"] == 150
