import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getInvestorProfileWithMeta } from "@/lib/investor-profile-storage";
import { InvestorProfileForm } from "@/components/account/investor-profile-form";
import { SectionHeader } from "@/components/ui/section-header";

export const metadata: Metadata = {
  title: "Investorenprofil · Gavel",
};

export default async function InvestorProfilePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/account/investor");
  }

  const result = await getInvestorProfileWithMeta(session.user.id);

  return (
    <div className="max-w-5xl">
      <SectionHeader label="KI-Investorenprofil" />
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Diese Annahmen personalisieren Szenarien, Zielrenditen und Maximalgebote. Sie ersetzen keine
        individuelle Finanzierungs-, Rechts- oder Steuerberatung.
      </p>
      <InvestorProfileForm initialProfile={result.profile} persisted={result.persisted} />
    </div>
  );
}
