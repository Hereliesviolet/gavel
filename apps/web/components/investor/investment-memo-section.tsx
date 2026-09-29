import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InvestorQualityBadge } from "@/components/investor/investor-quality-badge";
import { InvestmentFeedback } from "@/components/investor/investment-feedback";
import type { InvestmentMemo, InvestmentMemoDecision } from "@/lib/investor-memo";
import { cn, formatCurrency } from "@/lib/utils";
import { isPublicZvgSourceUrl } from "@/lib/zvg-documents";

const DECISION_LABEL: Record<InvestmentMemoDecision, string> = {
  weiter_pruefen: "Weiter prüfen",
  beobachten: "Beobachten",
  ausscheiden: "Ausscheiden",
  nicht_bewertbar: "Nicht bewertbar",
};

const DECISION_CLASS: Record<InvestmentMemoDecision, string> = {
  weiter_pruefen:
    "border-[var(--success)]/35 bg-[var(--success-container)] text-[var(--success-container-fg)]",
  beobachten:
    "border-[var(--warning)]/35 bg-[var(--warning-container)] text-[var(--warning-container-fg)]",
  ausscheiden: "border-destructive/35 bg-destructive/10 text-destructive",
  nicht_bewertbar:
    "border-[var(--warning)]/35 bg-[var(--warning-container)] text-[var(--warning-container-fg)]",
};

const SCENARIO_LABEL = {
  bear: "Bear",
  base: "Base",
  bull: "Bull",
} as const;

function formatPct(value: number | null): string {
  return value == null
    ? "—"
    : `${value.toLocaleString("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} %`;
}

function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/api/zvg/") && !value.includes("\\") && !value.includes("://")) {
    return value;
  }
  return isPublicZvgSourceUrl(value) ? value : null;
}

export function InvestmentMemoSection({
  memo,
  listingId,
}: {
  memo: InvestmentMemo;
  listingId: string;
}) {
  const { quality, underwriting } = memo;

  return (
    <Card id="section-investment-memo" className="border-primary/30">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary mb-1">
              Investor Decision Memo
            </div>
            <CardTitle className="text-lg">{memo.headline}</CardTitle>
            <CardDescription className="mt-1">
              Gebotszentrierte Bear/Base/Bull-Rechnung. Verkehrswert ist Referenz, nicht Kaufpreis.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <InvestorQualityBadge quality={quality} />
            <span
              className={cn(
                "inline-flex rounded-[4px] border px-2 py-1 font-mono text-[10px] uppercase tracking-wide",
                DECISION_CLASS[memo.decision],
              )}
            >
              {DECISION_LABEL[memo.decision]}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Vorl. Profil-Maximalgebot"
            value={memo.maxBidEur == null ? "Nicht ableitbar" : formatCurrency(memo.maxBidEur)}
            note={
              memo.maxBidEur == null
                ? "Erst nach Schließen der Datenlücken"
                : "Noch keine Gebotsfreigabe; Rechte und Terminsdaten verifizieren"
            }
          />
          <Metric
            label="Referenzgebot"
            value={formatCurrency(underwriting.referenceBidEur)}
            note={`${underwriting.referenceBidPct?.toFixed(0) ?? "—"} % des gerichtlichen Verkehrswerts · Rechenszenario`}
          />
          <Metric
            label="Offene Prüfpunkte"
            value={String(quality.blockers.length + quality.warnings.length)}
            note={
              quality.blockers.length > 0
                ? `${quality.blockers.length} davon blockierend · ${quality.rulesVersion}`
                : `Keine Blocker · ${quality.rulesVersion}`
            }
          />
          <Metric
            label="Investorenprofil"
            value={`${underwriting.profile.equityPct} % EK`}
            note={`DSCR ≥ ${underwriting.profile.minDscr.toFixed(2)} · CoC ≥ ${underwriting.profile.targetCashOnCashPct.toFixed(1)} %`}
          />
        </div>

        {(underwriting.buyHold.length > 0 || underwriting.fixFlip.length > 0) && (
          <div className="grid gap-5 xl:grid-cols-2">
            {underwriting.buyHold.length > 0 && (
              <ScenarioTable
                title="Buy & Hold"
                rows={underwriting.buyHold.map((row) => ({
                  name: row.name,
                  primary: `DSCR ${row.dscr?.toFixed(2) ?? "—"}`,
                  secondary: `CoC ${formatPct(row.cashOnCashPct)} · EK ${formatCurrency(row.equityRequiredEur)}`,
                  result: formatCurrency(row.cashflowBeforeTaxEur),
                  maxBid: row.maxBidEur,
                }))}
              />
            )}
            {underwriting.fixFlip.length > 0 && (
              <ScenarioTable
                title="Fix & Flip"
                rows={underwriting.fixFlip.map((row) => ({
                  name: row.name,
                  primary: `Marge ${formatPct(row.marginOnCostPct)}`,
                  secondary: `ARV ${formatCurrency(row.arvEur)} · EK ${formatCurrency(row.equityRequiredEur)}`,
                  result: formatCurrency(row.profitEur),
                  maxBid: row.maxBidEur,
                }))}
              />
            )}
          </div>
        )}

        {underwriting.bidCurve.length > 0 && <BidCurveTable rows={underwriting.bidCurve} />}

        <div className="grid gap-5 lg:grid-cols-3">
          <MemoList
            icon={CheckCircle2}
            title="Investmentthese"
            items={memo.thesis}
            empty="Noch keine belastbare These ableitbar."
          />
          <MemoList
            icon={AlertTriangle}
            title="Kill-Kriterien"
            items={memo.killCriteria}
            empty="Keine automatischen Ausschlusskriterien erkannt."
          />
          <MemoList icon={FileSearch} title="Due Diligence" items={memo.dueDiligence} />
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Evidenz &amp; Grenzen</h3>
          </div>
          <div className="divide-y divide-border rounded-[4px] border border-border">
            {memo.sources.map((source, index) => {
              const href = safeExternalUrl(source.url);
              return (
                <div
                  key={`${source.kind}-${source.label}-${index}`}
                  className="flex items-start justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{source.label}</div>
                    {source.note && (
                      <div className="text-xs text-muted-foreground mt-0.5">{source.note}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "font-mono text-[9px] uppercase",
                        source.verified ? "text-[var(--success)]" : "text-[var(--warning)]",
                      )}
                    >
                      {source.verified ? "verifiziert" : "Indikation"}
                    </span>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${source.label} öffnen`}
                        className="text-primary hover:text-primary/75"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Referenz- und Maximalgebote sind vorläufige Modellergebnisse, keine Gebotsfreigabe.
            Geringstes Gebot, bestehenbleibende Rechte, Besitzübergang, Steuern, Rechtsberatung und
            Bankkonditionen müssen verifiziert werden. Berechnung: {underwriting.version}.
          </p>
        </div>

        <InvestmentFeedback
          listingId={listingId}
          analysisVersion={`${quality.rulesVersion}:${underwriting.version}`}
        />
      </CardContent>
    </Card>
  );
}

function BidCurveTable({ rows }: { rows: InvestmentMemo["underwriting"]["bidCurve"] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Calculator className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Gebotskurve</h3>
        <span className="text-xs text-muted-foreground">
          Wirkung verschiedener Gebote auf beide Strategien
        </span>
      </div>
      <div className="overflow-x-auto rounded-[4px] border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Gebot</th>
              <th className="px-3 py-2 font-medium">Buy &amp; Hold</th>
              <th className="px-3 py-2 font-medium">Fix &amp; Flip</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.bidPct} className={row.bidPct === 70 ? "bg-primary/5" : undefined}>
                <td className="px-3 py-2 font-mono">
                  {row.bidPct} % VW · {formatCurrency(row.bidEur)}
                </td>
                <td className="px-3 py-2">
                  CoC {formatPct(row.buyHoldCashOnCashPct)} · DSCR{" "}
                  {row.buyHoldDscr?.toFixed(2) ?? "—"} · CF{" "}
                  {row.buyHoldCashflowEur == null ? "—" : formatCurrency(row.buyHoldCashflowEur)}
                </td>
                <td className="px-3 py-2">
                  Marge {formatPct(row.flipMarginPct)} · Gewinn{" "}
                  {row.flipProfitEur == null ? "—" : formatCurrency(row.flipProfitEur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[4px] border border-border bg-muted/20 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function ScenarioTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    name: "bear" | "base" | "bull";
    primary: string;
    secondary: string;
    result: string;
    maxBid: number | null;
  }>;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <Calculator className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto rounded-[4px] border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Szenario</th>
              <th className="px-3 py-2 font-medium">Kennzahl</th>
              <th className="px-3 py-2 font-medium">Ergebnis</th>
              <th className="px-3 py-2 font-medium">Max. Gebot</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.name} className={row.name === "base" ? "bg-primary/5" : undefined}>
                <td className="px-3 py-2 font-medium">{SCENARIO_LABEL[row.name]}</td>
                <td className="px-3 py-2">
                  <div>{row.primary}</div>
                  <div className="text-muted-foreground">{row.secondary}</div>
                </td>
                <td className="px-3 py-2 font-mono">{row.result}</td>
                <td className="px-3 py-2 font-mono">
                  {row.maxBid == null ? "—" : formatCurrency(row.maxBid)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MemoList({
  icon: Icon,
  title,
  items,
  empty,
}: {
  icon: typeof CheckCircle2;
  title: string;
  items: string[];
  empty?: string;
}) {
  const visibleItems = items.length > 0 ? items : empty ? [empty] : [];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        {visibleItems.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-primary">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
