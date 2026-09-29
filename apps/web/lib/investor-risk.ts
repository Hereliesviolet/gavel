/**
 * Einzige Definition von Anti-Signalen und materiellen Risiken.
 *
 * Vorher lagen drei divergierende Listen in einstieg-picks.ts (HARD_RISK_PATTERNS),
 * investor-finder.ts (HARD_RISK_SQL) und investor-quality.ts (CRITICAL/MATERIAL).
 * Sie widersprachen sich unter anderem bei Schimmel und Räumung. Hier steht das
 * Muster genau einmal; sowohl die TS-Prädikate als auch das SQL-Fragment werden
 * daraus generiert, damit sie nicht wieder auseinanderlaufen können.
 */

export type RiskClass = "anti" | "material";

export interface RiskDefinition {
  id: string;
  label: string;
  klasse: RiskClass;
  /**
   * JavaScript-Regex-Quelle. `\b` ist erlaubt und wird für Postgres nach `\y`
   * übersetzt — in Postgres-ARE bedeutet `\b` das Backspace-Zeichen.
   */
  muster: string;
}

/**
 * Anti-Signale kappen die Chance und markieren eine Sondersituation. Sie
 * beantworten die Frage "billig, weil zu Recht billig?" mit ja: rechtliche
 * oder bauliche Umstände, die den Abschlag erklären statt eine Chance zu sein.
 */
const ANTI_SIGNAL_DEFINITIONS: readonly Omit<RiskDefinition, "klasse">[] = [
  {
    id: "teileigentumsanteil",
    label: "Bruchteils- oder Miteigentumsanteil statt Volleigentum",
    muster: String.raw`\b(?:1/\d+|hälft(?:e|ig(?:e[rsn]?|er)?))\s*[-–]?\s*(?:mit)?eigentumsanteil\b`,
  },
  {
    id: "dauerwohnrecht",
    label: "Wohnrecht, Nießbrauch oder Erbbaurecht",
    muster: String.raw`\b(?:wohnrecht|nießbrauch|erbbaurecht|erbbauzins)\b`,
  },
  {
    id: "bestehenbleibende_rechte",
    label: "Bestehenbleibende Rechte in Abteilung II oder III",
    muster: String.raw`(?:(?:grundpfandrecht|grundschuld|hypothek|belastung).{0,100}(?:bleib\w*\s+bestehen|bestehenbleib)|(?:bleib\w*\s+bestehen|bestehenbleib).{0,100}(?:grundpfandrecht|grundschuld|hypothek|belastung))`,
  },
  {
    id: "altlast",
    label: "Altlast oder Bodenverunreinigung",
    muster: String.raw`\b(?:altlast|kontamin|bodenverunreinigung)\w*`,
  },
  {
    id: "substanzverlust",
    label: "Abbruchreife oder Substanzverlust",
    muster: String.raw`\b(?:einsturz|abbruchreif|brandschaden)\w*`,
  },
  {
    id: "zuwegung",
    label: "Ungesicherte Zuwegung oder fehlende Erschließung",
    muster: String.raw`(?:(?:zugang|zuwegung|erschließung).{0,120}(?:ungesichert|nicht gesichert|fremde[sn]?\s+grundstück)|\bnicht erschlossen\b)`,
  },
  {
    id: "sanierung_ueber_wert",
    label: "Sanierungsaufwand übersteigt den Verkehrswert",
    muster: String.raw`(?:(?:sanierungskosten|sanierungsaufwand|gesamtaufwand).{0,120}(?:verkehrswert|objektwert).{0,80}(?:übersteig|überschreit)|(?:verkehrswert|objektwert).{0,80}(?:durch|von).{0,100}(?:sanierungskosten|sanierungsaufwand|gesamtaufwand).{0,60}(?:übersteig|überschreit))`,
  },
  {
    id: "gewerbliche_widmung",
    label: "Rein gewerbliche Nutzung",
    muster: String.raw`(?:\bnur gewerblich|\bgewerbe.?only\b)`,
  },
] as const;

/**
 * Materielle Risiken sind bezifferbar und verhandelbar. Sie senken die
 * Konfidenz und gehören auf die Prüfliste, schließen ein Objekt aber nicht aus.
 *
 * Schimmel und Räumung stehen bewusst hier und nicht bei den Anti-Signalen:
 * beides ist ein Kosten- und Zeitrisiko mit bekanntem Preis, kein Umstand, der
 * den Abschlag rechtfertigt. Genau hier widersprachen sich die drei Altlisten.
 */
const MATERIAL_RISK_DEFINITIONS: readonly Omit<RiskDefinition, "klasse">[] = [
  {
    id: "keine_innenbesichtigung",
    label: "Keine Innenbesichtigung möglich",
    muster: String.raw`(?:\b(?:keine|fehlende|nicht mögliche)\s+innenbesichtigung\b|\binnenbesichtigung.{0,40}(?:nicht möglich|fehlt|unbekannt))`,
  },
  {
    id: "denkmalschutz",
    label: "Denkmalschutz oder Denkmalbereich",
    muster: String.raw`\b(?:denkmalschutz|denkmalbereich)\w*`,
  },
  {
    id: "hochwasser",
    label: "Hochwasser- oder Starkregengefährdung",
    muster: String.raw`\b(?:hochwasser|überschwemm|starkregen)\w*`,
  },
  {
    id: "feuchteschaden",
    label: "Schimmel oder Feuchtigkeitsschaden",
    muster: String.raw`\b(?:schimmel|feuchtigkeit|feuchteschaden|undichtig)\w*`,
  },
  {
    id: "besitzuebergang",
    label: "Räumung oder offener Besitzübergang",
    muster: String.raw`\b(?:räumung|eigenbedarf|selbst bewohnt|besitzübergabe)\w*`,
  },
  {
    id: "gutachten_unvollstaendig",
    label: "Gutachten nicht verfügbar oder unvollständig",
    muster: String.raw`\b(?:vollgutachten|gutachten).{0,80}(?:nicht verfügbar|kein zugang|nicht eingesehen|unvollständig)\b`,
  },
  {
    id: "lagerisiko",
    label: "Strukturschwache Lage oder Leerstandsrisiko",
    muster: String.raw`\b(?:strukturschwach|bevölkerungsrückgang|demografischer rückgang|leerstandsrisiko)\w*`,
  },
  {
    id: "weg_risiko",
    label: "Sonderumlage oder unklarer Rücklagenstand",
    muster: String.raw`\b(?:sonderumlage|weg-risiko|rücklagenstand unbekannt|hausgeld.{0,30}unbekannt)\b`,
  },
  {
    id: "sanierungsstau",
    label: "Sanierungsstau oder unbekannter Zustand",
    muster: String.raw`\b(?:sanierungsstau|fertigstellungsrisiko|zustand.{0,40}unbekannt)\b`,
  },
  {
    id: "erschliessungsbeitrag",
    label: "Offene Erschließungsbeiträge",
    muster: String.raw`\b(?:erschließungskosten|erschließungsbeitr)\w*`,
  },
] as const;

export const ANTI_SIGNALS: readonly RiskDefinition[] = ANTI_SIGNAL_DEFINITIONS.map(
  (definition) => ({ ...definition, klasse: "anti" as const }),
);

export const MATERIAL_RISKS: readonly RiskDefinition[] = MATERIAL_RISK_DEFINITIONS.map(
  (definition) => ({ ...definition, klasse: "material" as const }),
);

export const RISK_DEFINITIONS: readonly RiskDefinition[] = [...ANTI_SIGNALS, ...MATERIAL_RISKS];

const ANTI_SIGNAL_REGEXES = ANTI_SIGNALS.map(
  (definition) => [definition, new RegExp(definition.muster, "i")] as const,
);

const MATERIAL_RISK_REGEXES = MATERIAL_RISKS.map(
  (definition) => [definition, new RegExp(definition.muster, "i")] as const,
);

/**
 * Übersetzt eine JS-Regex-Quelle in Postgres-ARE. Nur `\b` unterscheidet sich
 * in Bedeutung; `\w`, `\d`, `\s` und `(?:…)` verhalten sich gleich.
 */
export function toPostgresPattern(muster: string): string {
  return muster.replace(/\\b/g, String.raw`\y`);
}

/** Ein einziges Postgres-Muster über alle Anti-Signale, für `r ~* …`. */
export function antiSignalPostgresPattern(): string {
  return ANTI_SIGNALS.map((definition) => `(?:${toPostgresPattern(definition.muster)})`).join("|");
}

export interface InvestorRiskAssessment {
  /** Anti-Signale: erklären den Abschlag, kappen die Chance. */
  critical: string[];
  /** Materielle Risiken: bezifferbar, senken die Konfidenz. */
  material: string[];
  /** IDs der ausgelösten Anti-Signale, für die Begründung in der UI. */
  antiSignalIds: string[];
}

function riskStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function matchAntiSignal(text: string): RiskDefinition | null {
  for (const [definition, regex] of ANTI_SIGNAL_REGEXES) {
    if (regex.test(text)) return definition;
  }
  return null;
}

export function isAntiSignal(text: string): boolean {
  return matchAntiSignal(text) !== null;
}

export function assessInvestorRisks(value: unknown): InvestorRiskAssessment {
  const critical: string[] = [];
  const material: string[] = [];
  const antiSignalIds: string[] = [];

  for (const risk of riskStrings(value)) {
    const antiSignal = matchAntiSignal(risk);
    if (antiSignal) {
      critical.push(risk);
      antiSignalIds.push(antiSignal.id);
      continue;
    }
    if (MATERIAL_RISK_REGEXES.some(([, regex]) => regex.test(risk))) {
      material.push(risk);
    }
  }

  return {
    critical: [...new Set(critical)],
    material: [...new Set(material)],
    antiSignalIds: [...new Set(antiSignalIds)],
  };
}
