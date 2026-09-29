import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.utils.content_price import (  # noqa: E402
    angebotstyp_aus_text,
    preis_aus_text,
    preiszeile_aus_text,
)


def test_faellige_objekte_sql_is_public_live_only() -> None:
    src = (Path(__file__).resolve().parents[1] / "src/flows/market_recheck.py").read_text()
    assert "IN ('http', 'scrapling')" in src
    assert "lower(COALESCE(l.raw_data#>>'{scrape_metadata,session_cookie_used}', ''))" in src
    assert "NOT IN ('true', 't', '1')" in src
    assert "MANUAL_UPLOAD_HOST" in src
    assert "source_url NOT LIKE $3" in src
    assert "l.angebotstyp" in src
    assert "preis_aus_text(" in src
    assert "nachpruef_typ(" in src
    assert 'objekt.get("angebotstyp")' in src
    assert 'if angebotstyp not in ("kauf", "miete"):' in src
    content = (Path(__file__).resolve().parents[1] / "src/utils/content_price.py").read_text()
    assert "def nachpruef_typ(" in content
    assert "def angebotstyp_aus_text(" in content
    pruefe = src[src.index("async def pruefe_objekt") : src.index("async def market_recheck_flow")]
    assert "nachpruef_typ(gespeichert, text)" in pruefe
    typ = pruefe[pruefe.index("nachpruef_typ") :]
    assert typ.index('return "unklar"') < typ.index("preis_aus_text(text, angebotstyp)")
    assert typ.index('return "unklar"') < typ.index("schreibe_ereignis")
    assert "if typwechsel:" in pruefe
    assert pruefe.index("if typwechsel:") < pruefe.index("preis * 3")
    flip = pruefe[pruefe.index("if typwechsel:") : pruefe.index("preis * 3")]
    assert 'return "unklar"' in flip
    assert '"online", angebotstyp=angebotstyp' in flip
    assert "preis_gesenkt" not in flip
    schreibe = src[src.index("async def schreibe_ereignis") : src.index("async def pruefe_objekt")]
    assert "async with conn.transaction():" in schreibe
    assert schreibe.index("async with conn.transaction():") < schreibe.index(
        "INSERT INTO market_listing_events"
    )
    assert schreibe.index("INSERT INTO market_listing_events") < schreibe.index(
        "UPDATE real_estate_listings SET ist_aktiv"
    )
    assert "angebotstyp = COALESCE($3::text, angebotstyp)" in schreibe
    assert "WHEN COALESCE($3::text, angebotstyp) = 'miete'" in schreibe
    assert "THEN $2::integer" in schreibe
    assert "WHEN $3::text = 'kauf'" in schreibe
    assert "THEN NULL" in schreibe
    assert "ELSE kaltmiete_eur" in schreibe
    assert 'schreibe_ereignis(objekt["id"], preis, "online")' in pruefe
    assert 'schreibe_ereignis(objekt["id"], preis, status)' in pruefe


@pytest.mark.parametrize(
    "text,erwartet",
    [
        # ImmoScout stellt den Betrag vor die Beschriftung und den
        # Quadratmeterpreis direkt dahinter.
        ("789.000 €\nKaufpreis\n10.189 €/m²\n3,5\nZi.\n77,44 m²", 789_000),
        ("Kosten\nKaufpreis\n789.000 €\nPreis/m²\n10.189 €/m²", 789_000),
        ("Kaufpreis 285.000 €", 285_000),
        ("Kaufpreis 198'000 €", 198_000),
        ("Kaufpreis 198 000 €", 198_000),
        ("Kaltmiete 1.250 €", 1_250),
        ("Garage/ Stellplatz-Kaufpreis\n40.000 €", None),
        ("Hausgeld\n478 €", None),
        ("Kaution 2.500 €", None),
        ("Jahreskaltmiete 18.000 €", None),
        ("18.000 € / Jahr", None),
        ("Irgendein Betrag 99.000 € ohne Zusammenhang", None),
    ],
)
def test_preis_aus_text(text: str, erwartet: int | None) -> None:
    assert preis_aus_text(text) == erwartet


@pytest.mark.parametrize(
    "text,angebotstyp,erwartet",
    [
        ("Nettokaltmiete 850 €\nKaufpreis 789.000 €", "kauf", 789_000),
        ("Nettokaltmiete 850 €", "kauf", None),
        ("Kaufpreis 789.000 €", "miete", None),
        ("Kaltmiete 1.250 € pro Monat", "miete", 1_250),
        ("Preis 1.250 €", "miete", 1_250),
        ("Kaution 2.500 €\nKaltmiete 890 €", "miete", 890),
        ("Kaltmiete 850 €", "miete", 850),
        ("Jahreskaltmiete 18.000 €", "miete", None),
    ],
)
def test_preis_aus_text_respektiert_angebotstyp(
    text: str, angebotstyp: str, erwartet: int | None
) -> None:
    assert preis_aus_text(text, angebotstyp) == erwartet


def test_preis_aus_text_ohne_angebotstyp_mischt_kauf_und_miete_nicht() -> None:
    assert preis_aus_text("Nettokaltmiete 850 €\nKaufpreis 789.000 €") is None
    assert preis_aus_text("Kaufpreis 789.000 €\nKaltmiete 850 €") is None
    assert preis_aus_text("Kaufpreis 285.000 €") == 285_000
    assert preis_aus_text("Kaltmiete 1.250 €") == 1_250


def test_preiszeile_unterscheidet_kauf_und_miete() -> None:
    assert preiszeile_aus_text("Kaltmiete 1.250 €") == "Kaltmiete: 1250 €"
    assert preiszeile_aus_text("Kaufpreis 198.000 €") == "Kaufpreis: 198000 €"
    assert preiszeile_aus_text("Preis 198.000 €") == "Preis: 198000 €"


def test_preis_aus_text_fallback_nimmt_unbeschriftetes_badge() -> None:
    assert preis_aus_text("Wohnung 1.250 € zentral", "miete", nur_beschriftet=False) == 1_250
    assert (
        preis_aus_text("Hausgeld 478 €\nWohnung 1.250 €", "miete", nur_beschriftet=False) == 1_250
    )
    assert (
        preis_aus_text("Nettokaltmiete 850 €\n789.000 €", "kauf", nur_beschriftet=False) == 789_000
    )
    assert preis_aus_text("Kaufpreis 789.000 €", "miete", nur_beschriftet=False) is None


def test_ernte_ziele_priorisiert_duennere_miet_oder_kaufstichprobe() -> None:
    src = (Path(__file__).resolve().parents[1] / "src/storage/market.py").read_text()
    upsert = src[
        src.index("async def upsert_market_comparables") : src.index(
            "async def record_price_change"
        )
    ]
    assert "async with conn.transaction():" in upsert
    assert upsert.index("async with conn.transaction():") < upsert.index(
        "INSERT INTO market_comparables"
    )
    assert upsert.index("INSERT INTO market_comparables") < upsert.index(
        "INSERT INTO market_listing_events"
    )
    assert upsert.index("INSERT INTO market_listing_events") < upsert.index("geschrieben += 1")
    assert "ort = CASE" in upsert
    assert "kategorie = CASE" in upsert
    assert "ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.ort), ''), market_comparables.ort)" in upsert
    assert "ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.plz), ''), market_comparables.plz)" in upsert
    assert (
        "ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.mikromarkt), ''), market_comparables.mikromarkt)"
        in upsert
    )
    assert (
        "ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.kategorie), ''), market_comparables.kategorie)"
        in upsert
    )
    fn = src[src.index("async def ernte_ziele") : src.index("async def markiere_verschwundene")]
    assert "n_kauf" in fn
    assert "n_miete" in fn
    assert "LEAST(COALESCE(c.n_kauf, 0), COALESCE(c.n_miete, 0))" in fn
    assert "angebotstyp = 'kauf'" in fn
    assert "zuletzt_gesehen_am > NOW() - INTERVAL '120 days'" in fn
    assert "min(zuletzt_gesehen_am)" in fn
    assert "erfasst_am > NOW() - INTERVAL '120 days'" not in fn
    assert "WHERE ist_aktiv AND angebotstyp = 'kauf'" not in fn
    assert "left(l.plz, 3)" not in fn
    assert "regexp_replace(trim(coalesce(l.plz, '')), '[^0-9]', '', 'g')" in fn
    assert "'^[0-9]{5}$'" in fn
    assert "mode() WITHIN GROUP (ORDER BY digits)" in fn

    vanish = src[src.index("async def markiere_verschwundene") :]
    assert "async with conn.transaction():" in vanish
    assert vanish.index("async with conn.transaction():") < vanish.index(
        "UPDATE market_comparables"
    )
    assert vanish.index("UPDATE market_comparables") < vanish.index(
        "INSERT INTO market_listing_events"
    )
    assert "tage: int = 120" in vanish
    assert "maerkte: list[tuple[str, str, str]] | None = None" in vanish
    assert "if not maerkte:" in vanish
    assert "UNNEST($2::text[], $3::text[], $4::text[])" in vanish
    harvest = (Path(__file__).resolve().parents[1] / "src/flows/market_harvest.py").read_text()
    assert "if abgeschlossen:" in harvest
    assert "if not budget_erschoepft:" not in harvest
    assert "markiere_verschwundene(maerkte=abgeschlossen)" in harvest
    assert "markiere_verschwundene()" not in harvest


def test_angebotstyp_aus_text_nur_eindeutige_beschriftung() -> None:
    assert angebotstyp_aus_text("Kaufpreis 285.000 €") == "kauf"
    assert angebotstyp_aus_text("Kaltmiete 1.250 €") == "miete"
    assert angebotstyp_aus_text("Nettokaltmiete 850 €\nKaufpreis 789.000 €") is None
    assert angebotstyp_aus_text("Wohnung 1.250 € zentral") is None


def test_nachpruef_typ_flip_nur_bei_eindeutigem_signal() -> None:
    from src.utils.content_price import nachpruef_typ

    assert nachpruef_typ("kauf", "Kaltmiete 850 €") == ("miete", True)
    assert nachpruef_typ("miete", "Kaufpreis 250.000 €") == ("kauf", True)
    assert nachpruef_typ("kauf", "Kaufpreis 250.000 €") == ("kauf", False)
    assert nachpruef_typ("kauf", "Wohnung zentral") == ("kauf", False)
    assert nachpruef_typ("miete", "Nettokaltmiete 850 €\nKaufpreis 789.000 €") == (
        "miete",
        False,
    )
    assert nachpruef_typ(None, "Kaufpreis 250.000 €") == ("kauf", False)
    assert nachpruef_typ("", "Kaltmiete 1.250 €") == ("miete", False)
    assert nachpruef_typ(None, "Wohnung zentral") == (None, False)
    assert nachpruef_typ("sonstiges", "Wohnung zentral") == (None, False)


def test_typwechsel_preis_wird_nicht_am_alten_kaufpreis_gemessen() -> None:
    assert preis_aus_text("Kaltmiete 850 €", "miete") == 850
    alt_kauf = 250_000
    miete = 850
    assert miete * 3 < alt_kauf
