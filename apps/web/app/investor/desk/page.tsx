import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getInvestorProfile } from "@/lib/investor-profile-storage";
import { DEFAULT_INVESTOR_PROFILE } from "@/lib/investor-profile";
import { fetchDeskEintraege } from "@/lib/deal-desk";
import { DeskClient } from "@/app/investor/desk/desk-client";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

export const metadata: Metadata = {
  title: "Deal-Desk",
  description:
    "Beobachtete Zwangsversteigerungen mit eigenem Status, Notizen und erfasstem Ergebnis.",
};

export default async function DeskPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/investor/desk");
  }

  const profile = (await getInvestorProfile(session.user.id)) ?? DEFAULT_INVESTOR_PROFILE;
  const eintraege = await fetchDeskEintraege(session.user.id, profile);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Investor · Desk"
        title="Deal-Desk"
        description="Woran arbeitest du gerade? Status, Notiz und Ergebnis setzt du selbst — im Gegensatz zur Datenreife, die aus den Daten kommt. Objekte landen hier, sobald du sie merkst oder den Status änderst."
      />
      <DeskClient eintraege={eintraege} />
    </PageShell>
  );
}
