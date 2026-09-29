from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal
from pydantic import BaseModel, Field


class ZvgListing(BaseModel):
    aktenzeichen: str
    bundesland: str
    bundesland_name: str
    slug: str
    source: Literal["justizportal", "zvg.com", "hanmark.de"]
    source_url: Optional[str] = None
    direktlink: Optional[str] = None

    typ: Optional[str] = None
    kategorie: Optional[Literal["wohnung", "haus", "grundstueck", "gewerbe"]] = None

    adresse: Optional[str] = None
    strasse: Optional[str] = None
    hausnummer: Optional[str] = None
    plz: Optional[str] = None
    ort: Optional[str] = None
    stadtteil: Optional[str] = None
    lat: Optional[Decimal] = None
    lng: Optional[Decimal] = None

    verkehrswert: Optional[int] = None

    wohnflaeche_m2: Optional[Decimal] = None
    grundstuecksflaeche_m2: Optional[Decimal] = None
    nutzflaeche_m2: Optional[Decimal] = None
    gesamtflaeche_m2: Optional[Decimal] = None

    baujahr: Optional[int] = None
    zimmer: Optional[Decimal] = None
    etage: Optional[int] = None

    amtsgericht: Optional[str] = None
    versteigerungsort: Optional[str] = None
    termin_date: Optional[datetime] = None
    termin_saal: Optional[str] = None

    ist_neu: bool = True
    denkmalschutz: Optional[bool] = None
    vermietet: Optional[bool] = None

    beschreibung: Optional[str] = None
    miteigentumsanteil: Optional[str] = None
    sondereigentum: Optional[str] = None

    image_urls: list[str] = Field(default_factory=list)
    gutachten_url: Optional[str] = None
    expose_url: Optional[str] = None
    raw_data: Optional[dict] = None

    # Vollständigkeits-Gate (Baustein 2 der Firecrawl-Migration, siehe
    # docs/CUSTOM_URL_ANALYSIS.md + drizzle/migrations/0006). Wird von den
    # einzelnen Scrapern (zvg_portal.py, zvg_com.py, hanmark.py) NACH
    # abgeschlossener Detail-Anreicherung (Bilder/Gutachten/Exposé-Fetch-
    # Versuch) auf True gesetzt - unabhängig davon, ob dabei tatsächlich
    # zusätzliche Daten gefunden wurden. upsert_zvg_listing() übersetzt das
    # in die DB-Spalte scrape_completed_at. Bleibt False, wenn die
    # Detail-Anreicherung übersprungen wurde (fetch_images=False) oder ein
    # Fehler sie abgebrochen hat - dann bleibt scrape_completed_at NULL/
    # unverändert und get_listings_without_ki() wartet auf den nächsten Lauf.
    detail_scrape_complete: bool = False

    # hanmark.de markiert aufgehobene Termine sowohl auf der Amtsgerichts-
    # Listenseite ("Termin aufgehoben" statt Datum, siehe
    # src/sources/hanmark.py::_parse_ag_listings) als auch auf der
    # Detailseite (Termin-Zeile enthält nur "aufgehoben", siehe
    # _enrich_from_detail) - HTTP 200 in beiden Fällen, kein 404. Aktuell
    # nur von hanmark.py gesetzt; die Flow-Ebene (hanmark_daily.py)
    # deaktiviert das Listing dann gezielt statt es normal upzuserten.
    termin_aufgehoben: bool = False


class Mangel(BaseModel):
    nummer: int
    raum: Optional[str] = Field(
        None, description="Betroffener Raum/Gebäudeteil, z.B. 'Bad', 'Dach', 'Keller'"
    )
    schwere: Literal["leicht", "mittel", "schwer"]
    beschreibung: str
    kosten_eur: Optional[int] = Field(None, description="Grobe geschätzte Behebungskosten in EUR")


class Belastung(BaseModel):
    nummer: int
    abteilung: Literal["Abteilung I", "Abteilung II", "Abteilung III"]
    beschreibung: str


class Flurstueck(BaseModel):
    nummer: int
    grundbuch: str
    blatt: str
    flurstueck_nr: str
    gemarkung: str
    wirtschaftsart: str


class Modernisierung(BaseModel):
    jahr: int
    beschreibung: str


class FixFlipMassnahme(BaseModel):
    """Konkrete Sanierungs-/Renovierungsmaßnahme mit grober Kostenschätzung
    (Fix & Flip, 2026-07-08). LOKAL in zvg.py definiert - siehe strukturell
    identisches, aber bewusst getrenntes Pendant in real_estate.py."""

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
    (siehe src/flows/ki_analysis.py). Die KI schätzt hier AUSSCHLIESSLICH
    ARV, Haltezeit und Konfidenz - Gesamtinvestition, Gewinn, ROI und Marge
    entstehen weder hier noch im Scraper, sondern ausschließlich in
    apps/web/lib/underwriting, damit jede Geldzahl aus einer Quelle stammt.
    LOKAL in zvg.py definiert - siehe strukturell identisches, aber bewusst
    getrenntes Pendant in real_estate.py."""

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


class OrtInDerNaehe(BaseModel):
    name: str
    adresse: str
    kategorie: str
    bewertung: Optional[float] = None
    bewertungen_anzahl: Optional[int] = None
    entfernung_pkw_m: Optional[int] = None
    dauer_pkw_min: Optional[int] = None
    entfernung_fuss_m: Optional[int] = None
    dauer_fuss_min: Optional[int] = None


class KIBasicAnalyseResult(BaseModel):
    """Schmale Fakten-Extraktion für die automatische Daily-Basisanalyse."""

    wohnflaeche_m2: Optional[float] = Field(None, description="Wohnfläche in m² (aus Gutachten)")
    grundstuecksflaeche_m2: Optional[float] = Field(None, description="Grundstücksfläche in m²")
    baujahr: Optional[int] = Field(None, description="Baujahr des Objekts")
    zimmer: Optional[float] = Field(None, description="Anzahl der Zimmer (kann Dezimalwert sein)")
    beschreibung: Optional[str] = Field(
        None, description="Kurzbeschreibung des Objekts (max. 400 Zeichen)"
    )

    grundbuch_blatt: Optional[str] = None
    grundbuch_flurstueck: Optional[str] = None
    grundbuch_gemarkung: Optional[str] = None

    maengel: list[Mangel] = Field(default_factory=list)
    maengel_kurz: Optional[str] = None
    belastungen: list[Belastung] = Field(default_factory=list)

    energieausweis_vorhanden: Optional[bool] = None
    effizienzklasse: Optional[Literal["A+", "A", "B", "C", "D", "E", "F", "G", "H"]] = None
    heizung: Optional[str] = None
    zustand_aussen: Optional[str] = None
    zustand_innen: Optional[str] = None
    lage_charakter: Optional[str] = None
    lage_umgebung: Optional[str] = None


class KIFactExtractResult(BaseModel):
    """Fakten aus dem Gutachten ohne Investment-/Fix&Flip-Urteil."""

    wohnflaeche_m2: Optional[float] = Field(None, description="Wohnfläche in m² (aus Gutachten)")
    grundstuecksflaeche_m2: Optional[float] = Field(None, description="Grundstücksfläche in m²")
    baujahr: Optional[int] = Field(None, description="Baujahr des Objekts")
    zimmer: Optional[float] = Field(None, description="Anzahl der Zimmer (kann Dezimalwert sein)")
    beschreibung: Optional[str] = Field(
        None, description="Kurzbeschreibung des Objekts (max. 1000 Zeichen)"
    )

    grundbuch_blatt: Optional[str] = None
    grundbuch_flurstueck: Optional[str] = None
    grundbuch_gemarkung: Optional[str] = None

    flurstuecke: list[Flurstueck] = Field(default_factory=list)
    maengel: list[Mangel] = Field(default_factory=list)
    belastungen: list[Belastung] = Field(default_factory=list)
    modernisierungen: list[Modernisierung] = Field(default_factory=list)

    bodenrichtwert_eur_m2: Optional[float] = None
    bodenrichtwert_stichtag: Optional[str] = None
    bodenrichtwert_berechnung: Optional[str] = None

    energieausweis_vorhanden: Optional[bool] = None
    effizienzklasse: Optional[Literal["A+", "A", "B", "C", "D", "E", "F", "G", "H"]] = None
    ausweisjahr: Optional[int] = Field(
        None,
        description=(
            "Ausstellungsjahr des Energieausweises (NICHT das Baujahr des Gebäudes!). "
            "Nur setzen, wenn im Gutachten explizit ein Ausstellungs-/Erstellungsdatum "
            "des Energieausweises genannt wird - sonst None lassen."
        ),
    )
    energietraeger: Optional[str] = None
    endenergieverbrauch_kwh: Optional[float] = None

    innenbesichtigung: Optional[bool] = None
    restnutzungsdauer_j: Optional[int] = None
    heizung: Optional[str] = None
    wohnraeume: Optional[str] = None
    zustand_aussen: Optional[str] = None
    zustand_innen: Optional[str] = None
    maengel_kurz: Optional[str] = None

    baubeschreibung: Optional[str] = None
    instandhaltung: Optional[str] = None
    baulasten: Optional[str] = None

    lage_einwohner: Optional[int] = None
    lage_region: Optional[str] = None
    lage_verkehr: Optional[str] = None
    lage_charakter: Optional[str] = None
    lage_umgebung: Optional[str] = None

    moegliche_kaltmiete: Optional[float] = None
    hausgeld: Optional[float] = None
    jahresrohertrag: Optional[float] = None
    liegenschaftszinssatz: Optional[float] = None
    ertragswert: Optional[int] = None


class InvestmentEnrichmentResult(BaseModel):
    investment_score: Literal["attraktiv", "neutral", "abraten"] = Field(
        "neutral", description="Grobe Investoren-Einschätzung des Objekts als Kapitalanlage"
    )
    investment_score_begruendung: str = Field(
        ..., description="Kurze Begründung (2-3 Sätze) für investment_score"
    )
    risiken_investor: list[str] = Field(
        default_factory=list,
        description="Stichpunktartige Investitionsrisiken aus Investorensicht (Sanierungsstau, "
        "Vermietbarkeit, Lagerisiko, Rechtsrisiken/Baulasten, Klumpenrisiko, ...) - getrennt von "
        "den bereits erfassten maengel/zustand_aussen/zustand_innen oben.",
    )
    fix_flip_massnahmen: list[FixFlipMassnahme] = Field(default_factory=list)
    fix_flip_werteinschaetzung: Optional[str] = Field(
        None,
        description="2-3 Sätze qualitative Einschätzung der Wertsteigerung nach Umsetzung der "
        "Maßnahmen. KEINE erfundene ARV-Zahl (After-Repair-Value) ohne Vergleichsobjekt-Datenbasis.",
    )


class KIAnalyseResult(BaseModel):
    """Strukturierte Extraktion aus Zwangsversteigerungs-Gutachten via Langdock/Claude."""

    # Grunddaten (werden in zvg_listings zurückgeschrieben)
    wohnflaeche_m2: Optional[float] = Field(None, description="Wohnfläche in m² (aus Gutachten)")
    grundstuecksflaeche_m2: Optional[float] = Field(None, description="Grundstücksfläche in m²")
    baujahr: Optional[int] = Field(None, description="Baujahr des Objekts")
    zimmer: Optional[float] = Field(None, description="Anzahl der Zimmer (kann Dezimalwert sein)")
    beschreibung: Optional[str] = Field(
        None, description="Kurzbeschreibung des Objekts (max. 1000 Zeichen)"
    )

    grundbuch_blatt: Optional[str] = None
    grundbuch_flurstueck: Optional[str] = None
    grundbuch_gemarkung: Optional[str] = None

    flurstuecke: list[Flurstueck] = Field(default_factory=list)
    maengel: list[Mangel] = Field(default_factory=list)
    belastungen: list[Belastung] = Field(default_factory=list)
    modernisierungen: list[Modernisierung] = Field(default_factory=list)

    bodenrichtwert_eur_m2: Optional[float] = None
    bodenrichtwert_stichtag: Optional[str] = None
    bodenrichtwert_berechnung: Optional[str] = None

    energieausweis_vorhanden: Optional[bool] = None
    effizienzklasse: Optional[Literal["A+", "A", "B", "C", "D", "E", "F", "G", "H"]] = None
    ausweisjahr: Optional[int] = Field(
        None,
        description=(
            "Ausstellungsjahr des Energieausweises (NICHT das Baujahr des Gebäudes!). "
            "Energieausweise gibt es in Deutschland erst seit ca. 2002/2008. "
            "Nur setzen, wenn im Gutachten explizit ein Ausstellungs-/Erstellungsdatum "
            "des Energieausweises genannt wird - sonst None lassen."
        ),
    )
    energietraeger: Optional[str] = None
    endenergieverbrauch_kwh: Optional[float] = None

    innenbesichtigung: Optional[bool] = None
    restnutzungsdauer_j: Optional[int] = None
    heizung: Optional[str] = None
    wohnraeume: Optional[str] = None
    zustand_aussen: Optional[str] = None
    zustand_innen: Optional[str] = None
    maengel_kurz: Optional[str] = None

    baubeschreibung: Optional[str] = None
    instandhaltung: Optional[str] = None
    baulasten: Optional[str] = None

    lage_einwohner: Optional[int] = None
    lage_region: Optional[str] = None
    lage_verkehr: Optional[str] = None
    lage_charakter: Optional[str] = None
    lage_umgebung: Optional[str] = None

    moegliche_kaltmiete: Optional[float] = None
    hausgeld: Optional[float] = None
    jahresrohertrag: Optional[float] = None
    liegenschaftszinssatz: Optional[float] = None
    ertragswert: Optional[int] = None

    # Investoren-Analyse (2026-07-08) - strukturell identisch zu, aber
    # BEWUSST getrennt gehalten von CustomMarketAnalyse.investment_score* in
    # real_estate.py (andere Domäne: Zwangsversteigerungs-Gutachten statt
    # frei eingereichtes Markt-Exposé). Getrennt von maengel/zustand_aussen/
    # zustand_innen oben: dort geht es um Gutachten-Fakten, hier explizit um
    # die Investitionsperspektive.
    investment_score: Literal["attraktiv", "neutral", "abraten"] = Field(
        "neutral", description="Grobe Investoren-Einschätzung des Objekts als Kapitalanlage"
    )
    investment_score_begruendung: str = Field(
        ..., description="Kurze Begründung (2-3 Sätze) für investment_score"
    )
    risiken_investor: list[str] = Field(
        default_factory=list,
        description="Stichpunktartige Investitionsrisiken aus Investorensicht (Sanierungsstau, "
        "Vermietbarkeit, Lagerisiko, Rechtsrisiken/Baulasten, Klumpenrisiko, ...) - getrennt von "
        "den bereits erfassten maengel/zustand_aussen/zustand_innen oben.",
    )

    # Fix & Flip (2026-07-08) - konkrete Sanierungsmaßnahmen mit
    # Kostenschätzung. Soll primär aus den bereits extrahierten maengel +
    # modernisierungen + zustand_aussen/zustand_innen/baubeschreibung
    # ABGELEITET werden (konsistent bleiben, nicht den Gutachtentext ein
    # zweites Mal unabhängig neu interpretieren - siehe Prompt in
    # src/flows/ki_analysis.py). fix_flip_gesamtkosten_min_eur/_max_eur
    # werden bewusst NICHT hier als Feld geführt - die Summe wird
    # SERVERSEITIG in Python aus den Einzelmaßnahmen aufsummiert (siehe
    # ki_analysis.py), um Rechenfehler der KI auszuschließen.
    fix_flip_massnahmen: list[FixFlipMassnahme] = Field(default_factory=list)
    fix_flip_werteinschaetzung: Optional[str] = Field(
        None,
        description="2-3 Sätze qualitative Einschätzung der Wertsteigerung nach Umsetzung der "
        "Maßnahmen. KEINE erfundene ARV-Zahl (After-Repair-Value) ohne Vergleichsobjekt-Datenbasis.",
    )
