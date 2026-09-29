"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { safeInternalPath } from "@/lib/safe-url";
import {
  AUTH_UNAVAILABLE_CODE,
  SSO_2FA_REQUIRED_CODE,
  TWO_FACTOR_REQUIRED_CODE,
} from "@/lib/auth-codes";

export function LoginForm({ className, ssoName }: { className?: string; ssoName?: string | null }) {
  const router = useRouter();
  const search = useSearchParams();
  const from = safeInternalPath(search.get("from") ?? search.get("callbackUrl"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [remember, setRemember] = useState(true);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const emailStatus = search.get("email");
  const [notice] = useState<string | null>(() =>
    emailStatus === "confirmed"
      ? "E-Mail-Adresse bestätigt. Bitte mit der neuen Adresse anmelden."
      : null,
  );
  const [error, setError] = useState<string | null>(() => {
    if (search.get("error") === SSO_2FA_REQUIRED_CODE) {
      return "Für dieses Konto ist Zwei-Faktor-Authentifizierung aktiv. Bitte mit E-Mail, Passwort und Einmalcode anmelden.";
    }
    if (emailStatus === "expired") {
      return "Der Bestätigungslink ist abgelaufen. Bitte die Änderung erneut anstoßen.";
    }
    if (emailStatus === "invalid") {
      return "Der Bestätigungslink ist ungültig.";
    }
    if (emailStatus === "conflict") {
      return "Die neue E-Mail-Adresse ist nicht mehr verfügbar.";
    }
    if (emailStatus === "throttled") {
      return "Zu viele Bestätigungsversuche. Bitte später erneut versuchen.";
    }
    if (emailStatus === "unavailable") {
      return "Bestätigung gerade nicht möglich. Bitte den Link später erneut öffnen.";
    }
    return null;
  });
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signIn("credentials", {
        email,
        password,
        totp: needsTotp ? totp : "",
        remember: remember ? "true" : "false",
        redirect: false,
      });
      if (result?.code === TWO_FACTOR_REQUIRED_CODE) {
        setNeedsTotp(true);
        setError(null);
        return;
      }
      if (result?.code === AUTH_UNAVAILABLE_CODE || result?.error === AUTH_UNAVAILABLE_CODE) {
        setError("Anmeldung gerade nicht möglich. Bitte später erneut versuchen.");
        return;
      }
      if (result?.error) {
        setError(
          needsTotp
            ? "Einmalcode ungültig oder Anmeldung blockiert."
            : "E-Mail oder Passwort falsch.",
        );
        return;
      }
      router.replace(from);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className={cn("space-y-4", className)} noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email" className="label-mono">
          E-Mail
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="name@firma.de"
          className="font-mono text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="label-mono">
          Passwort
        </Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            required
            className="font-mono text-sm pr-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Passwort verbergen" : "Passwort anzeigen"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {needsTotp && (
        <div className="space-y-1.5">
          <Label htmlFor="totp" className="label-mono">
            Einmalcode
          </Label>
          <Input
            id="totp"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder="123456"
            className="font-mono text-sm"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Code aus der Authenticator-App oder ein Wiederherstellungscode.
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          name="remember"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="size-3.5 accent-primary"
        />
        Eingeloggt bleiben (30 Tage)
      </label>

      {notice && (
        <div className="border border-primary border-l-[3px] bg-card px-3 py-2 rounded-[4px] text-xs">
          {notice}
        </div>
      )}

      {error && (
        <div className="border border-destructive border-l-[3px] bg-error-container text-error-container-fg px-3 py-2 rounded-[4px] text-xs">
          {error}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Anmelden …
          </>
        ) : (
          <>
            Anmelden <ArrowRight className="size-4" />
          </>
        )}
      </Button>

      {ssoName && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await signIn("sso", { callbackUrl: from, redirect: true });
            });
          }}
        >
          Mit {ssoName} anmelden
        </Button>
      )}
    </form>
  );
}
