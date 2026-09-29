from src.utils.terminsbestimmung import parse_terminsbestimmung


def test_liest_geringstes_gebot():
    text = (
        "Terminsbestimmung. Der Verkehrswert wurde auf 180.000,00 € festgesetzt. "
        "Das geringste Gebot beträgt 45.750,00 €."
    )
    daten = parse_terminsbestimmung(text)
    assert daten.geringstes_gebot_eur == 45750


def test_erkennt_dass_keine_rechte_bestehen_bleiben():
    text = (
        "Das geringste Gebot beträgt 30.000 €. Rechte, die dem Anspruch des "
        "Gläubigers vorgehen, bestehen nicht und bleiben nicht bestehen."
    )
    daten = parse_terminsbestimmung(text)
    assert daten.bestehende_rechte_eur == 0


def test_liest_kapitalwert_bestehenbleibender_rechte():
    text = (
        "Das geringste Gebot beträgt 62.000 €. In das geringste Gebot fällt ein "
        "Wohnungsrecht, das bestehen bleibt, mit einem Kapitalwert von 18.400 €."
    )
    daten = parse_terminsbestimmung(text)
    assert daten.bestehende_rechte_eur == 18400
    assert "bestehen" in (daten.bestehende_rechte_text or "")


def test_raet_nichts_wenn_nichts_dasteht():
    daten = parse_terminsbestimmung("Versteigerungstermin am 14.09.2026. Verkehrswert 120.000 €.")
    assert daten.geringstes_gebot_eur is None
    assert daten.bestehende_rechte_eur is None
    assert not daten.brauchbar


def test_verwirft_unplausible_betraege():
    daten = parse_terminsbestimmung("Das geringste Gebot beträgt 12 €.")
    assert daten.geringstes_gebot_eur is None
