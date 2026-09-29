"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const profileFormSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein."),
  email: z
    .string()
    .trim()
    .min(1, "E-Mail darf nicht leer sein.")
    .email("Bitte eine gültige E-Mail-Adresse eingeben."),
  currentPassword: z.string().optional(),
  totpCode: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function ProfileForm({
  initialName,
  initialEmail,
  pendingEmail = null,
  totpEnabled = false,
  hasPassword = true,
}: {
  initialName: string;
  initialEmail: string;
  pendingEmail?: string | null;
  totpEnabled?: boolean;
  hasPassword?: boolean;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    formState: { errors, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { name: initialName, email: initialEmail, currentPassword: "", totpCode: "" },
  });

  const emailValue = watch("email");
  const emailChanged = emailValue.trim().toLowerCase() !== initialEmail.toLowerCase();

  const onSubmit = handleSubmit((values) => {
    setSubmitError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/account/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name,
            email: values.email,
            currentPassword: emailChanged ? values.currentPassword : undefined,
            totpCode: emailChanged && totpEnabled ? values.totpCode : undefined,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          const message = data?.error ?? "Speichern fehlgeschlagen.";
          setSubmitError(message);
          toast.error(message);
          return;
        }

        toast.success(
          data?.emailChangePending
            ? `Bestätigung an ${data.pendingEmail} gesendet. Die bisherige Adresse bleibt aktiv.`
            : "Profil aktualisiert.",
        );
        router.refresh();
      } catch {
        const message = "Netzwerkfehler beim Speichern.";
        setSubmitError(message);
        toast.error(message);
      }
    });
  });

  function cancelPendingChange() {
    setSubmitError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: initialName,
            email: initialEmail,
            cancelEmailChange: true,
            currentPassword: getValues("currentPassword"),
            totpCode: totpEnabled ? getValues("totpCode") : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          const message = data?.error ?? "Abbrechen fehlgeschlagen.";
          setSubmitError(message);
          toast.error(message);
          return;
        }
        toast.success("Die ausstehende E-Mail-Änderung wurde verworfen.");
        router.refresh();
      } catch {
        const message = "Netzwerkfehler beim Speichern.";
        setSubmitError(message);
        toast.error(message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 max-w-2xl">
      <div className="space-y-1.5">
        <Label htmlFor="profile-name" className="label-mono">
          Name
        </Label>
        <Input
          id="profile-name"
          className="font-mono text-sm"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="profile-email" className="label-mono">
          E-Mail
        </Label>
        <Input
          id="profile-email"
          type="email"
          className="font-mono text-sm"
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      {pendingEmail && (
        <div className="sm:col-span-2 border border-border border-l-[3px] border-l-primary bg-card px-3 py-2 rounded-[4px] text-xs space-y-2">
          <p>
            Bestätigung ausstehend für <span className="font-mono">{pendingEmail}</span>. Die
            bisherige Adresse bleibt aktiv, bis der Link in der neuen Inbox bestätigt ist.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={cancelPendingChange}
          >
            Änderung verwerfen
          </Button>
        </div>
      )}

      {(emailChanged || pendingEmail) && hasPassword && (
        <div className="space-y-1.5">
          <Label htmlFor="profile-password" className="label-mono">
            Aktuelles Passwort
          </Label>
          <Input
            id="profile-password"
            type="password"
            autoComplete="current-password"
            className="font-mono text-sm"
            {...register("currentPassword")}
          />
          <p className="text-[11px] text-muted-foreground">
            {pendingEmail && !emailChanged
              ? "Zum Verwerfen der ausstehenden Änderung erforderlich."
              : "Die neue Adresse wird erst nach dem Bestätigungslink aktiv."}
          </p>
        </div>
      )}

      {(emailChanged || pendingEmail) && !hasPassword && !totpEnabled && (
        <p className="sm:col-span-2 text-xs text-muted-foreground">
          Für die E-Mail-Änderung bitte zuerst ein Passwort setzen oder 2FA aktivieren.
        </p>
      )}

      {(emailChanged || pendingEmail) && totpEnabled && (
        <div className="space-y-1.5">
          <Label htmlFor="profile-totp" className="label-mono">
            Einmalcode
          </Label>
          <Input
            id="profile-totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="font-mono text-sm"
            {...register("totpCode")}
          />
        </div>
      )}

      {submitError && (
        <div className="sm:col-span-2 border border-destructive border-l-[3px] bg-error-container text-error-container-fg px-3 py-2 rounded-[4px] text-xs">
          {submitError}
        </div>
      )}

      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" size="sm" disabled={!isDirty || pending}>
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Speichern …
            </>
          ) : (
            <>
              <Save className="size-3.5" /> Speichern
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
