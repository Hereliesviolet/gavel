import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/authz";
import { db } from "@/lib/db";
import { auditEvents, users } from "@/drizzle/schema";
import { DataTableGrid } from "@/components/ui/data-table-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";

export const metadata: Metadata = { title: "Audit-Log · Gavel" };

export default async function AuditPage() {
  const { session, error } = await requireAdmin();
  if (error === "Nicht eingeloggt") redirect("/login?callbackUrl=/account/audit");
  if (error || !session?.user?.id) redirect("/");

  await recordAuditEvent({
    actorId: session.user.id,
    action: "admin.audit.read",
    metadata: { via: "ssr" },
  });

  const events = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      target: auditEvents.target,
      ipAddress: auditEvents.ipAddress,
      createdAt: auditEvents.createdAt,
      actorEmail: users.email,
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorId, users.id))
    .orderBy(desc(auditEvents.createdAt))
    .limit(80);

  return (
    <div className="max-w-5xl space-y-8">
      <section>
        <SectionHeader label="Sicherheitsereignisse" />
        {events.length === 0 ? (
          <EmptyState message="Noch keine Einträge." />
        ) : (
          <DataTableGrid columns="180px 1fr 180px 160px 140px">
            <DataTableGrid.Head>
              <div>Zeit</div>
              <div>Aktion</div>
              <div>Akteur</div>
              <div>Ziel</div>
              <div>IP</div>
            </DataTableGrid.Head>
            {events.map((event) => (
              <DataTableGrid.Row key={event.id}>
                <div className="font-mono text-xs text-muted-foreground">
                  {event.createdAt.toLocaleString("de-DE")}
                </div>
                <div className="font-mono text-sm">{event.action}</div>
                <div className="font-mono text-xs text-muted-foreground truncate">
                  {event.actorEmail ?? "—"}
                </div>
                <div className="font-mono text-xs text-muted-foreground truncate">
                  {event.target ?? "—"}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {event.ipAddress ?? "—"}
                </div>
              </DataTableGrid.Row>
            ))}
          </DataTableGrid>
        )}
      </section>
    </div>
  );
}
