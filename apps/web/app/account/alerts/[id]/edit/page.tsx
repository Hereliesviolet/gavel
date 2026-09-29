import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { userAlerts } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { Metadata } from "next";
import { isValidUuid } from "@/lib/utils";
import { AlertForm, type AlertFormCriteria } from "../../alert-form";

export const metadata: Metadata = { title: "Alert bearbeiten – Gavel" };

export default async function EditAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/account/alerts");

  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const alert = await db.query.userAlerts.findFirst({
    where: and(eq(userAlerts.id, id), eq(userAlerts.userId, session.user.id)),
  });

  if (!alert) notFound();

  return (
    <Suspense fallback={null}>
      <AlertForm
        initial={{
          id: alert.id,
          name: alert.name,
          criteria: (alert.criteria ?? {}) as AlertFormCriteria,
          frequency: alert.frequency ?? "daily",
        }}
      />
    </Suspense>
  );
}
