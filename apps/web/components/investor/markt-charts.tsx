"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CHART_COLORS,
  CHART_COLOR_BY_KATEGORIE,
  axisProps,
  gridProps,
  tooltipStyle,
  tooltipLabelStyle,
} from "@/components/statistik/recharts-theme";
import Link from "next/link";
import { zvgListingPath } from "@/lib/zvg-documents";
import { AlertTriangle, Clock, TrendingDown, Building2, Target, Database } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BLData {
  bundesland: string;
  bundeslandName: string;
  count: number;
  avgVw: string | null;
}

interface KatData {
  kategorie: string | null;
  count: number;
}

interface VwData {
  bracket: string;
  anzahl: number;
}

interface DringlichkeitData {
  in7: number;
  in14: number;
  in30: number;
}

interface PreisNachKatData {
  kategorie: string;
  avg: number;
  min: number;
  max: number;
  count: number;
}

interface TopAmtsgerichtData {
  amtsgericht: string;
  count: number;
  avgPreis: number;
}

interface TerminMonatData {
  monat: string;
  monatLabel: string;
  count: number;
}

interface TopChanceData {
  id: string;
  slug: string;
  bundesland: string;
  adresse: string | null;
  ort: string | null;
  verkehrswert: number;
  wohnflaecheM2: number;
  preisProM2: number;
  terminDate: Date | null;
}

interface DatenQualitaetData {
  gesamt: number;
  mitBild: number;
  mitKi: number;
  mitDirektlink: number;
}

interface Props {
  nachBundesland: BLData[];
  nachKategorie: KatData[];
  vwVerteilung: VwData[];
  dringlichkeit: DringlichkeitData;
  preiseNachKategorie: PreisNachKatData[];
  topAmtsgerichte: TopAmtsgerichtData[];
  termineProMonat: TerminMonatData[];
  topChancen: TopChanceData[];
  datenQualitaet: DatenQualitaetData;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEur(val: number | null | undefined): string {
  if (!val || isNaN(val)) return "—";
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)} Mio. €`;
  if (val >= 1_000) return `${Math.round(val / 1_000).toLocaleString("de-DE")} k€`;
  return `${Math.round(val).toLocaleString("de-DE")} €`;
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

const KAT_LABEL: Record<string, string> = {
  wohnung: "Wohnung",
  haus: "Haus",
  grundstueck: "Grundstück",
  gewerbe: "Gewerbe",
  Andere: "Andere",
};

// ─── Dringlichkeits-Cards ────────────────────────────────────────────────────

function DringlichkeitRow({ data }: { data: DringlichkeitData }) {
  const items = [
    {
      label: "Innerhalb 7 Tage",
      count: data.in7,
      color: "var(--destructive)",
      bg: "bg-destructive/10 border-destructive/30",
    },
    {
      label: "Innerhalb 14 Tage",
      count: data.in14,
      color: "var(--chart-4)",
      bg: "bg-muted border-border",
    },
    {
      label: "Innerhalb 30 Tage",
      count: data.in30,
      color: "var(--chart-1)",
      bg: "bg-neon-muted/20 border-neon-muted/40",
    },
  ];
  const max = Math.max(data.in30, 1);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      {items.map((item) => (
        <div key={item.label} className={`rounded-[4px] border p-4 ${item.bg}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {item.label}
            </span>
            <Clock className="size-3.5 text-muted-foreground" />
          </div>
          <p className="text-3xl font-bold tabular-nums" style={{ color: item.color }}>
            {item.count.toLocaleString("de-DE")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Versteigerungen</p>
          <div className="mt-3 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct(item.count, max)}%`, background: item.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Progress-Bar Datenqualität ───────────────────────────────────────────────

function DatenQualitaetCard({ data }: { data: DatenQualitaetData }) {
  const rows = [
    { label: "Mit Bild", value: pct(data.mitBild, data.gesamt), color: "var(--chart-2)" },
    { label: "KI-Analyse", value: pct(data.mitKi, data.gesamt), color: "var(--chart-1)" },
    { label: "Direktlink", value: pct(data.mitDirektlink, data.gesamt), color: "var(--chart-3)" },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="size-4 text-accent" />
          Datenqualität
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground font-mono">
          Basis: {data.gesamt.toLocaleString("de-DE")} aktive Objekte
        </p>
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-xs font-mono mb-1">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="text-foreground">{r.value} %</span>
            </div>
            <div className="h-2 rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${r.value}%`, background: r.color }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Preis nach Kategorie ─────────────────────────────────────────────────────

function PreisKategorieChart({ data }: { data: PreisNachKatData[] }) {
  const chartData = data.map((d) => ({
    name: KAT_LABEL[d.kategorie] ?? d.kategorie,
    "Ø Preis": Math.round(d.avg / 1000),
    Min: Math.round(d.min / 1000),
    Max: Math.round(d.max / 1000),
    kategorie: d.kategorie,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="size-4 text-accent" />Ø Verkehrswert nach Kategorie
        </CardTitle>
        <p className="text-xs text-muted-foreground">in Tausend €</p>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[420px]">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisProps} interval={0} />
                  <YAxis {...axisProps} tickFormatter={(v) => `${v}k`} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    cursor={{ fill: "rgba(255,255,255,0.08)" }}
                    formatter={(v) => [`${Number(v).toLocaleString("de-DE")} k€`]}
                  />
                  <Bar dataKey="Min" name="Minimum" radius={[3, 3, 0, 0]}>
                    {chartData.map((e) => (
                      <Cell
                        key={e.name}
                        fill={CHART_COLOR_BY_KATEGORIE[e.kategorie] ?? CHART_COLORS[0]}
                        fillOpacity={0.35}
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="Ø Preis" name="Durchschnitt" radius={[3, 3, 0, 0]}>
                    {chartData.map((e) => (
                      <Cell
                        key={e.name}
                        fill={CHART_COLOR_BY_KATEGORIE[e.kategorie] ?? CHART_COLORS[0]}
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="Max" name="Maximum" radius={[3, 3, 0, 0]}>
                    {chartData.map((e) => (
                      <Cell
                        key={e.name}
                        fill={CHART_COLOR_BY_KATEGORIE[e.kategorie] ?? CHART_COLORS[0]}
                        fillOpacity={0.6}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">Keine Daten</p>
        )}
        <div className="flex gap-4 mt-2 flex-wrap">
          {data.map((d) => (
            <div key={d.kategorie} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-full flex-shrink-0"
                style={{ background: CHART_COLOR_BY_KATEGORIE[d.kategorie] ?? CHART_COLORS[0] }}
              />
              <span className="text-[11px] font-mono text-muted-foreground">
                {KAT_LABEL[d.kategorie] ?? d.kategorie} ({d.count})
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Top Amtsgerichte Tabelle ─────────────────────────────────────────────────

function TopAmtsgerichteCard({ data }: { data: TopAmtsgerichtData[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="size-4 text-accent" />
          Top 10 Amtsgerichte
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.map((row, i) => (
            <div key={row.amtsgericht} className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-muted-foreground w-5 text-right">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="text-xs font-medium truncate">{row.amtsgericht}</span>
                  <span className="text-[11px] font-mono text-muted-foreground ml-2 flex-shrink-0">
                    {row.count} Obj.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct(row.count, maxCount)}%`,
                        background: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                    ⌀ {formatEur(row.avgPreis)}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {data.length === 0 && (
            <p className="font-mono text-xs text-muted-foreground">Keine Daten</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Termine pro Monat ────────────────────────────────────────────────────────

function TermineProMonatChart({ data }: { data: TerminMonatData[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Versteigerungen / Monat</CardTitle>
        <p className="text-xs text-muted-foreground">Nächste 3 Monate</p>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="monatLabel" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                cursor={{ fill: "rgba(255,255,255,0.08)" }}
                formatter={(v) => [Number(v).toLocaleString("de-DE"), "Termine"]}
              />
              <Bar dataKey="count" name="Termine" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center font-mono text-xs text-muted-foreground">
            Keine Termine in den nächsten 3 Monaten
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Top Chancen ──────────────────────────────────────────────────────────────

function TopChancenCard({ data }: { data: TopChanceData[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="size-4 text-accent" />
          Top Chancen — Niedrigster €/m²
        </CardTitle>
        <p className="text-xs text-muted-foreground">Objekte mit bekannter Wohnfläche</p>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="space-y-3">
            {data.map((obj, i) => (
              <Link
                key={obj.id}
                href={zvgListingPath(obj.bundesland, obj.slug) ?? "/investor/datenbasis"}
                className="flex items-start gap-3 group p-2 rounded-[4px] hover:bg-muted/50 -mx-2 transition-colors"
              >
                <span className="text-xs font-mono text-muted-foreground w-4 mt-0.5 flex-shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground group-hover:text-accent transition-colors truncate">
                    {obj.adresse ?? obj.ort ?? "Objekt ohne Adresse"}
                  </p>
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {obj.wohnflaecheM2.toLocaleString("de-DE")} m²
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      VW: {formatEur(obj.verkehrswert)}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span
                    className="text-sm font-bold tabular-nums"
                    style={{ color: "var(--chart-2)" }}
                  >
                    {Math.round(obj.preisProM2).toLocaleString("de-DE")} €/m²
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">
            Keine Objekte mit Wohnflächenangabe verfügbar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-[4px] bg-muted/30 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-72 rounded-[4px] bg-muted/30 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 rounded-[4px] bg-muted/30 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function MarktCharts({
  nachBundesland,
  nachKategorie,
  vwVerteilung,
  dringlichkeit,
  preiseNachKategorie,
  topAmtsgerichte,
  termineProMonat,
  topChancen,
  datenQualitaet,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <SkeletonGrid />;

  const blData = nachBundesland.slice(0, 10).map((b) => ({
    name: b.bundeslandName || b.bundesland,
    Anzahl: b.count,
  }));

  const katData = nachKategorie.map((k) => ({
    name: KAT_LABEL[k.kategorie ?? ""] ?? k.kategorie ?? "Andere",
    value: k.count,
    kategorie: k.kategorie ?? "",
  }));

  return (
    <div className="space-y-6">
      {/* ── Dringlichkeit ── */}
      <section>
        <h2 className="text-sm font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <AlertTriangle className="size-3.5" />
          Bald versteigert
        </h2>
        <DringlichkeitRow data={dringlichkeit} />
      </section>

      {/* ── Preisverteilung + Histogramm ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PreisKategorieChart data={preiseNachKategorie} />

        {/* Preisklassen-Histogramm */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Preisklassen-Verteilung</CardTitle>
            <p className="text-xs text-muted-foreground">Anzahl Objekte nach Verkehrswert</p>
          </CardHeader>
          <CardContent>
            {vwVerteilung.length > 0 ? (
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={vwVerteilung}
                      margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="bracket" {...axisProps} interval={0} />
                      <YAxis {...axisProps} allowDecimals={false} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        cursor={{ fill: "rgba(255,255,255,0.08)" }}
                        formatter={(v) => [Number(v).toLocaleString("de-DE"), "Objekte"]}
                      />
                      <Bar dataKey="anzahl" name="Anzahl" radius={[4, 4, 0, 0]}>
                        {vwVerteilung.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Keine Daten</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Top Amtsgerichte + Termine pro Monat ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopAmtsgerichteCard data={topAmtsgerichte} />
        <TermineProMonatChart data={termineProMonat} />
      </section>

      {/* ── Bundesland + Kategorie (bestehend, kompakter) ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bundesland Ranking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 10 Bundesländer</CardTitle>
          </CardHeader>
          <CardContent>
            {blData.length > 0 ? (
              <div className="overflow-x-auto">
                <div className="min-w-[440px]">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={blData}
                      layout="vertical"
                      margin={{ left: 0, right: 24, top: 0, bottom: 0 }}
                    >
                      <CartesianGrid {...gridProps} />
                      <XAxis type="number" {...axisProps} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" {...axisProps} width={175} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        cursor={{ fill: "rgba(255,255,255,0.08)" }}
                        formatter={(v) => [Number(v).toLocaleString("de-DE"), "Objekte"]}
                      />
                      <Bar dataKey="Anzahl" radius={[0, 4, 4, 0]}>
                        {blData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Keine Daten</p>
            )}
          </CardContent>
        </Card>

        {/* Kategorie Donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Objekte nach Kategorie</CardTitle>
          </CardHeader>
          <CardContent>
            {katData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={katData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={65}
                    outerRadius={110}
                    paddingAngle={3}
                  >
                    {katData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={
                          CHART_COLOR_BY_KATEGORIE[entry.kategorie] ??
                          CHART_COLORS[i % CHART_COLORS.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => [Number(v).toLocaleString("de-DE"), "Objekte"]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={10}
                    formatter={(val) => (
                      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{val}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Keine Daten</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Top Chancen + Datenqualität ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TopChancenCard data={topChancen} />
        <DatenQualitaetCard data={datenQualitaet} />
      </section>
    </div>
  );
}
