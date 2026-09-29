import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { roleIsAdmin } from "@/lib/roles";

export { roleIsAdmin };

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return { session: null as null, error: "Nicht eingeloggt" as const };
  }
  return { session, error: null };
}

export async function requireAdmin() {
  const { session, error } = await requireSession();
  if (error || !session?.user?.id) {
    return { session: null as null, error: "Nicht eingeloggt" as const };
  }
  try {
    const row = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { role: true },
    });
    if (!roleIsAdmin(row?.role)) {
      return { session: null as null, error: "Keine Berechtigung" as const };
    }
    return { session, error: null };
  } catch (e) {
    console.error("[requireAdmin] Rollenprüfung fehlgeschlagen", e);
    return { session: null as null, error: "Keine Berechtigung" as const };
  }
}
