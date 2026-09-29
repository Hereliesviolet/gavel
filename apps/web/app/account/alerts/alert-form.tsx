"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Bell, Loader2, Sparkles } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { alertCriteriaFromForm } from "@/lib/alert-input";
import { findBundesland } from "@/lib/bundesland";
import { BUNDESLAENDER, cn } from "@/lib/utils";

const ALERT_BUNDESLAENDER = [{ slug: "alle", name: "Alle Bundesländer" }, ...BUNDESLAENDER];

function resolveAlertBundesland(raw: string | null | undefined): string {
  if (!raw || raw === "alle") return "alle";
  return findBundesland(raw)?.slug ?? "alle";
}

const KATEGORIEN = [
  { value: "wohnung", label: "Wohnung" },
  { value: "haus", label: "Haus" },
  { value: "grundstueck", label: "Grundstück" },
  { value: "gewerbe", label: "Gewerbe" },
];

export interface AlertFormCriteria {
  bundesland?: string;
  kategorie?: string[];
  min_preis?: number;
  max_preis?: number;
  min_flaeche?: number;
  max_flaeche?: number;
  amtsgericht?: string;
  plz?: string;
  umkreis_km?: number;
}

export interface AlertFormInitial {
  id: string;
  name: string;
  criteria: AlertFormCriteria;
  frequency: string;
}

const alertFormSchema = z
  .object({
    name: z.string().trim().min(1, "Bitte einen Namen eingeben."),
    frequency: z.enum(["instant", "daily", "weekly"]),
    bundesland: z.string(),
    kategorien: z.array(z.string()),
    minPreis: z.string(),
    maxPreis: z.string(),
    minFlaeche: z.string(),
    maxFlaeche: z.string(),
    amtsgericht: z.string(),
    plz: z.string(),
    umkreisKm: z.string(),
  })
  .refine((data) => !data.plz.trim() || /^\d{4,5}$/.test(data.plz.trim()), {
    message: "Bitte eine gültige Postleitzahl eingeben (4-5 Ziffern).",
    path: ["plz"],
  })
  .superRefine((data, ctx) => {
    const parsed = alertCriteriaFromForm({
      bundesland: data.bundesland,
      kategorien: data.kategorien,
      minPreis: data.minPreis,
      maxPreis: data.maxPreis,
      minFlaeche: data.minFlaeche,
      maxFlaeche: data.maxFlaeche,
      amtsgericht: data.amtsgericht,
      plz: data.plz,
      umkreisKm: data.umkreisKm,
    });
    if (parsed.ok || parsed.field === "name") return;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error, path: [parsed.field] });
  });

type AlertFormValues = z.infer<typeof alertFormSchema>;

const inputClass =
  "w-full px-3 py-2.5 border border-input rounded-[4px] text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

export function AlertForm({ initial }: { initial?: AlertFormInitial }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isEdit = Boolean(initial);

  // Beim Erstellen (nicht beim Bearbeiten) können Kriterien z.B. von der
  // Favoriten-Seite über Query-Parameter vorausgefüllt werden
  // (?kategorie=haus&bundesland=bayern&preisMin=..&preisMax=..&quelle=favoriten).
  const fromFavoriten = !isEdit && searchParams.get("quelle") === "favoriten";
  const favoritenAnzahl = searchParams.get("anzahl");
  const prefillKategorie = !isEdit ? searchParams.get("kategorie") : null;
  const prefillBundesland = !isEdit ? searchParams.get("bundesland") : null;
  const prefillPreisMin = !isEdit ? searchParams.get("preisMin") : null;
  const prefillPreisMax = !isEdit ? searchParams.get("preisMax") : null;

  const alertType = "zvg" as const;

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<AlertFormValues>({
    resolver: zodResolver(alertFormSchema),
    defaultValues: {
      name: initial?.name ?? (fromFavoriten ? "Alert aus Favoriten" : ""),
      frequency: (initial?.frequency as AlertFormValues["frequency"]) ?? "daily",
      bundesland: initial
        ? resolveAlertBundesland(initial.criteria.bundesland)
        : resolveAlertBundesland(prefillBundesland),
      kategorien: initial
        ? (initial.criteria.kategorie ?? [])
        : prefillKategorie && KATEGORIEN.some((k) => k.value === prefillKategorie)
          ? [prefillKategorie]
          : [],
      minPreis: initial?.criteria.min_preis?.toString() ?? prefillPreisMin ?? "",
      maxPreis: initial?.criteria.max_preis?.toString() ?? prefillPreisMax ?? "",
      minFlaeche: initial?.criteria.min_flaeche?.toString() ?? "",
      maxFlaeche: initial?.criteria.max_flaeche?.toString() ?? "",
      amtsgericht: initial?.criteria.amtsgericht ?? "",
      plz: initial?.criteria.plz ?? "",
      umkreisKm: initial?.criteria.umkreis_km?.toString() ?? "",
    },
  });

  const kategorien = useWatch({ control, name: "kategorien" });
  const plz = useWatch({ control, name: "plz" });

  function toggleKategorie(val: string) {
    setValue(
      "kategorien",
      kategorien.includes(val) ? kategorien.filter((k) => k !== val) : [...kategorien, val],
      { shouldDirty: true },
    );
  }

  const onSubmit = handleSubmit((values) => {
    setSubmitError(null);

    const parsed = alertCriteriaFromForm({
      bundesland: values.bundesland,
      kategorien: values.kategorien,
      minPreis: values.minPreis,
      maxPreis: values.maxPreis,
      minFlaeche: values.minFlaeche,
      maxFlaeche: values.maxFlaeche,
      amtsgericht: values.amtsgericht,
      plz: values.plz,
      umkreisKm: values.umkreisKm,
    });
    if (!parsed.ok) {
      setSubmitError(parsed.error);
      return;
    }
    const criteria = parsed.criteria;

    startTransition(async () => {
      try {
        const url = isEdit ? `/api/alerts/${initial!.id}` : "/api/alerts";
        const method = isEdit ? "PUT" : "POST";
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name.trim(),
            alertType,
            criteria,
            frequency: values.frequency,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setSubmitError(data.error ?? "Fehler beim Speichern.");
          return;
        }

        router.push("/account/alerts");
        router.refresh();
      } catch {
        setSubmitError("Netzwerkfehler. Bitte erneut versuchen.");
      }
    });
  });

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/account/alerts"
          className="p-2 rounded-[4px] text-muted-foreground hover:text-muted-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <Bell size={22} className="text-primary" />
          <h1 className="text-2xl font-bold text-foreground">
            {isEdit ? "Alert bearbeiten" : "Neuen Alert erstellen"}
          </h1>
        </div>
      </div>

      {fromFavoriten && (
        <div className="flex items-start gap-2.5 px-4 py-3 mb-6 bg-[var(--primary-container)]/40 border border-primary/30 rounded-[4px] text-sm text-foreground">
          <Sparkles size={16} className="text-primary shrink-0 mt-0.5" />
          <span>
            Diese Kriterien wurden aus deinen {favoritenAnzahl ? `${favoritenAnzahl} ` : ""}
            Favoriten abgeleitet. Du kannst sie unten noch anpassen, bevor du speicherst.
          </span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Name */}
        <div className="border border-border rounded-[4px] p-5 bg-background">
          <h2 className="text-base font-semibold text-foreground mb-4">Allgemein</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Name des Alerts <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                {...register("name")}
                placeholder="z.B. Wohnungen Bayern unter 200k"
                className={cn(inputClass, errors.name && "border-destructive")}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Benachrichtigungsfrequenz
              </label>
              <select
                {...register("frequency")}
                className="w-full px-3 py-2.5 border border-input rounded-[4px] text-sm
                           focus:outline-none focus:ring-2 focus:ring-primary bg-background"
              >
                <option value="instant">Sofort (beim nächsten Prüflauf mit neuen Treffern)</option>
                <option value="daily">Täglich (höchstens eine Zusammenfassung / 24h)</option>
                <option value="weekly">
                  Wöchentlich (höchstens eine Zusammenfassung / 7 Tage)
                </option>
              </select>
            </div>
          </div>
        </div>

        {/* Suchkriterien */}
        <div className="border border-border rounded-[4px] p-5 bg-background">
          <h2 className="text-base font-semibold text-foreground mb-4">Suchkriterien</h2>

          <div className="space-y-4">
            {/* Bundesland */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Bundesland</label>
              <select
                {...register("bundesland")}
                className="w-full px-3 py-2.5 border border-input rounded-[4px] text-sm
                           focus:outline-none focus:ring-2 focus:ring-primary bg-background"
              >
                {ALERT_BUNDESLAENDER.map((bl) => (
                  <option key={bl.slug} value={bl.slug}>
                    {bl.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Kategorie */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Objektkategorie (mehrere möglich)
              </label>
              <div className="flex flex-wrap gap-2">
                {KATEGORIEN.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => toggleKategorie(k.value)}
                    className={`px-3 py-1.5 text-sm rounded-[4px] border transition-colors ${
                      kategorien.includes(k.value)
                        ? "border-primary bg-primary/5 text-primary font-medium"
                        : "border-border text-muted-foreground hover:border-input"
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Keine Auswahl = alle Kategorien</p>
            </div>

            {/* Preis */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Verkehrswert (€)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  {...register("minPreis")}
                  placeholder="Min. (z.B. 50000)"
                  min="0"
                  className={inputClass}
                />
                <input
                  type="number"
                  {...register("maxPreis")}
                  placeholder="Max. (z.B. 300000)"
                  min="0"
                  className={cn(
                    inputClass,
                    (errors.minPreis || errors.maxPreis) && "border-destructive",
                  )}
                />
              </div>
              {(errors.minPreis || errors.maxPreis) && (
                <p className="text-xs text-destructive mt-1">
                  {errors.maxPreis?.message ?? errors.minPreis?.message}
                </p>
              )}
            </div>

            {/* Fläche */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Wohnfläche (m²)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  {...register("minFlaeche")}
                  placeholder="Min. (z.B. 60)"
                  min="0"
                  className={inputClass}
                />
                <input
                  type="number"
                  {...register("maxFlaeche")}
                  placeholder="Max. (z.B. 200)"
                  min="0"
                  className={cn(
                    inputClass,
                    (errors.minFlaeche || errors.maxFlaeche) && "border-destructive",
                  )}
                />
              </div>
              {(errors.minFlaeche || errors.maxFlaeche) && (
                <p className="text-xs text-destructive mt-1">
                  {errors.maxFlaeche?.message ?? errors.minFlaeche?.message}
                </p>
              )}
            </div>

            {/* Amtsgericht */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Amtsgericht
              </label>
              <input
                type="text"
                {...register("amtsgericht")}
                placeholder="z.B. Amtsgericht München"
                className={inputClass}
              />
            </div>

            {/* PLZ / Umkreis */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Postleitzahl &amp; Umkreis
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  {...register("plz")}
                  placeholder="PLZ (z.B. 80331)"
                  inputMode="numeric"
                  className={cn(inputClass, errors.plz && "border-destructive")}
                  aria-invalid={Boolean(errors.plz)}
                />
                <select
                  {...register("umkreisKm")}
                  disabled={!plz.trim()}
                  className="w-full px-3 py-2.5 border border-input rounded-[4px] text-sm
                             focus:outline-none focus:ring-2 focus:ring-primary bg-background
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Umkreis wählen</option>
                  <option value="10">10 km</option>
                  <option value="25">25 km</option>
                  <option value="50">50 km</option>
                  <option value="100">100 km</option>
                </select>
              </div>
              {errors.plz || errors.umkreisKm ? (
                <p className="text-xs text-destructive mt-1">
                  {errors.plz?.message ?? errors.umkreisKm?.message}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Ohne Umkreis gilt die genaue PLZ, kein grober Regionsfilter.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Server-/Netzwerkfehler */}
        {submitError && (
          <div className="px-4 py-3 bg-[var(--error-container)] border border-[var(--destructive)]/30 rounded-[4px] text-sm text-[var(--error-container-fg)]">
            {submitError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <Link
            href="/account/alerts"
            className="rounded-full border border-border px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            Abbrechen
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-cloud disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />}
            {isEdit ? "Änderungen speichern" : "Alert speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}
