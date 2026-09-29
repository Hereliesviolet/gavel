"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TotpForm({
  enabled,
  hasPassword = true,
}: {
  enabled: boolean;
  hasPassword?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startSetup() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/totp/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Einrichtung nicht möglich.");
          return;
        }
        setSecret(data.secret);
        setOtpauthUrl(data.otpauthUrl);
        setBackupCodes(null);
      } catch {
        setError("Netzwerkfehler bei der Einrichtung.");
      }
    });
  }

  function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/totp/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, code }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Code ungültig.");
          return;
        }
        setBackupCodes(data.backupCodes ?? []);
        setSecret(null);
        setOtpauthUrl(null);
        setCode("");
        setPassword("");
        toast.success(
          "Zwei-Faktor-Authentifizierung ist aktiv. Andere Sitzungen wurden abgemeldet.",
        );
        router.refresh();
      } catch {
        setError("Netzwerkfehler bei der Bestätigung.");
      }
    });
  }

  function regenerateBackups(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/totp/backup/regenerate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, code }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Codes konnten nicht erzeugt werden.");
          return;
        }
        setBackupCodes(data.backupCodes ?? []);
        setCode("");
        setPassword("");
        toast.success("Neue Wiederherstellungscodes erzeugt. Die alten gelten nicht mehr.");
      } catch {
        setError("Netzwerkfehler beim Erzeugen der Codes.");
      }
    });
  }

  function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/totp/disable", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, code }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Deaktivieren nicht möglich.");
          return;
        }
        setPassword("");
        setCode("");
        toast.success("Zwei-Faktor-Authentifizierung deaktiviert.");
        router.refresh();
      } catch {
        setError("Netzwerkfehler beim Deaktivieren.");
      }
    });
  }

  if (backupCodes) {
    return (
      <div className="space-y-3 max-w-md">
        <p className="text-sm">
          Speichere diese Wiederherstellungscodes an einem sicheren Ort. Jeder Code gilt nur einmal.
        </p>
        <ul className="font-mono text-sm border border-border rounded-[4px] p-3 space-y-1">
          {backupCodes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <Button type="button" size="sm" variant="outline" onClick={() => setBackupCodes(null)}>
          Codes verborgen
        </Button>
      </div>
    );
  }

  if (enabled) {
    return (
      <form onSubmit={disable} className="space-y-4 max-w-md">
        <p className="text-sm text-muted-foreground">
          Zwei-Faktor-Authentifizierung ist aktiv. Zum Deaktivieren oder Erneuern der
          Wiederherstellungscodes{hasPassword ? " Passwort und " : " "}aktuellen Code eingeben.
        </p>
        {hasPassword && (
          <div className="space-y-1.5">
            <Label htmlFor="totp-disable-password" className="label-mono">
              Aktuelles Passwort
            </Label>
            <Input
              id="totp-disable-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="font-mono text-sm"
              required
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="totp-disable-code" className="label-mono">
            Einmal- oder Wiederherstellungscode
          </Label>
          <Input
            id="totp-disable-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="font-mono text-sm"
            required
          />
        </div>
        {error && (
          <div className="border border-destructive border-l-[3px] bg-error-container text-error-container-fg px-3 py-2 rounded-[4px] text-xs">
            {error}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Wird deaktiviert …
              </>
            ) : (
              <>
                <ShieldOff className="size-3.5" /> 2FA deaktivieren
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={regenerateBackups}
          >
            Codes erneuern
          </Button>
        </div>
      </form>
    );
  }

  if (secret) {
    return (
      <form onSubmit={confirmSetup} className="space-y-4 max-w-md">
        <p className="text-sm text-muted-foreground">
          Lege in der Authenticator-App ein Konto an und gib den 6-stelligen Code zur Bestätigung
          ein.
        </p>
        <div className="border border-border rounded-[4px] p-3 space-y-2">
          <div className="label-mono">Geheimnis</div>
          <p className="font-mono text-sm break-all">{secret}</p>
          {otpauthUrl && (
            <p className="font-mono text-[11px] text-muted-foreground break-all">{otpauthUrl}</p>
          )}
        </div>
        {hasPassword && (
          <div className="space-y-1.5">
            <Label htmlFor="totp-confirm-password" className="label-mono">
              Aktuelles Passwort
            </Label>
            <Input
              id="totp-confirm-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="font-mono text-sm"
              required
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="totp-confirm-code" className="label-mono">
            Bestätigungscode
          </Label>
          <Input
            id="totp-confirm-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="font-mono text-sm"
            required
          />
        </div>
        {error && (
          <div className="border border-destructive border-l-[3px] bg-error-container text-error-container-fg px-3 py-2 rounded-[4px] text-xs">
            {error}
          </div>
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Wird bestätigt …
            </>
          ) : (
            <>
              <ShieldCheck className="size-3.5" /> 2FA aktivieren
            </>
          )}
        </Button>
      </form>
    );
  }

  if (!hasPassword) {
    return (
      <p className="text-sm text-muted-foreground max-w-md">
        Zwei-Faktor-Authentifizierung braucht ein Passwort. Bitte zuerst ein Passwort festlegen —
        sonst kommst du nach dem Abmelden nicht mehr per SSO ins Konto.
      </p>
    );
  }

  return (
    <form
      className="space-y-3 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        startSetup();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Schützt das Konto zusätzlich zum Passwort mit einem Einmalcode aus einer Authenticator-App.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="totp-setup-password" className="label-mono">
          Aktuelles Passwort
        </Label>
        <Input
          id="totp-setup-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="font-mono text-sm"
          required
        />
      </div>
      {error && (
        <div className="border border-destructive border-l-[3px] bg-error-container text-error-container-fg px-3 py-2 rounded-[4px] text-xs">
          {error}
        </div>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Wird vorbereitet …
          </>
        ) : (
          <>
            <ShieldCheck className="size-3.5" /> Zwei-Faktor einrichten
          </>
        )}
      </Button>
    </form>
  );
}
