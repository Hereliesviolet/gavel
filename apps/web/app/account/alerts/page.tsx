import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { userAlerts, alertNotifications } from "@/drizzle/schema";
import { eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { Bell, Plus } from "lucide-react";
import type { Metadata } from "next";
import { AlertCard } from "./alert-card";

export const metadata: Metadata = { title: "Alert-Verwaltung – Gavel" };

/**
 * Ersetzt den früheren `getRecentAlertHits()`-Stub durch eine echte
 * DB-Query: Anzahl bisheriger Treffer je Alert aus der `alertNotifications`-
 * Dedup-Tabelle (siehe app/api/cron/check-alerts).
 */
async function getHitCounts(alertIds: string[]): Promise<Map<string, number>> {
  if (alertIds.length === 0) return new Map();

  const rows = await db
    .select({
      alertId: alertNotifications.alertId,
      count: sql<number>`count(*)::int`,
    })
    .from(alertNotifications)
    .where(inArray(alertNotifications.alertId, alertIds))
    .groupBy(alertNotifications.alertId);

  return new Map(rows.map((r) => [r.alertId, r.count]));
}

export default async function AlertsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/account/alerts");

  const alerts = await db.query.userAlerts.findMany({
    where: eq(userAlerts.userId, session.user.id),
    orderBy: (a, { desc }) => [desc(a.createdAt)],
  });

  const hitCounts = await getHitCounts(alerts.map((a) => a.id));

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Bell size={24} className="text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Alerts</h1>
            <p className="text-sm text-muted-foreground">
              {alerts.length} Alert{alerts.length !== 1 ? "s" : ""} eingerichtet
            </p>
          </div>
        </div>
        <Link
          href="/account/alerts/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm
                     font-medium rounded-[4px] hover:bg-primary/90 transition-colors"
        >
          <Plus size={15} /> Neuer Alert
        </Link>
      </div>

      {alerts.length === 0 ? (
        <div className="border border-dashed border-border rounded-[4px] text-center py-16 bg-card">
          <Bell size={40} className="text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">Noch keine Alerts eingerichtet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-5 max-w-xs mx-auto">
            Erstellen Sie einen Alert, um bei neuen passenden Objekten per E-Mail benachrichtigt zu
            werden.
          </p>
          <Link
            href="/account/alerts/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm
                       font-medium rounded-[4px] hover:bg-primary/90 transition-colors"
          >
            <Plus size={15} /> Ersten Alert erstellen
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} hitCount={hitCounts.get(alert.id) ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}
