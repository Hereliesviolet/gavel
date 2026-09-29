import Link from "next/link";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { eq, count, desc, gte, and, asc, lt, sql } from "drizzle-orm";
import { LISTING_COVER_IMAGE_SQL } from "@/lib/listing-cover";
import {
  addZonedCalendarDays,
  BUNDESLAENDER,
  exclusiveZonedCalendarHorizon,
  formatClockTime,
  formatCurrency,
  startOfZonedDay,
} from "@/lib/utils";
import { DEFAULT_TERMIN_HORIZON_DAYS, upcomingTerminSql } from "@/lib/termin-sql";
import { normalizeBundeslandKey } from "@/lib/bundesland";
import { SectionHeader } from "@/components/ui/section-header";
import { DataTableGrid } from "@/components/ui/data-table-grid";
import { UrgencyBadge, daysUntil } from "@/components/ui/urgency-badge";
import { CategoryTag } from "@/components/ui/category-accent";
import { HeroSearch } from "@/components/zvg/hero-search";
import { listingKategorieFuerPeer } from "@/lib/listing-kategorie";
import { zvgListingPath } from "@/lib/zvg-documents";
import {
  NeusteObjekteSection,
  type NeuesteObjekteListing,
} from "@/components/zvg/neueste-objekte-section";

export const revalidate = 60;

async function getBundeslaenderData() {
  try {
    // WICHTIG: Date-Objekt als ISO-String übergeben, da Drizzle ORM 0.41
    // in sql-Template-Tags keine Date-Objekte direkt serialisieren kann
    // (wirft sonst TypeError: Received an instance of Date).
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

    // Aggregiere nach normalisierten Schlüsseln, um Scraper-Varianten zusammenzuführen
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
    console.error("[getBundeslaenderData] FEHLER:", err);
    return null;
  }
}

async function getUpcomingTermine() {
  try {
    const now = new Date();
    const horizon = exclusiveZonedCalendarHorizon(7, now);
    return await db
      .select({
        id: zvgListings.id,
        slug: zvgListings.slug,
        bundesland: zvgListings.bundesland,
        typ: zvgListings.typ,
        kategorie: zvgListings.kategorie,
        adresse: zvgListings.adresse,
        ort: zvgListings.ort,
        verkehrswert: zvgListings.verkehrswert,
        terminDate: zvgListings.terminDate,
        amtsgericht: zvgListings.amtsgericht,
      })
      .from(zvgListings)
      .where(
        and(
          eq(zvgListings.istAktiv, true),
          upcomingTerminSql(),
          lt(zvgListings.terminDate, horizon),
        ),
      )
      .orderBy(asc(zvgListings.terminDate), asc(zvgListings.id))
      .limit(20);
  } catch {
    return null;
  }
}

const RECENT_LISTING_FIELDS = {
  id: zvgListings.id,
  slug: zvgListings.slug,
  bundesland: zvgListings.bundesland,
  typ: zvgListings.typ,
  kategorie: zvgListings.kategorie,
  adresse: zvgListings.adresse,
  ort: zvgListings.ort,
  verkehrswert: zvgListings.verkehrswert,
  wohnflaecheM2: zvgListings.wohnflaecheM2,
  nutzflaecheM2: zvgListings.nutzflaecheM2,
  zimmer: zvgListings.zimmer,
  baujahr: zvgListings.baujahr,
  terminDate: zvgListings.terminDate,
  amtsgericht: zvgListings.amtsgericht,
  istNeu: zvgListings.istNeu,
  denkmalschutz: zvgListings.denkmalschutz,
  vermietet: zvgListings.vermietet,
  createdAt: zvgListings.createdAt,
  coverImageUrl: LISTING_COVER_IMAGE_SQL,
};

async function getRecentListings() {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await db
      .select(RECENT_LISTING_FIELDS)
      .from(zvgListings)
      .where(and(eq(zvgListings.istAktiv, true), gte(zvgListings.createdAt, since24h)))
      .orderBy(desc(zvgListings.createdAt), desc(zvgListings.id))
      .limit(12);

    if (recent.length > 0) return { listings: recent, scopedTo24h: true, total: null };

    const [fallback, [countRow]] = await Promise.all([
      db
        .select(RECENT_LISTING_FIELDS)
        .from(zvgListings)
        .where(eq(zvgListings.istAktiv, true))
        .orderBy(desc(zvgListings.createdAt), desc(zvgListings.id))
        .limit(12),
      db.select({ total: count() }).from(zvgListings).where(eq(zvgListings.istAktiv, true)),
    ]);
    return {
      listings: fallback,
      scopedTo24h: false,
      total: Number(countRow?.total ?? 0),
    };
  } catch {
    return null;
  }
}

async function getRecent24hCount() {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ total: count() })
      .from(zvgListings)
      .where(and(eq(zvgListings.istAktiv, true), gte(zvgListings.createdAt, since24h)));
    return Number(row?.total ?? 0);
  } catch {
    return null;
  }
}

const QUICK_FILTER_TYPES = [
  { label: "Wohnung", href: "/suche?typ=wohnung" },
  { label: "Haus", href: "/suche?typ=haus" },
  { label: "Grundstück", href: "/suche?typ=grundstueck" },
  { label: "Gewerbe", href: "/suche?typ=gewerbe" },
];

const QUICK_FILTER_FLAGS = [
  { label: "≤ 150 T€", href: "/suche?maxPreis=150000" },
  { label: "Vermietet", href: "/suche?vermietet=1" },
  { label: "Denkmal", href: "/suche?denkmal=1" },
];

export default async function HomePage() {
  const [bundeslaender, termine, recent, count24h] = await Promise.all([
    getBundeslaenderData(),
    getUpcomingTermine(),
    getRecentListings(),
    getRecent24hCount(),
  ]);
  const recentListings = recent?.listings ?? null;
  const scopedTo24h = recent?.scopedTo24h ?? false;
  const totalCount = scopedTo24h ? count24h : (recent?.total ?? recentListings?.length ?? 0);
  const sinceHours = scopedTo24h ? 24 : undefined;

  const serializedListings: NeuesteObjekteListing[] = (recentListings ?? []).map((l) => ({
    id: l.id,
    slug: l.slug,
    bundesland: l.bundesland,
    typ: l.typ,
    kategorie: l.kategorie,
    adresse: l.adresse,
    ort: l.ort,
    verkehrswert: l.verkehrswert != null ? String(l.verkehrswert) : null,
    wohnflaecheM2: l.wohnflaecheM2 != null ? String(l.wohnflaecheM2) : null,
    nutzflaecheM2: l.nutzflaecheM2 != null ? String(l.nutzflaecheM2) : null,
    zimmer: l.zimmer != null ? String(l.zimmer) : null,
    baujahr: l.baujahr,
    terminDate: l.terminDate ? l.terminDate.toISOString() : null,
    amtsgericht: l.amtsgericht,
    istNeu: l.istNeu,
    denkmalschutz: l.denkmalschutz,
    vermietet: l.vermietet,
    createdAt: l.createdAt ? l.createdAt.toISOString() : null,
    coverImageUrl: l.coverImageUrl ?? null,
  }));

  return (
    <div className="min-h-full">
      {/* HERO */}
      <section className="px-6 pt-12 pb-9 border-b border-border">
        <div className="label-mono text-primary tracking-[0.14em]">
          Bundesweite Zwangsversteigerungen · KI-Analyse
        </div>
        <h1 className="text-4xl font-semibold tracking-tight leading-[1.1] mt-2.5 max-w-4xl">
          Jedes Objekt erfasst. Jede Chance bewertet.
        </h1>

        <HeroSearch />

        <div className="flex gap-1.5 mt-3.5 text-xs flex-wrap items-center">
          <span className="text-muted-foreground py-1 font-mono text-[11px]">Schnellfilter:</span>
          {QUICK_FILTER_TYPES.map((f) => (
            <Link
              key={f.label}
              href={f.href}
              prefetch={false}
              className="border border-border px-2.5 py-1 rounded-[4px] font-mono text-[11px] hover:border-foreground/40 transition-colors"
            >
              {f.label}
            </Link>
          ))}
          <span className="text-muted-foreground px-1">|</span>
          {QUICK_FILTER_FLAGS.map((f) => (
            <Link
              key={f.label}
              href={f.href}
              prefetch={false}
              className="border border-border px-2.5 py-1 rounded-[4px] font-mono text-[11px] hover:border-foreground/40 transition-colors"
            >
              {f.label}
            </Link>
          ))}
        </div>
      </section>

      {/* BUNDESLÄNDER */}
      <section className="px-6 py-7 border-b border-border">
        <SectionHeader
          label={`Bundesländer · ${bundeslaender?.length ?? "—"}`}
          action={
            <Link href="/laender" className="hover:underline">
              Alle anzeigen →
            </Link>
          }
        />
        {bundeslaender == null ? (
          <p className="text-sm text-muted-foreground">Daten nicht verfügbar.</p>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-px bg-border border border-border">
            {bundeslaender.map((bl) => (
              <Link
                key={bl.kuerzel}
                href={`/${bl.slug}`}
                prefetch={false}
                className="bg-card p-3 flex flex-col gap-0.5 min-h-[78px] hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-sm font-semibold">{bl.kuerzel}</span>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {bl.count.toLocaleString("de-DE")}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground leading-tight">{bl.name}</span>
                <span className="font-mono text-[10px] text-[var(--success)] mt-auto">
                  +{bl.neu7Tage}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* KOMMENDE TERMINE */}
      <section className="px-6 py-7 border-b border-border">
        <SectionHeader
          label="Kommende Termine · 7 Tage"
          action={
            <Link href="/termine" className="hover:underline">
              Vollständige Liste →
            </Link>
          }
        />
        {termine == null ? (
          <div className="border border-border rounded-[4px] px-6 py-8 text-center text-sm text-muted-foreground">
            Termine konnten nicht geladen werden.
          </div>
        ) : termine.length > 0 ? (
          <DataTableGrid columns="80px 110px 1fr 130px 150px 80px 24px">
            <DataTableGrid.Head>
              <div>Datum</div>
              <div>Zeit · Rest</div>
              <div>Objekt</div>
              <div className="text-right">Verkehrswert</div>
              <div>Amtsgericht</div>
              <div>Kategorie</div>
              <div />
            </DataTableGrid.Head>
            {termine.map((t) => {
              const tage = daysUntil(t.terminDate);
              const kat = listingKategorieFuerPeer(t.kategorie, t.typ);
              return (
                <DataTableGrid.Row key={t.id} href={zvgListingPath(t.bundesland, t.slug) ?? "/"}>
                  <div className="font-mono text-xs">
                    {t.terminDate
                      ? new Date(t.terminDate).toLocaleDateString("de-DE", {
                          timeZone: "Europe/Berlin",
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                        })
                      : "—"}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs">
                      {t.terminDate ? (formatClockTime(t.terminDate) ?? "—") : "—"}
                    </span>
                    <UrgencyBadge days={tage} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm">{t.typ ?? "Immobilie"}</div>
                    <div className="text-muted-foreground text-[11px] truncate">
                      {[t.adresse, t.ort].filter(Boolean).join(", ")}
                    </div>
                  </div>
                  <div className="font-mono text-sm font-semibold text-right tabular-nums">
                    {formatCurrency(t.verkehrswert)}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t.amtsgericht ? (
                      <>
                        <span className="opacity-60">AG </span>
                        {t.amtsgericht.replace(/^AG\s*/i, "")}
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div>
                    <CategoryTag kategorie={kat} />
                  </div>
                  <div className="text-muted-foreground text-center">→</div>
                </DataTableGrid.Row>
              );
            })}
          </DataTableGrid>
        ) : (
          <div className="border border-border rounded-[4px] px-6 py-8 text-center text-sm text-muted-foreground">
            Keine Termine in den nächsten 7 Tagen.
          </div>
        )}
      </section>

      {/* NEUESTE OBJEKTE */}
      <section className="px-6 py-7">
        <SectionHeader
          label={scopedTo24h ? "Neueste Objekte · 24 H" : "Neueste Objekte"}
          action={
            <span className="text-xs text-muted-foreground font-mono">Sortierung: Neueste ↓</span>
          }
        />
        {recentListings == null ? (
          <div className="border border-border rounded-[4px] px-6 py-8 text-center text-sm text-muted-foreground">
            Objekte konnten nicht geladen werden.
          </div>
        ) : serializedListings.length > 0 ? (
          <NeusteObjekteSection
            initialListings={serializedListings}
            totalCount={totalCount}
            sinceHours={sinceHours}
          />
        ) : (
          <div className="border border-border rounded-[4px] px-6 py-8 text-center text-sm text-muted-foreground">
            Der Scraper läuft täglich um 04:00 Uhr. Bitte später wiederkommen.
          </div>
        )}
      </section>
    </div>
  );
}
