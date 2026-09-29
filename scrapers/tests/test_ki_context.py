from src.utils.ki_context import (
    BASIC_CONTEXT_CHARS,
    FULL_CONTEXT_CHARS,
    build_analysis_context,
    paragraph_relevance_score,
    select_relevant_paragraphs,
)


def _long_boilerplate() -> str:
    return (
        "Dieses Gutachten wurde urheberrechtlich geschützt erstellt.\n\n"
        "Alle Angaben ohne Gewähr.\n\n"
        "Seite 3 von 80\n\n"
    )


def _gutachten() -> str:
    filler = "Allgemeine Verfahrensbeschreibung ohne Objektdaten. " * 40
    return "\n\n".join(
        [
            _long_boilerplate() + "Objekt: Zweifamilienhaus in Beispielstadt, Baujahr 1972.",
            "Das Verfahren folgt den üblichen Gutachtenrichtlinien und beschreibt die Methodik ausführlich. "
            * 20,
            filler,
            "Grundbuch von Beispielstadt Blatt 1234, Gemarkung Nord, Flurstück 12/3.",
            "Die Wohnfläche beträgt 118 m², das Grundstück 420 m², 5 Zimmer.",
            "Mängel: Feuchtigkeit im Keller, undichtes Dach, Schimmel im Bad.",
            "Energieausweis Klasse F, Heizung Öl, Baujahr der Anlage 1994.",
            "Abteilung II: Wegerecht zugunsten des Nachbarn. Baulasten sind eingetragen.",
            "Die örtliche Lage ist ruhig, Anbindung an den ÖPNV ist mittelmäßig.",
            "Methodik der Wertermittlung nach ImmoWertV, lange Erläuterung. " * 25,
            "Verkehrswert zum Stichtag 240.000 EUR. Zusammenfassung der Wertermittlung.",
        ]
    )


def test_relevance_scores_object_facts_higher_than_method_filler():
    facts = "Grundbuch Blatt 12, Wohnfläche 90 m², Mängel Feuchtigkeit, Energieklasse G"
    filler = "Allgemeine Verfahrensbeschreibung ohne Objektdaten und ohne Zahlen."
    assert paragraph_relevance_score(facts) > paragraph_relevance_score(filler)


def test_select_relevant_paragraphs_keeps_head_facts_and_value():
    paragraphs = [
        "Objektkopf: Einfamilienhaus in Nordstadt.",
        "Zweiter Einleitungssatz zum Objekt.",
        "Lange Methodik ohne Bezug zum Gebäude " * 20,
        "Mängel: undichtes Dach und Feuchtigkeit im Keller.",
        "Noch mehr Methodik " * 20,
        "Verkehrswert 180.000 EUR. Zusammenfassung der Wertermittlung.",
    ]
    kept = select_relevant_paragraphs(paragraphs, budget=900)
    joined = "\n".join(kept)
    assert "Objektkopf" in joined
    assert "Mängel" in joined
    assert "Verkehrswert" in joined
    assert "Lange Methodik" not in joined
    assert len(joined) <= 900


def test_basic_context_stays_within_8k_and_drops_filler():
    context = build_analysis_context(
        {
            "aktenzeichen": "1 K 1/26",
            "beschreibung": "Kurzbeschreibung eines Wohnhauses in der Innenstadt mit Garten.",
        },
        gutachten_text=_gutachten(),
        expose_text="Exposé wiederholt die Wohnfläche 118 m².",
        tier="basic",
    )
    assert len(context) <= BASIC_CONTEXT_CHARS
    assert "Grundbuch" in context
    assert "Mängel" in context
    assert "Verkehrswert" in context
    assert "Verfahrensbeschreibung" not in context


def test_full_context_cap_is_higher_but_still_bounded():
    huge = _gutachten() + "\n\n" + ("Weitere irrelevante Methodik. " * 400)
    basic = build_analysis_context({"aktenzeichen": "1 K 2/26"}, huge, tier="basic")
    full = build_analysis_context({"aktenzeichen": "1 K 2/26"}, huge, tier="full")
    assert len(basic) <= BASIC_CONTEXT_CHARS
    assert len(full) <= FULL_CONTEXT_CHARS
    assert len(full) >= len(basic)
    assert "Grundbuch" in full
    assert "Verkehrswert" in full
