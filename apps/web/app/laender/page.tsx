import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { and, eq, count, lt, sql } from "drizzle-orm";
import {
  addZonedCalendarDays,
  BUNDESLAENDER,
  exclusiveZonedCalendarHorizon,
  startOfZonedDay,
} from "@/lib/utils";
import { normalizeBundeslandKey } from "@/lib/bundesland";
import { DEFAULT_TERMIN_HORIZON_DAYS, upcomingTerminSql } from "@/lib/termin-sql";
import { SectionHeader } from "@/components/ui/section-header";
import type { Metadata } from "next";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Alle Bundesländer – Gavel",
  description:
    "Übersicht aller 16 Bundesländer mit aktiven Zwangsversteigerungen. Finden Sie Objekte nach Bundesland gefiltert.",
};

async function getBundeslaenderData() {
  try {
    const sevenDaysAgoIso = addZonedCalendarDays(startOfZonedDay(), -7).toISOString();

    const stats = await db
      .select({
        bundesland: zvgListings.bundesland,
        gesamtCount: count(),
        neu7Tage:
          sql<number>`COUNT(*) FILTER (WHERE ${zvgListings.createdAt} >= ${sevenDaysAgoIso}::timestamptz)`.mapWith(
            Number,
          ),
      })
      .from(zvgListings)
      .where(
        and(
          eq(zvgListings.istAktiv, true),
          upcomingTerminSql(),
          lt(zvgListings.terminDate, exclusiveZonedCalendarHorizon(DEFAULT_TERMIN_HORIZON_DAYS)),
        ),
      )
      .groupBy(zvgListings.bundesland);

    const statsMap: Record<string, { count: number; neu7Tage: number }> = {};
    for (const s of stats) {
      const key = normalizeBundeslandKey(s.bundesland);
      const existing = statsMap[key];
      if (existing) {
        statsMap[key] = {
          count: existing.count + Number(s.gesamtCount),
          neu7Tage: existing.neu7Tage + s.neu7Tage,
        };
      } else {
        statsMap[key] = { count: Number(s.gesamtCount), neu7Tage: s.neu7Tage };
      }
    }

    return [...BUNDESLAENDER]
      .sort((a, b) => a.kuerzel.localeCompare(b.kuerzel))
      .map((bl) => {
        const key = normalizeBundeslandKey(bl.slug);
        return {
          ...bl,
          count: statsMap[key]?.count ?? 0,
          neu7Tage: statsMap[key]?.neu7Tage ?? 0,
        };
      });
  } catch (err) {
    console.error("[laender/getBundeslaenderData] FEHLER:", err);
    return null;
  }
}

export default async function LaenderPage() {
  const bundeslaender = await getBundeslaenderData();
  const unavailable = bundeslaender == null;
  const totalActive = bundeslaender?.reduce((sum, bl) => sum + bl.count, 0) ?? 0;
  const totalNeu7 = bundeslaender?.reduce((sum, bl) => sum + bl.neu7Tage, 0) ?? 0;
  const sorted = [...(bundeslaender ?? [])].sort((a, b) => b.count - a.count);

  return (
    <div className="min-h-full">
      {/* HEADER */}
      <section className="px-6 pt-10 pb-7 border-b border-border">
        <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4 font-mono">
          <Link href="/" className="hover:text-primary transition-colors">
            Deutschland
          </Link>
          <ChevronRight className="size-3" />
          <span className="text-foreground">Alle Bundesländer</span>
        </nav>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="label-mono text-primary tracking-[0.14em] mb-2">
              Bundesweite Übersicht
            </div>
            <h1 className="text-3xl font-semibold tracking-tight leading-[1.1]">
              Alle 16 Bundesländer
            </h1>
          </div>

          <div className="flex gap-4 text-right">
            <div className="border border-border bg-card px-4 py-2.5">
              <div className="font-mono text-2xl font-semibold tabular-nums">
                {unavailable ? "—" : totalActive.toLocaleString("de-DE")}
              </div>
              <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                Aktive Objekte
              </div>
            </div>
            <div className="border border-border bg-card px-4 py-2.5">
              <div className="font-mono text-2xl font-semibold tabular-nums text-[var(--success)]">
                {unavailable ? "—" : `+${totalNeu7.toLocaleString("de-DE")}`}
              </div>
              <div className="text-[11px] text-muted-foreground font-mono mt-0.5">Neu · 7 Tage</div>
            </div>
          </div>
        </div>
      </section>

      {/* GRID */}
      <section className="px-6 py-7">
        <SectionHeader
          label={`Bundesländer · ${unavailable ? "—" : (bundeslaender?.length ?? "—")} · sortiert nach Aktivität`}
          action={
            <div className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="size-3" />
              <span>Deutschland</span>
            </div>
          }
        />

        {unavailable ? (
          <p className="text-sm text-muted-foreground">Daten nicht verfügbar.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-px bg-border border border-border">
            {sorted.map((bl, idx) => (
              <Link
                key={bl.kuerzel}
                href={`/${bl.slug}`}
                className="group bg-card p-4 flex flex-col gap-1.5 min-h-[110px] hover:bg-muted/50 transition-colors relative"
              >
                {/* Rang-Badge (Top 3) */}
                {idx < 3 && (
                  <span className="absolute top-2.5 right-2.5 font-mono text-[9px] px-1.5 py-0.5 bg-[var(--primary-container)] text-[var(--primary-container-fg)]">
                    #{idx + 1}
                  </span>
                )}

                <div className="flex items-baseline justify-between gap-1 pr-6">
                  <span className="text-xl font-bold tracking-tight leading-none">
                    {bl.kuerzel}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {bl.count > 0 ? bl.count.toLocaleString("de-DE") : "—"}
                  </span>
                </div>

                <span className="text-xs text-muted-foreground leading-tight">{bl.name}</span>

                <div className="flex items-center justify-between mt-auto pt-1">
                  <span
                    className={
                      bl.neu7Tage > 0
                        ? "font-mono text-[10px] text-[var(--success)]"
                        : "font-mono text-[10px] text-muted-foreground/40"
                    }
                  >
                    {bl.neu7Tage > 0 ? `+${bl.neu7Tage} neu` : "keine neuen"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/0 group-hover:text-muted-foreground transition-colors">
                    →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!unavailable && (
          <p className="mt-4 text-xs text-muted-foreground font-mono">
            Daten werden stündlich aktualisiert · Sortierung nach Anzahl aktiver Objekte
          </p>
        )}
      </section>
    </div>
  );
}
