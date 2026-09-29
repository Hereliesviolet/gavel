import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { count, max, eq, gte, and, lt } from "drizzle-orm";
import { pickTopBundeslandByCount } from "@/lib/bundesland";
import {
  addZonedCalendarDays,
  cn,
  exclusiveZonedCalendarHorizon,
  startOfZonedDay,
} from "@/lib/utils";
import { DEFAULT_TERMIN_HORIZON_DAYS, upcomingTerminSql } from "@/lib/termin-sql";

export interface LiveTickerData {
  objekteGesamt: number;
  neuHeute: number;
  neu7Tage: number;
  topBundeslandHeute: { name: string; anzahl: number } | null;
  scraperOnline: boolean;
  scraperLetzterLauf: Date | string | null;
  unavailable?: boolean;
}

export async function getTickerData(): Promise<LiveTickerData> {
  try {
    const now = new Date();
    const startOfToday = startOfZonedDay(now);
    const sevenDaysAgo = addZonedCalendarDays(startOfToday, -7);
    const visible = and(
      eq(zvgListings.istAktiv, true),
      upcomingTerminSql(),
      lt(zvgListings.terminDate, exclusiveZonedCalendarHorizon(DEFAULT_TERMIN_HORIZON_DAYS)),
    );

    const [totalRow] = await db.select({ total: count() }).from(zvgListings).where(visible);

    const [opsRow] = await db
      .select({ letzterLauf: max(zvgListings.lastSeenAt) })
      .from(zvgListings)
      .where(eq(zvgListings.istAktiv, true));

    const [neuHeuteRow] = await db
      .select({ total: count() })
      .from(zvgListings)
      .where(and(visible, gte(zvgListings.createdAt, startOfToday)));

    const [neu7TageRow] = await db
      .select({ total: count() })
      .from(zvgListings)
      .where(and(visible, gte(zvgListings.createdAt, sevenDaysAgo)));

    const topBundeslandRows = await db
      .select({
        bundesland: zvgListings.bundesland,
        bundeslandName: zvgListings.bundeslandName,
        anzahl: count(),
      })
      .from(zvgListings)
      .where(and(visible, gte(zvgListings.createdAt, startOfToday)))
      .groupBy(zvgListings.bundesland, zvgListings.bundeslandName);

    const topBundeslandHeute = pickTopBundeslandByCount(
      topBundeslandRows.map((row) => ({
        bundesland: row.bundesland,
        bundeslandName: row.bundeslandName,
        anzahl: Number(row.anzahl),
      })),
    );

    // last_seen_at belegt, dass der tägliche Lauf die Objekte angefasst hat.
    // created_at wäre das falsche Signal: an Tagen ohne neue Termine (z.B. am
    // Wochenende) stünde ein völlig gesunder Scraper auf OFFLINE.
    const letzterLauf = opsRow?.letzterLauf ?? null;
    const scraperOnline = letzterLauf
      ? Date.now() - new Date(letzterLauf).getTime() < 26 * 60 * 60 * 1000
      : false;

    return {
      objekteGesamt: Number(totalRow?.total ?? 0),
      neuHeute: Number(neuHeuteRow?.total ?? 0),
      neu7Tage: Number(neu7TageRow?.total ?? 0),
      topBundeslandHeute,
      scraperOnline,
      scraperLetzterLauf: letzterLauf,
    };
  } catch {
    return {
      objekteGesamt: 0,
      neuHeute: 0,
      neu7Tage: 0,
      topBundeslandHeute: null,
      scraperOnline: false,
      scraperLetzterLauf: null,
      unavailable: true,
    };
  }
}

/** Ohne Datum sähe ein tagealter Lauf wie der von heute Morgen aus. */
function formatLetzterLauf(wert: Date | string): string {
  const datum = new Date(wert);
  const berlin = { timeZone: "Europe/Berlin" } as const;
  const uhrzeit = datum.toLocaleTimeString("de-DE", {
    ...berlin,
    hour: "2-digit",
    minute: "2-digit",
  });

  const istHeute =
    datum.toLocaleDateString("de-DE", berlin) === new Date().toLocaleDateString("de-DE", berlin);

  if (istHeute) return uhrzeit;

  const tag = datum.toLocaleDateString("de-DE", {
    ...berlin,
    day: "2-digit",
    month: "2-digit",
  });
  return `${tag} ${uhrzeit}`;
}

export function LiveTicker({ data, className }: { data: LiveTickerData; className?: string }) {
  return (
    <div
      className={cn(
        "flex border-b border-border bg-[var(--surface-toolbar)] font-mono text-[11px] overflow-x-auto overscroll-x-contain",
        className,
      )}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <Cell label="OBJEKTE GESAMT" highlight>
        {data.unavailable ? "—" : data.objekteGesamt.toLocaleString("de-DE")}
      </Cell>
      <Cell label="NEU HEUTE" accent>
        {data.unavailable ? (
          "—"
        ) : (
          <>
            +{data.neuHeute.toLocaleString("de-DE")}
            <span className="text-muted-foreground ml-2">
              · 7-TAGE {data.neu7Tage.toLocaleString("de-DE")}
            </span>
          </>
        )}
      </Cell>
      <Cell label="TOP BUNDESLAND" className="hidden sm:flex">
        {data.unavailable ? (
          "—"
        ) : data.topBundeslandHeute ? (
          <>
            {data.topBundeslandHeute.name}
            <span className="text-muted-foreground"> · </span>
            <span className="text-[var(--success)]">
              +{data.topBundeslandHeute.anzahl.toLocaleString("de-DE")}
            </span>
          </>
        ) : (
          "—"
        )}
      </Cell>
      <Cell label="SCRAPER" last className="hidden md:flex">
        {data.unavailable ? (
          <span className="text-muted-foreground">● UNBEKANNT</span>
        ) : (
          <>
            <span
              className={data.scraperOnline ? "text-[var(--success)]" : "text-[var(--destructive)]"}
            >
              ● {data.scraperOnline ? "ONLINE" : "OFFLINE"}
            </span>
            {data.scraperLetzterLauf && (
              <span className="text-muted-foreground ml-2">
                · LETZTER LAUF {formatLetzterLauf(data.scraperLetzterLauf)}
              </span>
            )}
          </>
        )}
      </Cell>
    </div>
  );
}

function Cell({
  label,
  children,
  highlight,
  accent,
  last,
  className,
}: {
  label: string;
  children: React.ReactNode;
  highlight?: boolean;
  accent?: boolean;
  last?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex-1 px-6 py-1.5 flex gap-2 items-center min-w-0 whitespace-nowrap",
        !last && "border-r border-border",
        className,
      )}
    >
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={cn(
          "font-semibold truncate",
          highlight && "text-foreground",
          accent && "text-primary",
        )}
      >
        {children}
      </span>
    </div>
  );
}
