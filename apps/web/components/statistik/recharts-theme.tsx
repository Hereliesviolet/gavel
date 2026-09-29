"use client";

/**
 * Recharts theme for the dark palette defined in app/globals.css.
 * Values via CSS vars; no provider component.
 */

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export const CHART_COLOR_BY_KATEGORIE: Record<string, string> = {
  wohnung: "var(--kat-wohnung)",
  haus: "var(--kat-haus)",
  grundstueck: "var(--kat-grundstueck)",
  gewerbe: "var(--kat-gewerbe)",
};

export const axisProps = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  tickLine: false,
  axisLine: { stroke: "var(--border)" } as const,
};

export const gridProps = {
  stroke: "var(--border)",
  strokeOpacity: 0.5,
  strokeDasharray: "0",
  vertical: false,
} as const;

export const tooltipStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  color: "var(--foreground)",
  padding: "8px 12px",
  boxShadow: "none",
};

export const tooltipLabelStyle: React.CSSProperties = {
  color: "var(--muted-foreground)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  marginBottom: 4,
};
