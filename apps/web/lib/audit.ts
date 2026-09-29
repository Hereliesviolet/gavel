import { db } from "@/lib/db";
import { auditEvents } from "@/drizzle/schema";
import { extractClientInfo } from "@/lib/request-meta";
import { auditWriteIsRequired, type AuditAction } from "@/lib/audit-policy";

export type { AuditAction };
export { auditWriteIsRequired };

type AuditWriter = Pick<typeof db, "insert">;

export async function recordAuditEvent(input: {
  actorId?: string | null;
  action: AuditAction;
  target?: string | null;
  request?: Request;
  metadata?: Record<string, unknown>;
  executor?: AuditWriter;
}): Promise<void> {
  const writer = input.executor ?? db;
  const write = async () => {
    const { ipAddress, userAgent } = extractClientInfo(input.request);
    await writer.insert(auditEvents).values({
      actorId: input.actorId ?? null,
      action: input.action,
      target: input.target ?? null,
      ipAddress,
      userAgent,
      metadata: input.metadata ?? null,
    });
  };
  if (auditWriteIsRequired(input.action, input.executor)) {
    await write();
    return;
  }
  try {
    await write();
  } catch (e) {
    console.error("[audit] Ereignis konnte nicht geschrieben werden", e);
  }
}
