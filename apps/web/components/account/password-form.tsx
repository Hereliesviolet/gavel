"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { MIN_PASSWORD_LENGTH, passwordPolicyError } from "@/lib/password-policy";

export function PasswordForm({
  totpEnabled = false,
  hasPassword = true,
}: {
  totpEnabled?: boolean;
  hasPassword?: boolean;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const policyError = newPassword.length > 0 ? passwordPolicyError(newPassword) : null;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setTotpCode("");
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const policy = passwordPolicyError(newPassword);
    if (policy) {
      setError(policy);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/account/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword,
            totpCode: totpEnabled ? totpCode : undefined,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          const message = data?.error ?? "Passwort konnte nicht geändert werden.";
          setError(message);
          toast.error(message);
          return;
        }

        toast.success("Passwort erfolgreich geändert. Andere Sitzungen wurden abgemeldet.");
        reset();
      } catch {
        const message = "Netzwerkfehler beim Ändern des Passworts.";
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-md">
      {!hasPassword && (
        <p className="text-xs text-muted-foreground">
          Aus Sicherheitsgründen nur direkt nach der Anmeldung möglich. Bei Ablehnung bitte neu
          anmelden.
        </p>
      )}
      {hasPassword && (
        <div className="space-y-1.5">
          <Label htmlFor="current-password" className="label-mono">
            Aktuelles Passwort
          </Label>
          <Input
            id="current-password"
            name="currentPassword"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="font-mono text-sm"
            required
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="new-password" className="label-mono">
          Neues Passwort
        </Label>
        <div className="relative">
          <Input
            id="new-password"
            name="newPassword"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="font-mono text-sm pr-10"
            aria-invalid={Boolean(policyError)}
            required
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Mindestens {MIN_PASSWORD_LENGTH} Zeichen, mit Buchstabe und Ziffer.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-password" className="label-mono">
          Neues Passwort bestätigen
        </Label>
        <Input
          id="confirm-password"
          name="confirmPassword"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="font-mono text-sm"
          aria-invalid={mismatch}
          required
        />
      </div>

      {totpEnabled && (
        <div className="space-y-1.5">
          <Label htmlFor="password-totp" className="label-mono">
            Einmalcode
          </Label>
          <Input
            id="password-totp"
            name="totpCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            className="font-mono text-sm"
            required
          />
        </div>
      )}

      {error && (
        <div className="border border-destructive border-l-[3px] bg-error-container text-error-container-fg px-3 py-2 rounded-[4px] text-xs">
          {error}
        </div>
      )}

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Wird geändert …
          </>
        ) : (
          <>
            <KeyRound className="size-3.5" />{" "}
            {hasPassword ? "Passwort ändern" : "Passwort festlegen"}
          </>
        )}
      </Button>
    </form>
  );
}
