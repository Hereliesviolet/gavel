import { KiSection, KiFinding } from "@/components/zvg/detail/ki-section";
import type { SeverityLevel } from "@/components/ui/severity";
import type { FlipKennzahlen } from "@/lib/underwriting";
import { DEFAULT_INVESTOR_PROFILE } from "@/lib/investor-profile";
import { cn } from "@/lib/utils";

// Gemeinsame Anzeige-Komponente für die Investoren-Analyse + Fix&Flip-
// Einschätzung beider KI-Analyse-Domänen (ZVG-Objekte via zvgKiAnalyses UND
// Custom-URL-Analysen via realEstateKiAnalyses - siehe scrapers/src/models/
// zvg.py::KIAnalyseResult bzw. real_estate.py::CustomMarketAnalyse, beide mit
// identischen Spaltennamen in drizzle/schema/zvg.ts + immobilien.ts). Muss
// robust mit fehlenden/undefined Werten umgehen, damit alte, bereits
// vorhandene Analysen (ohne diese Felder) beim Rendern nicht crashen.
export interface FixFlipMassnahme {
  beschreibung: string;
  kategorie?: string | null;
  kosten_min_eur?: number | null;
  kosten_max_eur?: number | null;
  prioritaet?: string | null;
}

type InvestmentScore = "attraktiv" | "neutral" | "abraten";

const INVESTMENT_SCORE_LABEL: Record<InvestmentScore, string> = {
  attraktiv: "Attraktiv",
  neutral: "Neutral",
  abraten: "Eher abraten",
};

const INVESTMENT_SCORE_VARIANT: Record<InvestmentScore, "green" | "gray" | "red"> = {
  attraktiv: "green",
  neutral: "gray",
  abraten: "red",
};

const PRIORITAET_LABEL: Record<string, string> = {
  hoch: "HOCH",
  mittel: "MITTEL",
  niedrig: "NIEDRIG",
};

const PRIORITAET_SEVERITY: Record<string, SeverityLevel> = {
  hoch: "err",
  mittel: "warn",
  niedrig: "ok",
};

function formatEur(v: number | string | null | undefined): string | null {
  if (v == null) return null;
  const n = Number(v);
  if (isNaN(n)) return null;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatKostenRange(
  min?: number | string | null,
  max?: number | string | null,
): string | undefined {
  const fMin = formatEur(min);
  const fMax = formatEur(max);
  if (fMin && fMax && String(min) !== String(max)) return `~ ${fMin} – ${fMax}`;
  return fMin ? `~ ${fMin}` : fMax ? `~ ${fMax}` : undefined;
}

/** Wie formatKostenRange, aber ohne "~"-Präfix (für die Deal-Kalkulation, die
 * bereits explizit als "geschätzt" deklariert ist, siehe Disclaimer-Zeile). */
function formatEurRange(
  min?: number | string | null,
  max?: number | string | null,
): string | undefined {
  const fMin = formatEur(min);
  const fMax = formatEur(max);
  if (fMin && fMax && String(min) !== String(max)) return `${fMin} – ${fMax}`;
  return fMin ?? fMax ?? undefined;
}

function formatHoldingMonths(
  min?: number | string | null,
  max?: number | string | null,
  fallback?: number | string | null,
): string {
  const nMin = min != null ? Number(min) : NaN;
  const nMax = max != null ? Number(max) : NaN;
  if (Number.isFinite(nMin) && Number.isFinite(nMax) && nMin !== nMax) {
    return `${nMin}–${nMax}M`;
  }
  const single = Number.isFinite(nMax)
    ? nMax
    : Number.isFinite(nMin)
      ? nMin
      : Number(fallback ?? 9);
  return `${single}M`;
}

function formatPctRange(
  min?: number | string | null,
  max?: number | string | null,
): string | undefined {
  if (min == null && max == null) return undefined;
  const nMin = min != null ? Number(min) : null;
  const nMax = max != null ? Number(max) : null;
  const fmt = (n: number) =>
    n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (nMin != null && nMax != null && nMin !== nMax) return `${fmt(nMin)} % – ${fmt(nMax)} %`;
  return nMin != null ? `${fmt(nMin)} %` : nMax != null ? `${fmt(nMax)} %` : undefined;
}

const ARV_KONFIDENZ_LABEL: Record<string, string> = {
  hoch: "hoch",
  mittel: "mittel",
  niedrig: "niedrig",
};

export interface InvestmentFixFlipSectionProps {
  investmentScore?: string | null;
  investmentScoreBegruendung?: string | null;
  risikenInvestor?: string[] | null;
  fixFlipMassnahmen?: FixFlipMassnahme[] | null;
  fixFlipWerteinschaetzung?: string | null;
  fixFlipGesamtkostenMinEur?: number | string | null;
  fixFlipGesamtkostenMaxEur?: number | string | null;
  // Ertragswert-Felder: NUR bei ZVG-Objekten befüllt (siehe Ziel A) - bei
  // Custom-URL-Analysen bleiben diese Props einfach undefined.
  moeglicherKaltmiete?: number | string | null;
  hausgeld?: number | string | null;
  jahresrohertrag?: number | string | null;
  liegenschaftszinssatz?: number | string | null;
  ertragswert?: number | string | null;

  // kaufpreisEur/erwerbsnebenkostenEur tragen die Kosten-Aufschlüsselung
  // (Kaufpreis/Sanierung/Nebenkosten/Haltekosten); beide Werte berechnen die
  // aufrufenden Seiten ohnehin für die Erwerbskosten-Card nebenan.
  kaufpreisEur?: number | string | null;
  kaufpreisLabel?: string | null;
  erwerbsnebenkostenEur?: number | string | null;
  arvMinEur?: number | string | null;
  arvMaxEur?: number | string | null;
  arvBegruendung?: string | null;
  arvKonfidenz?: string | null;
  /**
   * Ergebnis des Underwritings (apps/web/lib/underwriting). Kam bis Migration
   * 0023 aus Datenbankspalten, die der Scraper mit Kaufpreis = Verkehrswert
   * gefüllt hat, während dieselbe Seite daneben gegen ein Referenzgebot
   * rechnete. Ohne Wert wird die Deal-Karte nicht gerendert.
   */
  flip?: FlipKennzahlen | null;
  /**
   * Warum die Rechnung nicht belastbar ist, z. B. weil der ARV nur mit
   * niedriger Konfidenz geschätzt wurde. Steht sichtbar über der Deal-Karte,
   * damit eine erfundene Präzision nicht wie ein Ergebnis aussieht.
   */
  flipVorbehalt?: string | null;
  financingRatePct?: number | null;
}

export function InvestmentFixFlipSection({
  investmentScore,
  investmentScoreBegruendung,
  risikenInvestor,
  fixFlipMassnahmen,
  fixFlipWerteinschaetzung,
  fixFlipGesamtkostenMinEur,
  fixFlipGesamtkostenMaxEur,
  moeglicherKaltmiete,
  hausgeld,
  jahresrohertrag,
  liegenschaftszinssatz,
  ertragswert,
  kaufpreisEur,
  kaufpreisLabel,
  erwerbsnebenkostenEur,
  arvMinEur,
  arvMaxEur,
  arvBegruendung,
  arvKonfidenz,
  flip,
  flipVorbehalt,
  financingRatePct,
}: InvestmentFixFlipSectionProps) {
  const massnahmen = fixFlipMassnahmen ?? [];
  const risiken = risikenInvestor ?? [];
  const score: InvestmentScore | undefined =
    investmentScore === "attraktiv" ||
    investmentScore === "neutral" ||
    investmentScore === "abraten"
      ? investmentScore
      : undefined;

  const dealScore: InvestmentScore | undefined = flip?.einschaetzung;
  const hasDeal = flip != null;

  const hasErtragswert = Boolean(
    moeglicherKaltmiete || hausgeld || jahresrohertrag || liegenschaftszinssatz || ertragswert,
  );
  const hasData =
    Boolean(score) ||
    risiken.length > 0 ||
    massnahmen.length > 0 ||
    Boolean(fixFlipWerteinschaetzung) ||
    hasErtragswert ||
    hasDeal;
  if (!hasData) return null;

  const gesamtkosten = formatKostenRange(fixFlipGesamtkostenMinEur, fixFlipGesamtkostenMaxEur);
  const summary = gesamtkosten ?? (score ? INVESTMENT_SCORE_LABEL[score] : undefined);
  const severity: SeverityLevel =
    score === "abraten" ? "err" : score === "attraktiv" ? "ok" : "info";

  return (
    <KiSection num="05" title="Investment & Fix-Flip" severity={severity} summary={summary}>
      <div className="flex flex-col gap-5">
        {score && (
          <div className="flex items-start gap-3 flex-wrap">
            <StatusBox
              label="Kapitalanlage-Score"
              sublabel="Als Vermietung / Buy & Hold (LLM)"
              value={INVESTMENT_SCORE_LABEL[score]}
              variant={INVESTMENT_SCORE_VARIANT[score]}
            />
            {investmentScoreBegruendung && (
              <p className="text-sm text-muted-foreground leading-relaxed pt-1 flex-1 min-w-[200px]">
                {investmentScoreBegruendung}
              </p>
            )}
          </div>
        )}

        {risiken.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1.5">
              Risiken aus Investorensicht
            </h4>
            <ul className="flex flex-col gap-1">
              {risiken.map((r, i) => (
                <li key={i} className="text-sm text-muted-foreground flex gap-1.5">
                  <span className="text-[var(--warning)]">!</span> {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasErtragswert && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Ertragswert</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {moeglicherKaltmiete != null && (
                <InfoBox
                  label="Mögliche Kaltmiete"
                  value={`${formatEur(moeglicherKaltmiete) ?? moeglicherKaltmiete} /Monat`}
                />
              )}
              {hausgeld != null && (
                <InfoBox label="Hausgeld" value={`${formatEur(hausgeld) ?? hausgeld} /Monat`} />
              )}
              {jahresrohertrag != null && (
                <InfoBox
                  label="Jahresrohertrag"
                  value={formatEur(jahresrohertrag) ?? String(jahresrohertrag)}
                  highlight
                />
              )}
              {liegenschaftszinssatz != null && (
                <InfoBox
                  label="Liegenschaftszinssatz"
                  value={`${Number(liegenschaftszinssatz).toFixed(2)} %`}
                />
              )}
              {ertragswert != null && (
                <InfoBox
                  label="Ertragswert"
                  value={formatEur(ertragswert) ?? String(ertragswert)}
                  highlight
                />
              )}
            </div>
          </div>
        )}

        {massnahmen.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h4 className="text-sm font-semibold text-foreground">Fix &amp; Flip – Maßnahmen</h4>
              {gesamtkosten && (
                <span className="font-mono text-xs text-muted-foreground">
                  Gesamtkosten (geschätzt):{" "}
                  <span className="font-semibold text-foreground">{gesamtkosten}</span>
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {massnahmen.map((m, i) => {
                const prio = (m.prioritaet ?? "").toLowerCase();
                const prioLabel = PRIORITAET_LABEL[prio] ?? (prio.toUpperCase() || "—");
                return (
                  <KiFinding
                    key={i}
                    tag={[prioLabel, m.kategorie?.toUpperCase()].filter(Boolean).join(" · ")}
                    text={m.beschreibung}
                    severity={PRIORITAET_SEVERITY[prio] ?? "info"}
                    amount={formatKostenRange(m.kosten_min_eur, m.kosten_max_eur)}
                  />
                );
              })}
            </div>
            {fixFlipWerteinschaetzung &&
              (!hasDeal || fixFlipWerteinschaetzung !== arvBegruendung) && (
                <p className="text-sm text-muted-foreground leading-relaxed mt-3">
                  {fixFlipWerteinschaetzung}
                </p>
              )}
          </div>
        )}

        {hasDeal && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">
              Fix &amp; Flip – Deal-Kalkulation
            </h4>
            {flipVorbehalt && (
              <p className="mb-2 text-xs text-[var(--color-bietgrenze-5-10)]">{flipVorbehalt}</p>
            )}
            <FixFlipDealCard
              score={dealScore}
              kaufpreisEur={kaufpreisEur}
              kaufpreisLabel={kaufpreisLabel}
              fixFlipGesamtkostenMinEur={fixFlipGesamtkostenMinEur}
              fixFlipGesamtkostenMaxEur={fixFlipGesamtkostenMaxEur}
              erwerbsnebenkostenEur={erwerbsnebenkostenEur}
              holdingMonate={flip!.haltedauerMonate}
              holdingMonateMin={flip!.haltedauerMonateMin}
              holdingMonateMax={flip!.haltedauerMonateMax}
              flipGesamtinvestitionMinEur={flip!.gesamtinvestitionMinEur}
              flipGesamtinvestitionMaxEur={flip!.gesamtinvestitionMaxEur}
              arvMinEur={arvMinEur}
              arvMaxEur={arvMaxEur}
              arvKonfidenz={arvKonfidenz}
              flipGewinnMinEur={flip!.gewinnMinEur}
              flipGewinnMaxEur={flip!.gewinnMaxEur}
              flipRoiPctMin={flip!.roiPctMin}
              flipRoiPctMax={flip!.roiPctMax}
            />
            {arvBegruendung && (
              <p className="text-sm text-muted-foreground leading-relaxed mt-3">{arvBegruendung}</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Spanne aus Bear- und Bull-Szenario des Underwritings (Finanzierung{" "}
              {(financingRatePct ?? DEFAULT_INVESTOR_PROFILE.financingRatePct).toLocaleString(
                "de-DE",
                { maximumFractionDigits: 1 },
              )}{" "}
              %, Verkaufskosten 5 %, Sanierungspuffer im Bear Case). Ohne separat verlinkte
              Vergleichsobjekte ist der ARV keine verifizierte Markttransaktion. Keine
              Finanzierungs- oder Steuerberatung.
            </p>
          </div>
        )}
      </div>
    </KiSection>
  );
}

function FixFlipDealCard({
  score,
  kaufpreisEur,
  kaufpreisLabel,
  fixFlipGesamtkostenMinEur,
  fixFlipGesamtkostenMaxEur,
  erwerbsnebenkostenEur,
  holdingMonate,
  holdingMonateMin,
  holdingMonateMax,
  flipGesamtinvestitionMinEur,
  flipGesamtinvestitionMaxEur,
  arvMinEur,
  arvMaxEur,
  arvKonfidenz,
  flipGewinnMinEur,
  flipGewinnMaxEur,
  flipRoiPctMin,
  flipRoiPctMax,
  compact = false,
}: {
  score?: InvestmentScore;
  kaufpreisEur?: number | string | null;
  kaufpreisLabel?: string | null;
  fixFlipGesamtkostenMinEur?: number | string | null;
  fixFlipGesamtkostenMaxEur?: number | string | null;
  erwerbsnebenkostenEur?: number | string | null;
  holdingMonate?: number | string | null;
  holdingMonateMin?: number | string | null;
  holdingMonateMax?: number | string | null;
  flipGesamtinvestitionMinEur?: number | string | null;
  flipGesamtinvestitionMaxEur?: number | string | null;
  arvMinEur?: number | string | null;
  arvMaxEur?: number | string | null;
  arvKonfidenz?: string | null;
  flipGewinnMinEur?: number | string | null;
  flipGewinnMaxEur?: number | string | null;
  flipRoiPctMin?: number | string | null;
  flipRoiPctMax?: number | string | null;
  compact?: boolean;
}) {
  // Haltekosten werden als Residual gezeigt (Gesamtinvestition − Kaufpreis −
  // Sanierung − Nebenkosten), damit die Summe der angezeigten Zeilen immer
  // exakt der angezeigten Gesamtinvestition entspricht.
  const kaufpreis = kaufpreisEur != null ? Number(kaufpreisEur) : null;
  const sanierungMin =
    fixFlipGesamtkostenMinEur != null ? Math.round(Number(fixFlipGesamtkostenMinEur) * 1.1) : 0;
  const sanierungMax =
    fixFlipGesamtkostenMaxEur != null ? Math.round(Number(fixFlipGesamtkostenMaxEur) * 1.1) : 0;
  const nebenkosten = erwerbsnebenkostenEur != null ? Number(erwerbsnebenkostenEur) : null;
  const gesamtinvestitionMin =
    flipGesamtinvestitionMinEur != null ? Number(flipGesamtinvestitionMinEur) : null;
  const haltekosten =
    kaufpreis != null && nebenkosten != null && gesamtinvestitionMin != null
      ? gesamtinvestitionMin - kaufpreis - sanierungMin - nebenkosten
      : null;

  return (
    <div
      className={cn("border rounded-[4px] bg-[var(--surface-toolbar)]", compact ? "p-3" : "p-4")}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <dl className="flex flex-col gap-1.5 text-sm flex-1 min-w-[220px]">
          {kaufpreis != null && (
            <Row label={kaufpreisLabel ?? "Kaufpreis"} value={formatEur(kaufpreis)} />
          )}
          {(sanierungMin > 0 || sanierungMax > 0) && (
            <Row
              label="+ Sanierung (+10 % Puffer)"
              value={formatEurRange(sanierungMin, sanierungMax)}
            />
          )}
          {nebenkosten != null && (
            <Row label="+ Erwerbsnebenkosten" value={formatEur(nebenkosten)} />
          )}
          {haltekosten != null && (
            <Row
              label={`+ Haltekosten (${formatHoldingMonths(holdingMonateMin, holdingMonateMax, holdingMonate)})`}
              value={formatEur(haltekosten)}
            />
          )}
          <Row
            label="Deal-Gesamtinvestition"
            value={formatEurRange(flipGesamtinvestitionMinEur, flipGesamtinvestitionMaxEur)}
            bold
          />
          <Row
            label="After-Repair-Value (Schätzung)"
            value={formatEurRange(arvMinEur, arvMaxEur)}
            suffix={
              arvKonfidenz ? ` [${ARV_KONFIDENZ_LABEL[arvKonfidenz] ?? arvKonfidenz}]` : undefined
            }
          />
          <Row
            label="Geschätzter Gewinn"
            value={formatEurRange(flipGewinnMinEur, flipGewinnMaxEur)}
            bold
            highlight
          />
          <Row
            label="Flip-ROI (konservativ / optimistisch)"
            value={formatPctRange(flipRoiPctMin, flipRoiPctMax)}
            highlight
          />
        </dl>
        {score && (
          <StatusBox
            label="Fix&Flip-Chance"
            sublabel="Berechnet aus Flip-ROI (nicht Kapitalanlage-Score)"
            value={INVESTMENT_SCORE_LABEL[score]}
            variant={INVESTMENT_SCORE_VARIANT[score]}
          />
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold = false,
  highlight = false,
  suffix,
}: {
  label: string;
  value?: string | null;
  bold?: boolean;
  highlight?: boolean;
  suffix?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          bold && "font-semibold text-foreground",
          highlight && "text-primary font-semibold",
          !bold && !highlight && "font-medium text-foreground",
        )}
      >
        {value}
        {suffix}
      </dd>
    </div>
  );
}

function InfoBox({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "border rounded-[4px] p-3 text-center",
        highlight ? "bg-accent border-primary/30" : "bg-muted/50 border-border",
      )}
    >
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className={cn("text-sm font-semibold", highlight ? "text-primary" : "text-foreground")}>
        {value}
      </p>
    </div>
  );
}

function StatusBox({
  label,
  sublabel,
  value,
  variant,
}: {
  label: string;
  /** Kurzer Kontext-Hinweis unter dem Score-Wert (z.B. Anlagestrategie), damit
   * abweichende Scores verschiedener Sektionen für dasselbe Objekt nicht wie
   * ein Widerspruch wirken (siehe Bug 3, 2026-07-09). */
  sublabel?: string;
  value: string;
  variant: "green" | "amber" | "red" | "gray";
}) {
  const styles = {
    green:
      "bg-[var(--success-container)] text-[var(--success-container-fg)] border-[var(--success)]/30",
    amber:
      "bg-[var(--warning-container)] text-[var(--warning-container-fg)] border-[var(--warning)]/30",
    red: "bg-[var(--error-container)] text-[var(--error-container-fg)] border-[var(--destructive)]/30",
    gray: "bg-muted/50 text-foreground border-border",
  };
  return (
    <div className={cn("border rounded-[4px] p-3 text-center shrink-0 w-40", styles[variant])}>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
      {sublabel && <p className="text-[11px] text-muted-foreground/80 mt-0.5">{sublabel}</p>}
    </div>
  );
}
