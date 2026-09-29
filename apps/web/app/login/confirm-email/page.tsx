import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import {
  EMAIL_CONFIRM_COOKIE,
  EMAIL_CONFIRM_QUERY,
  MAX_EMAIL_CONFIRM_TOKEN,
} from "@/lib/email-change";
import { confirmEmailAction } from "./actions";

export const metadata = {
  title: "E-Mail bestätigen · Gavel",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function ConfirmEmailPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/login/confirm-email");
  }

  const jar = await cookies();
  const token =
    jar.get(EMAIL_CONFIRM_COOKIE)?.value?.trim().slice(0, MAX_EMAIL_CONFIRM_TOKEN) ?? "";
  if (!token) {
    redirect(`/login?email=${EMAIL_CONFIRM_QUERY.invalid}`);
  }

  return (
    <div className="min-h-svh flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" />
          Gavel
        </div>
        <div>
          <div className="label-mono">E-Mail-Änderung</div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1.5">Neue Adresse bestätigen</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Bitte mit dem Konto angemeldet bleiben, das die Änderung beantragt hat. Erst nach diesem
            Klick wird die Login-Adresse geändert. Alle Sitzungen werden danach beendet.
          </p>
        </div>
        <form action={confirmEmailAction} className="space-y-3">
          <Button type="submit" className="w-full">
            E-Mail-Adresse bestätigen
          </Button>
        </form>
      </div>
    </div>
  );
}
