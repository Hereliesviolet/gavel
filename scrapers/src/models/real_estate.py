"""
Pydantic-Modelle für die Custom-URL-Analyse (Baustein 3 der Firecrawl-
Migration, siehe docs/CUSTOM_URL_ANALYSIS.md).

BEWUSST getrennt von src/models/zvg.py: andere Domäne (frei eingereichte
Markt-Exposés statt Zwangsversteigerungs-Gutachten). KIAnalyseResult bleibt
unverändert und wird hier NICHT zweckentfremdet.

Paritätsziel (docs/CUSTOM_URL_ANALYSIS.md): dieselben Objekt-/Zustands-/Lage-/
Energie-/Ertrags-/Investment-Infos wie ZVG, soweit aus Anzeigentext seriös
ableitbar. Fehlend → null/leere Liste — NIE halluzinieren.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class CustomListingExtraction(BaseModel):
    """Generische Struktur-Extraktion aus einer beliebigen Immobilien-Anzeige-
    URL (ImmoScout24, eBay Kleinanzeigen, Immowelt, beliebige weitere
    Makler-/Portal-Website, ...)."""

    seiteninhalt_erkannt: Literal["immobilienangebot", "kein_immobilienangebot", "unklar"] = Field(
        "unklar",
        description="Klassifiziere den Seiteninhalt: 'immobilienangebot' nur wenn klar erkennbar "
        "eine einzelne Immobilien-Anzeige (Kauf/Miete) vorliegt, 'kein_immobilienangebot' wenn die "
        "Seite klar etwas anderes ist (z.B. Suchergebnisliste, News-Artikel, Startseite, "
        "Fehlerseite/Bot-Wall-Hinweis), sonst 'unklar'.",
    )
    titel: Optional[str] = None
    typ: Optional[str] = Field(None, description="Objekttyp, z.B. 'Wohnung', 'Haus', 'Reihenhaus'")
    angebotstyp: Optional[Literal["miete", "kauf"]] = Field(
        None,
        description="'miete' bei Mietangeboten, 'kauf' bei Kaufangeboten. "
        "null falls aus dem Text nicht eindeutig erkennbar.",
    )
    preis: Optional[float] = Field(
        None,
        description="Kaufpreis oder Kaltmiete in EUR (nicht CHF/andere Währung umrechnen). "
        "Kaltmiete immer als Monatswert, nie Jahreskaltmiete/Jahresmiete. "
        "Tausender als Punkt, Apostroph oder Leerzeichen, Komma als Dezimaltrennzeichen, "
        "z.B. '198.000 €', '198'000 €', '198 000 €' oder '198.000,00 €' -> 198000. "
        "Steht meist prominent direkt unter Titel/Bildergalerie als Preis-Badge, "
        "manchmal auch erst in einer Objekt-Detailtabelle unter "
        "'Kaufpreis'/'Preis'/'Miete'.",
    )
    flaeche_m2: Optional[float] = None
    grundstuecksflaeche_m2: Optional[float] = Field(
        None, description="Grundstücksfläche in m², nur wenn explizit genannt"
    )
    nutzflaeche_m2: Optional[float] = Field(
        None, description="Nutzfläche in m², nur wenn explizit und getrennt von Wohnfläche genannt"
    )
    zimmer: Optional[float] = None
    etage: Optional[str] = Field(
        None, description="Etage als Freitext, z.B. '3', 'EG', '1. OG', 'DG'"
    )
    anzahl_etagen: Optional[int] = Field(
        None, description="Anzahl Etagen des Gebäudes, nur wenn genannt"
    )
    adresse: Optional[str] = None
    plz: Optional[str] = None
    ort: Optional[str] = None
    baujahr: Optional[int] = None
    effizienzklasse: Optional[str] = Field(
        None, description="Energieeffizienzklasse A+ bis H, nur wenn genannt"
    )
    energieausweis_typ: Optional[str] = Field(
        None, description="z.B. 'Bedarfsausweis' oder 'Verbrauchsausweis', null wenn unbekannt"
    )
    endenergiebedarf_kwh: Optional[float] = Field(
        None, description="Endenergiebedarf/-verbrauch in kWh/(m²·a), nur wenn genannt"
    )
    heizung: Optional[str] = Field(None, description="Heizungsart, nur wenn genannt")
    denkmalschutz: Optional[bool] = Field(
        None, description="true/false nur wenn explizit genannt, sonst null"
    )
    vermietet: Optional[bool] = Field(
        None, description="true/false nur wenn explizit vorgesehen/vermietet genannt, sonst null"
    )
    hausgeld_eur: Optional[float] = Field(
        None, description="Monatliches Hausgeld in EUR, nur wenn genannt"
    )
    kaltmiete_eur: Optional[float] = Field(
        None,
        description="Bestehende/genannte Kaltmiete EUR/Monat (bei vermieteten Objekten), "
        "nicht die Angebotsmiete bei Mietanzeigen",
    )
    zustand_kurz: Optional[str] = Field(
        None, description="Kurzer Zustands-Hinweis aus der Anzeige, z.B. 'renovierungsbedürftig'"
    )
    beschreibung: Optional[str] = Field(
        None, description="Zusammenfassung der Objektbeschreibung, max. ca. 2000 Zeichen"
    )
    bilder: list[str] = Field(
        default_factory=list,
        description="Vollständige Bild-URLs, die im Seiteninhalt erkennbar sind (falls vorhanden)",
    )


class Mangel(BaseModel):
    """Strukturell kompatibel zu zvg.Mangel für Frontend-Reuse (MaengelSection)."""

    nummer: int = 1
    raum: Optional[str] = Field(None, description="Betroffener Raum/Gebäudeteil")
    schwere: Literal["leicht", "mittel", "schwer"] = "mittel"
    beschreibung: str
    kosten_eur: Optional[int] = None


class Modernisierung(BaseModel):
    jahr: int
    beschreibung: str


class FixFlipMassnahme(BaseModel):
    """Konkrete Sanierungs-/Renovierungsmaßnahme mit grober Kostenschätzung
    (Fix & Flip, 2026-07-08). LOKAL in real_estate.py definiert - siehe
    strukturell identisches, aber bewusst getrenntes Pendant in zvg.py."""

    beschreibung: str = Field(
        ...,
        description="Konkrete Maßnahme, z.B. 'Bad komplett sanieren', "
        "'Fenster austauschen (Baujahr 1986, Einfachverglasung)'",
    )
    kategorie: Optional[
        Literal[
            "bad",
            "kueche",
            "dach",
            "fenster",
            "heizung",
            "fassade",
            "boden",
            "elektrik",
            "sonstiges",
        ]
    ] = None
    kosten_min_eur: Optional[int] = None
    kosten_max_eur: Optional[int] = None
    prioritaet: Literal["hoch", "mittel", "niedrig"]


class FixFlipDealSchaetzung(BaseModel):
    """Zweiter, kleiner LLM-Call für die Fix&Flip-Deal-Kalkulation (Ziel 6,
    2026-07-09) - NUR aufgerufen, wenn fix_flip_massnahmen nicht leer ist
    (siehe src/api/app.py). Die KI schätzt hier AUSSCHLIESSLICH ARV,
    Haltezeit und Konfidenz - Gesamtinvestition, Gewinn, ROI und Marge
    entstehen weder hier noch im Scraper, sondern ausschließlich in
    apps/web/lib/underwriting, damit jede Geldzahl aus einer Quelle stammt.
    LOKAL in real_estate.py definiert - siehe strukturell identisches, aber
    bewusst getrenntes Pendant in zvg.py."""

    arv_min_eur: Optional[int] = Field(
        None,
        description="Geschätzter Verkaufswert NACH Sanierung (After-Repair-Value), untere Grenze.",
    )
    arv_max_eur: Optional[int] = Field(None, description="ARV obere Grenze.")
    arv_begruendung: str = Field(
        ...,
        description="2-3 Sätze: wie die ARV abgeleitet wurde (Lage, Größe, Zustand nach Sanierung, "
        "Vergleich mit üblichen Marktpreisen/m² in der Region). Transparent bei Unsicherheit.",
    )
    arv_konfidenz: Literal["hoch", "mittel", "niedrig"] = Field(
        ..., description="Wie sicher die ARV-Schätzung ist."
    )
    holding_monate: int = Field(
        9, description="Geschätzte Haltezeit in Monaten (Sanierung + Vermarktung)."
    )
    finanzierung_zinssatz_pct: float = Field(
        4.5,
        description="Annahme für Zwischenfinanzierung (nur Rechengrundlage, keine Finanzierungsberatung).",
    )
    verkaufskosten_pct: float = Field(
        5.0, description="Annahme Makler/Notar/Grundbuch beim Verkauf (nur Rechengrundlage)."
    )


class CustomMarketAnalyse(BaseModel):
    """Markt-Fairness-Bewertung + ZVG-Paritäts-Enrichment eines frei
    eingereichten Angebots. EIGENSTÄNDIG von KIAnalyseResult — andere Domäne.
    Regel: Nur aus Anzeigentext/sichtbaren Fakten; fehlend → null/leere Liste.
    Keine Gutachten-Halluzinationen (Grundbuch, Belastungen, Bietgrenzen)."""

    preis_bewertung: Literal["günstig", "marktüblich", "teuer", "unbekannt"] = "unbekannt"
    preis_abweichung_pct: Optional[float] = Field(
        None,
        description="Geschätzte prozentuale Abweichung vom für Lage/Größe/Zustand "
        "üblichen Marktpreis. Positiv = teurer als üblich, negativ = günstiger.",
    )
    staerken: list[str] = Field(
        default_factory=list, description="Stichpunktartige Stärken des Angebots"
    )
    schwaechen: list[str] = Field(
        default_factory=list, description="Stichpunktartige Schwächen/Risiken"
    )
    lage_bewertung: Optional[str] = Field(None, description="Kurze Einschätzung der Lage")
    rendite_geschaetzt_pct: Optional[float] = Field(
        None,
        description="NUR bei angebotstyp='kauf' mit erkennbarer Vermietbarkeit: "
        "grobe Bruttomietrendite (Jahreskaltmiete / Kaufpreis) in %. "
        "null bei Mietangeboten, Eigennutzung oder wenn nicht seriös bestimmbar.",
    )
    zusammenfassung: str = Field(..., description="2-4 Sätze Gesamtfazit für den Nutzer")

    investment_score: Optional[Literal["attraktiv", "neutral", "abraten"]] = Field(
        None,
        description="NUR bei angebotstyp='kauf': grobe Investoren-Einschätzung als Kapitalanlage. "
        "null bei Mietangeboten oder wenn nicht seriös.",
    )
    investment_score_begruendung: Optional[str] = Field(
        None,
        description="Kurze Begründung (1-2 Sätze) für investment_score; null wenn score null.",
    )
    risiken_investor: list[str] = Field(
        default_factory=list,
        description="Stichpunktartige Investitionsrisiken, z.B. Sanierungsstau, "
        "Vermietbarkeit, Lagerisiko, Klumpenrisiko - getrennt von den "
        "Markt-Fairness-Schwächen oben",
    )
    cashflow_einschaetzung: Optional[str] = Field(
        None,
        description="NUR relevant bei angebotstyp='kauf' mit erkennbarer Vermietbarkeit: "
        "grobe Netto-Cashflow-Tendenz nach geschätzten Bewirtschaftungskosten, mit "
        "kurzer Begründung. KEINE erfundenen Zahlen ohne Begründung - null wenn nicht "
        "seriös einschätzbar (z.B. bei Eigennutzung oder Mietangeboten).",
    )

    fix_flip_massnahmen: list[FixFlipMassnahme] = Field(
        default_factory=list,
        description="NUR befüllen, wenn aus dem Angebotstext konkrete Renovierungsbedarfe "
        "erkennbar sind. Im Zweifel leere Liste statt Spekulation.",
    )
    fix_flip_werteinschaetzung: Optional[str] = Field(
        None,
        description="2-3 Sätze qualitative Einschätzung der Wertsteigerung nach Umsetzung der "
        "Maßnahmen. null, wenn fix_flip_massnahmen leer ist.",
    )

    # --- ZVG-Parität (aus Anzeigentext; null/[] wenn unbekannt) ---
    maengel: list[Mangel] = Field(
        default_factory=list,
        description="Nur wenn Anzeige konkrete Mängel/Schäden nennt. Sonst [].",
    )
    modernisierungen: list[Modernisierung] = Field(
        default_factory=list,
        description="Nur wenn Jahre/Maßnahmen explizit genannt. Sonst [].",
    )
    energieausweis_vorhanden: Optional[bool] = None
    effizienzklasse: Optional[str] = None
    ausweisjahr: Optional[int] = None
    energietraeger: Optional[str] = None
    endenergieverbrauch_kwh: Optional[float] = None
    innenbesichtigung: Optional[bool] = Field(
        None, description="Bei Markt-Anzeigen meist null (kein Gutachten)"
    )
    restnutzungsdauer_j: Optional[int] = None
    heizung: Optional[str] = None
    wohnraeume: Optional[str] = None
    zustand_aussen: Optional[str] = None
    zustand_innen: Optional[str] = None
    maengel_kurz: Optional[str] = None
    baubeschreibung: Optional[str] = Field(
        None, description="Nur aus Anzeigentext; keine erfundene Baubeschreibung"
    )
    instandhaltung: Optional[str] = None
    lage_einwohner: Optional[int] = Field(
        None, description="Einwohnerzahl als Ganzzahl, nur wenn seriös bekannt, sonst null"
    )
    lage_region: Optional[str] = None
    lage_verkehr: Optional[str] = None
    lage_charakter: Optional[str] = None
    lage_umgebung: Optional[str] = None
    moegliche_kaltmiete: Optional[float] = Field(
        None,
        description="Geschätzte erzielbare Kaltmiete EUR/Monat bei Kauf zur Vermietung. "
        "Wenn Anzeige bereits eine Bestandsmiete nennt, diese übernehmen. "
        "null wenn nicht seriös schätzbar.",
    )
    hausgeld: Optional[float] = Field(
        None,
        description="Monatliches Hausgeld EUR; aus Anzeige oder grobe Schätzung mit Begründung in cashflow",
    )
    jahresrohertrag: Optional[float] = None
    liegenschaftszinssatz: Optional[float] = None
    ertragswert: Optional[float] = None
    bodenrichtwert_eur_m2: Optional[float] = Field(
        None,
        description="NUR wenn seriös aus öffentlichem Wissen/Anzeigentext ableitbar, sonst null. "
        "Keine erfundenen BRW-Zahlen.",
    )
    bodenrichtwert_stichtag: Optional[str] = None
    bodenrichtwert_berechnung: Optional[str] = None
