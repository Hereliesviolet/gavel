import Link from "next/link";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { eq, and, asc, isNotNull, count } from "drizzle-orm";
import { formatClockTime, formatCurrency } from "@/lib/utils";
import { upcomingTerminSql } from "@/lib/termin-sql";
import { zvgListingPath } from "@/lib/zvg-documents";
import { UrgencyBadge, daysUntil } from "@/components/ui/urgency-badge";
import { CategoryTag } from "@/components/ui/category-accent";
import { listingKategorieFuerPeer } from "@/lib/listing-kategorie";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { ResultBar } from "@/components/ui/result-bar";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termine · Gavel" };

export const revalidate = 300;

const TERMINE_PAGE_LIMIT = 500;

async function getTermine() {
  const where = and(
    eq(zvgListings.istAktiv, true),
    upcomingTerminSql(),
    isNotNull(zvgListings.terminDate),
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: zvgListings.id,
        slug: zvgListings.slug,
        bundesland: zvgListings.bundesland,
        adresse: zvgListings.adresse,
        ort: zvgListings.ort,
        typ: zvgListings.typ,
        kategorie: zvgListings.kategorie,
        verkehrswert: zvgListings.verkehrswert,
        terminDate: zvgListings.terminDate,
        amtsgericht: zvgListings.amtsgericht,
        wohnflaecheM2: zvgListings.wohnflaecheM2,
      })
      .from(zvgListings)
      .where(where)
      .orderBy(asc(zvgListings.terminDate), asc(zvgListings.id))
      .limit(TERMINE_PAGE_LIMIT),
    db.select({ total: count() }).from(zvgListings).where(where),
  ]);

  const seen = new Set<string>();
  const termine = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  return { termine, total: Number(total ?? 0) };
}

function formatTerminDate(d: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

function formatTerminTime(d: Date) {
  return formatClockTime(d) ?? "—";
}

// Termine nach Monat gruppieren
function groupByMonth(termine: Awaited<ReturnType<typeof getTermine>>["termine"]) {
  const groups = new Map<string, typeof termine>();
  for (const t of termine) {
    if (!t.terminDate) continue;
    const key = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      month: "long",
      year: "numeric",
    }).format(t.terminDate);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return groups;
}

export default async function TerminePage() {
  const { termine, total } = await getTermine();
  const grouped = groupByMonth(termine);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Zwangsversteigerungen · Termine"
        title="Termine"
        description="Bevorstehende Versteigerungstermine, nach Monat gruppiert."
      />
      <ResultBar count={total} shown={termine.length} unit="Termine" className="mb-6" />

      {grouped.size === 0 ? (
        <EmptyState message="Keine bevorstehenden Termine." />
      ) : (
        Array.from(grouped.entries()).map(([monat, items]) => (
          <div key={monat} className="mb-8">
            {/* Monats-Header */}
            <div className="flex items-center gap-3 mb-2 py-2 border-b border-border/60">
              <span className="text-xs font-mono font-semibold uppercase tracking-widest text-muted-foreground">
                {monat}
              </span>
              <span className="text-xs font-mono text-muted-foreground/60">
                {items.length} Termine
              </span>
            </div>

            {/* Tabelle (ab sm) */}
            <div className="w-full hidden sm:block">
              {/* Header */}
              <div className="grid grid-cols-[110px_90px_1fr_130px_140px_80px_32px] gap-x-4 px-3 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-widest text-muted-foreground/60 border-b border-border/30">
                <span>Datum</span>
                <span>Zeit</span>
                <span>Objekt</span>
                <span className="text-right">Verkehrswert</span>
                <span>Amtsgericht</span>
                <span>Kat.</span>
                <span />
              </div>

              {/* Rows */}
              {items.map((t) => {
                const days = t.terminDate ? daysUntil(t.terminDate) : null;
                return (
                  <Link
                    key={t.id}
                    href={zvgListingPath(t.bundesland, t.slug) ?? "/termine"}
                    className="grid grid-cols-[110px_90px_1fr_130px_140px_80px_32px] gap-x-4 px-3 py-2.5 border-b border-border/20 hover:bg-muted/20 transition-colors group items-center"
                  >
                    {/* Datum */}
                    <span className="font-mono text-xs text-foreground">
                      {t.terminDate ? formatTerminDate(t.terminDate) : "—"}
                    </span>

                    {/* Zeit + Urgency */}
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs text-foreground">
                        {t.terminDate ? formatTerminTime(t.terminDate) : "—"}
                      </span>
                      {days !== null && days >= 0 && <UrgencyBadge days={days} />}
                    </div>

                    {/* Objekt */}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {t.typ ?? "Immobilie"}
                        {t.wohnflaecheM2 ? ` · ${t.wohnflaecheM2} m²` : ""}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">
                        {t.adresse ?? t.ort ?? "—"}
                      </p>
                    </div>

                    {/* Verkehrswert */}
                    <span className="font-mono text-xs font-semibold text-primary text-right tabular-nums">
                      {formatCurrency(t.verkehrswert)}
                    </span>

                    {/* Amtsgericht */}
                    <div className="min-w-0">
                      <span className="text-[10px] font-mono text-muted-foreground/60">AG </span>
                      <span className="text-xs font-mono text-foreground/80 truncate">
                        {t.amtsgericht ?? "—"}
                      </span>
                    </div>

                    {/* Kategorie */}
                    <div>
                      <CategoryTag kategorie={listingKategorieFuerPeer(t.kategorie, t.typ)} />
                    </div>

                    {/* Arrow */}
                    <ArrowRight className="size-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                  </Link>
                );
              })}
            </div>

            {/* Karten (unter sm) */}
            <div className="flex flex-col gap-2 sm:hidden">
              {items.map((t) => {
                const days = t.terminDate ? daysUntil(t.terminDate) : null;
                return (
                  <Link
                    key={t.id}
                    href={zvgListingPath(t.bundesland, t.slug) ?? "/termine"}
                    className="flex items-start gap-3 rounded-[4px] border border-border/40 px-3 py-3 hover:bg-muted/20 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-foreground">
                          {t.terminDate ? formatTerminDate(t.terminDate) : "—"}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.terminDate ? formatTerminTime(t.terminDate) : "—"}
                        </span>
                        {days !== null && days >= 0 && <UrgencyBadge days={days} />}
                      </div>

                      <p className="text-sm font-medium text-foreground truncate mt-1.5">
                        {t.typ ?? "Immobilie"}
                        {t.wohnflaecheM2 ? ` · ${t.wohnflaecheM2} m²` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground truncate font-mono">
                        {t.adresse ?? t.ort ?? "—"}
                      </p>

                      <div className="flex items-center justify-between gap-2 mt-2">
                        <div className="min-w-0 flex items-center gap-1.5">
                          <span className="text-[10px] font-mono text-muted-foreground/60">AG</span>
                          <span className="text-xs font-mono text-foreground/80 truncate">
                            {t.amtsgericht ?? "—"}
                          </span>
                        </div>
                        <CategoryTag
                          kategorie={listingKategorieFuerPeer(t.kategorie, t.typ)}
                          className="shrink-0"
                        />
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/20">
                        <span className="font-mono text-sm font-semibold text-primary tabular-nums">
                          {formatCurrency(t.verkehrswert)}
                        </span>
                        <ArrowRight className="size-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))
      )}
    </PageShell>
  );
}
