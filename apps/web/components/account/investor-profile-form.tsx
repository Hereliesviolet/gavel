"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  normalizeInvestorProfile,
  type InvestorProfile,
  type InvestorStrategyPreference,
} from "@/lib/investor-profile";
import { cn } from "@/lib/utils";

const STRATEGIES: Array<{
  value: InvestorStrategyPreference;
  label: string;
  description: string;
}> = [
  { value: "buy_hold", label: "Buy & Hold", description: "Cashflow und Bestand" },
  { value: "fix_flip", label: "Fix & Flip", description: "Sanieren und verkaufen" },
  {
    value: "unter_markt",
    label: "Marktlücke",
    description: "Abstand zum Angebotspreis-Niveau im Mikromarkt",
  },
];

export function InvestorProfileForm({
  initialProfile,
  persisted,
}: {
  initialProfile: InvestorProfile;
  persisted: boolean;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [saving, setSaving] = useState(false);

  const setNumber = (key: keyof InvestorProfile, value: string) => {
    setProfile((current) => ({ ...current, [key]: Number(value) }));
  };

  const toggleStrategy = (strategy: InvestorStrategyPreference) => {
    setProfile((current) => {
      const selected = current.strategies.includes(strategy);
      if (selected && current.strategies.length === 1) return current;
      return {
        ...current,
        strategies: selected
          ? current.strategies.filter((item) => item !== strategy)
          : [...current.strategies, strategy],
      };
    });
  };

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/investor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        toast.error(
          response.status === 429
            ? "Zu viele Profil-Änderungen. Bitte später erneut versuchen."
            : "Speichern fehlgeschlagen",
        );
        return;
      }
      const profilePayload =
        payload &&
        typeof payload === "object" &&
        "profile" in payload &&
        (payload as { profile: unknown }).profile &&
        typeof (payload as { profile: unknown }).profile === "object"
          ? (payload as { profile: Partial<InvestorProfile> }).profile
          : null;
      if (!profilePayload) {
        toast.error("Speichern fehlgeschlagen");
        return;
      }
      setProfile(normalizeInvestorProfile(profilePayload));
      toast.success("Investorenprofil gespeichert");
    } catch {
      toast.error("Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      {!persisted && (
        <div className="rounded-[4px] border border-[var(--warning)]/30 bg-[var(--warning-container)] px-3 py-2 text-xs text-[var(--warning-container-fg)]">
          Aktuell gelten sichere Standardannahmen. Beim Speichern wird Ihr persönliches Profil
          angelegt.
        </div>
      )}

      <FieldGroup title="Strategien" description="Mindestens eine Strategie bleibt aktiv.">
        <div className="grid gap-2 sm:grid-cols-3">
          {STRATEGIES.map((strategy) => {
            const selected = profile.strategies.includes(strategy.value);
            return (
              <button
                key={strategy.value}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleStrategy(strategy.value)}
                className={cn(
                  "rounded-[4px] border p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40",
                )}
              >
                <div className="text-sm font-medium">{strategy.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{strategy.description}</div>
              </button>
            );
          })}
        </div>
      </FieldGroup>

      <FieldGroup
        title="Kapital & Finanzierung"
        description="Diese Werte steuern DSCR, Cash-on-Cash und Maximalgebot."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Maximales Eigenkapital (€)"
            value={profile.maxEquityEur}
            onChange={(v) => setNumber("maxEquityEur", v)}
            min={0}
            step={1000}
          />
          <NumberField
            label="Eigenkapital (%)"
            value={profile.equityPct}
            onChange={(v) => setNumber("equityPct", v)}
            min={0}
            max={100}
            step={1}
          />
          <NumberField
            label="Finanzierungszins (%)"
            value={profile.financingRatePct}
            onChange={(v) => setNumber("financingRatePct", v)}
            min={0}
            max={30}
            step={0.1}
          />
          <NumberField
            label="Tilgung (%)"
            value={profile.repaymentRatePct}
            onChange={(v) => setNumber("repaymentRatePct", v)}
            min={0}
            max={30}
            step={0.1}
          />
          <NumberField
            label="Mindest-DSCR"
            value={profile.minDscr}
            onChange={(v) => setNumber("minDscr", v)}
            min={0.1}
            max={10}
            step={0.05}
          />
          <NumberField
            label="Max. Haltedauer (Monate)"
            value={profile.maxHoldingMonths}
            onChange={(v) => setNumber("maxHoldingMonths", v)}
            min={1}
            max={120}
            step={1}
          />
        </div>
      </FieldGroup>

      <FieldGroup
        title="Zielrendite & Betrieb"
        description="Zielwerte und konservative laufende Annahmen."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Ziel-IRR (%)"
            value={profile.targetIrrPct}
            onChange={(v) => setNumber("targetIrrPct", v)}
            min={0}
            max={100}
            step={0.5}
          />
          <NumberField
            label="Ziel Cash-on-Cash (%)"
            value={profile.targetCashOnCashPct}
            onChange={(v) => setNumber("targetCashOnCashPct", v)}
            min={-100}
            max={100}
            step={0.5}
          />
          <NumberField
            label="Ziel Flip-Marge (%)"
            value={profile.targetFlipMarginPct}
            onChange={(v) => setNumber("targetFlipMarginPct", v)}
            min={0}
            max={100}
            step={0.5}
          />
          <NumberField
            label="Leerstand (%)"
            value={profile.vacancyPct}
            onChange={(v) => setNumber("vacancyPct", v)}
            min={0}
            max={50}
            step={0.5}
          />
          <NumberField
            label="Instandhaltung (€/m²/Jahr)"
            value={profile.maintenanceEurM2Year}
            onChange={(v) => setNumber("maintenanceEurM2Year", v)}
            min={0}
            max={500}
            step={1}
          />
        </div>
      </FieldGroup>

      <FieldGroup title="Präferenzen" description="Kommagetrennte Werte sind optional.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextListField
            label="Regionen"
            value={profile.regions}
            placeholder="berlin, brandenburg"
            onChange={(regions) => setProfile((current) => ({ ...current, regions }))}
          />
          <TextListField
            label="Objekttypen"
            value={profile.propertyTypes}
            placeholder="wohnung, haus"
            onChange={(propertyTypes) => setProfile((current) => ({ ...current, propertyTypes }))}
          />
          <SelectField
            label="Risikotoleranz"
            value={profile.riskTolerance}
            onChange={(riskTolerance) =>
              setProfile((current) => ({
                ...current,
                riskTolerance: riskTolerance as InvestorProfile["riskTolerance"],
              }))
            }
            options={[
              ["conservative", "Konservativ"],
              ["balanced", "Ausgewogen"],
              ["opportunistic", "Opportunistisch"],
            ]}
          />
          <SelectField
            label="Sanierungskapazität"
            value={profile.renovationCapacity}
            onChange={(renovationCapacity) =>
              setProfile((current) => ({
                ...current,
                renovationCapacity: renovationCapacity as InvestorProfile["renovationCapacity"],
              }))
            }
            options={[
              ["low", "Niedrig"],
              ["medium", "Mittel"],
              ["high", "Hoch"],
            ]}
          />
        </div>
      </FieldGroup>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "Speichert …" : "Investorenprofil speichern"}
        </Button>
        <span className="font-mono text-[10px] text-muted-foreground">
          {profile.profileVersion}
        </span>
      </div>
    </div>
  );
}

function FieldGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[4px] border border-border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
} & Pick<React.ComponentProps<typeof Input>, "min" | "max" | "step">) {
  return (
    <label className="space-y-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </label>
  );
}

function TextListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
}) {
  return (
    <label className="space-y-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        value={value.join(", ")}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-[4px] border border-border bg-input px-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-3 focus:ring-accent/50"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
