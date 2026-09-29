from src.utils.data_quality import check_verkehrswert


def test_quartier_206_gewerbe_ist_plausibel():
    flags = check_verkehrswert(
        {
            "kategorie": "gewerbe",
            "verkehrswert": 187_000_000,
            "wohnflaeche_m2": 1270,
            "nutzflaeche_m2": 25445,
        }
    )
    assert flags == []


def test_wohnflaeche_allein_flaggt_quartier_206():
    flags = check_verkehrswert(
        {
            "kategorie": "haus",
            "verkehrswert": 187_000_000,
            "wohnflaeche_m2": 1270,
        }
    )
    reasons = {f.reason for f in flags}
    assert "outside_absolute_range" in reasons
    assert "eur_pro_m2_outside_range" in reasons
