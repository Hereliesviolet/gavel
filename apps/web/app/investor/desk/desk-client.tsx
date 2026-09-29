"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Trash2 } from "lucide-react";
import type { DeskEintrag } from "@/lib/deal-desk";
import {
  DESK_SPALTEN,
  DESK_SPALTEN_TITEL,
  DESK_STATUS,
  DESK_STATUS_LABEL,
  type DeskStatus,
} from "@/lib/deal-desk-status";
import { Button } from "@/components/ui/button";
import { InvestorStageBadge } from "@/components/investor/investor-stage-badge";
import { FAVORITES_COUNT_QUERY_KEY } from "@/hooks/use-favorites-count";
import { calendarDaysUntil, cn, formatCurrency, formatDate, isUpcomingTermin } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const ERGEBNIS_FELDER = [
  { key: "actualBidEur", label: "Gebot (€)", from: "gebotEur" },
  { key: "actualPurchasePriceEur", label: "Zuschlag (€)", from: "kaufpreisEur" },
  { key: "actualRenovationEur", label: "Sanierung (€)", from: "sanierungEur" },
  { key: "actualSalePriceEur", label: "Verkauf (€)", from: "verkaufspreisEur" },
  { key: "actualMonthlyRentEur", label: "Ist-Miete (€/Mon.)", from: "monatsmieteEur" },
  { key: "actualHoldingMonths", label: "Haltedauer (Mon.)", from: "haltedauerMonate" },
] as const;

async function speichere(body: Record<string, unknown>) {
  const antwort = await fetch("/api/investor/outcomes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!antwort.ok) {
    throw new Error(
      antwort.status === 429
        ? "Zu viele Änderungen. Bitte später erneut versuchen."
        : "Speichern fehlgeschlagen",
    );
  }
}

function terminHinweis(terminDate: Date | string | null) {
  if (!terminDate) return null;
  const instant = new Date(terminDate);
  const tage = calendarDaysUntil(instant);
  if (tage == null) return null;
  if (!isUpcomingTermin(instant)) {
    return { text: "Termin vorbei", dringend: false };
  }
  if (tage === 0) return { text: "Termin heute", dringend: true };
  return { text: `Termin in ${tage} T`, dringend: tage <= 14 };
}

export function DeskClient({ eintraege }: { eintraege: DeskEintrag[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [offenerEintrag, setOffenerEintrag] = useState<string | null>(null);
  const [vergleich, setVergleich] = useState<string[]>([]);

  const nachStatus = useMemo(() => {
    const map = new Map<string, DeskEintrag[]>();
    for (const spalte of DESK_SPALTEN) {
      map.set(
        spalte.status,
        eintraege.filter((e) => spalte.enthaelt.includes(e.status)),
      );
    }
    return map;
  }, [eintraege]);

  const aktualisiere = (body: Record<string, unknown>, meldung: string) => {
    startTransition(async () => {
      try {
        await speichere(body);
        toast.success(meldung);
        router.refresh();
      } catch (fehler) {
        toast.error(fehler instanceof Error ? fehler.message : "Fehlgeschlagen");
      }
    });
  };

  const entferne = (listingId: string) => {
    startTransition(async () => {
      const listingQuery = `listingId=${encodeURIComponent(listingId)}&alsoFavorite=1`;
      const antwort = await fetch(`/api/investor/outcomes?${listingQuery}`, {
        method: "DELETE",
      });
      if (antwort.ok) {
        toast.success("Vom Desk entfernt");
        setVergleich((v) => v.filter((id) => id !== listingId));
        void queryClient.invalidateQueries({ queryKey: FAVORITES_COUNT_QUERY_KEY });
        router.refresh();
      } else {
        toast.error("Entfernen fehlgeschlagen");
      }
    });
  };

  if (eintraege.length === 0) {
    return (
      <div className="rounded-[4px] border border-dashed border-border p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Noch nichts auf dem Desk. Merke dir ein Objekt über das Herz-Symbol auf einer Objektseite
          — oder starte in der{" "}
          <Link href="/investor/suche" className="text-accent hover:underline">
            Suche
          </Link>
          .
        </p>
      </div>
    );
  }

  const ausgewaehlte = eintraege.filter((e) => vergleich.includes(e.listingId));

  return (
    <div className="space-y-8">
      {ausgewaehlte.length >= 2 && <Vergleich eintraege={ausgewaehlte} />}

      {DESK_SPALTEN.map((spalte) => {
        const liste = nachStatus.get(spalte.status) ?? [];
        if (liste.length === 0) return null;
        return (
          <section key={spalte.status}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {DESK_SPALTEN_TITEL[spalte.status]}
              <span className="font-mono text-xs">{liste.length}</span>
            </h2>
            <div className="space-y-2">
              {liste.map((eintrag) => (
                <DeskZeile
                  key={eintrag.listingId}
                  eintrag={eintrag}
                  pending={pending}
                  offen={offenerEintrag === eintrag.listingId}
                  imVergleich={vergleich.includes(eintrag.listingId)}
                  onToggleOffen={() =>
                    setOffenerEintrag((aktuell) =>
                      aktuell === eintrag.listingId ? null : eintrag.listingId,
                    )
                  }
                  onToggleVergleich={() =>
                    setVergleich((aktuell) =>
                      aktuell.includes(eintrag.listingId)
                        ? aktuell.filter((id) => id !== eintrag.listingId)
                        : aktuell.length >= 3
                          ? aktuell
                          : [...aktuell, eintrag.listingId],
                    )
                  }
                  onStatus={(status) =>
                    aktualisiere(
                      { listingId: eintrag.listingId, status },
                      `Status: ${DESK_STATUS_LABEL[status]}`,
                    )
                  }
                  onSpeichern={(werte) =>
                    aktualisiere(
                      { listingId: eintrag.listingId, status: eintrag.status, ...werte },
                      "Gespeichert",
                    )
                  }
                  onEntfernen={() => entferne(eintrag.listingId)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DeskZeile({
  eintrag,
  pending,
  offen,
  imVergleich,
  onToggleOffen,
  onToggleVergleich,
  onStatus,
  onSpeichern,
  onEntfernen,
}: {
  eintrag: DeskEintrag;
  pending: boolean;
  offen: boolean;
  imVergleich: boolean;
  onToggleOffen: () => void;
  onToggleVergleich: () => void;
  onStatus: (status: DeskStatus) => void;
  onSpeichern: (werte: Record<string, unknown>) => void;
  onEntfernen: () => void;
}) {
  const [notiz, setNotiz] = useState(eintrag.notizen ?? "");
  const [ergebnis, setErgebnis] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ERGEBNIS_FELDER.map((feld) => [
        feld.key,
        eintrag[feld.from] != null ? String(eintrag[feld.from]) : "",
      ]),
    ),
  );
  const termin = terminHinweis(eintrag.terminDate);
  const pick = eintrag.pick;

  return (
    <article
      className={cn(
        "rounded-[4px] border bg-card",
        imVergleich ? "border-accent" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggleVergleich}
          aria-label="Für Vergleich auswählen"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-[4px] border",
            imVergleich ? "border-accent bg-accent text-accent-foreground" : "border-border",
          )}
        >
          {imVergleich && <Check className="size-3.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {eintrag.href ? (
              <Link
                href={eintrag.href}
                className="truncate text-sm font-medium text-foreground hover:underline"
              >
                {eintrag.titel}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium">{eintrag.titel}</span>
            )}
            {eintrag.offline && (
              <span className="font-mono text-[10px] px-1.5 py-px rounded-[4px] bg-[var(--warning-container)] text-[var(--warning-container-fg)] uppercase">
                Offline
              </span>
            )}
            {pick && (
              <InvestorStageBadge
                datenreife={pick.chance.datenreife}
                sondersituation={pick.chance.sondersituation}
                compact
              />
            )}
            {termin && (
              <span
                className={cn(
                  "text-xs",
                  termin.dringend ? "text-warning" : "text-muted-foreground",
                )}
              >
                {termin.text}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {pick
              ? `Chance ${pick.chance.wert} · Konfidenz ${pick.chance.konfidenz} · VW ${formatCurrency(pick.metrics.verkehrswert)}`
              : "Keine aktuelle Analyse zu diesem Objekt."}
          </p>
        </div>

        <select
          value={eintrag.status}
          disabled={pending}
          onChange={(e) => onStatus(e.target.value as DeskStatus)}
          className="h-8 rounded-[4px] border border-border bg-background px-2 text-xs"
        >
          {DESK_STATUS.map((status) => (
            <option key={status} value={status}>
              {DESK_STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <Button type="button" size="sm" variant="ghost" onClick={onToggleOffen}>
          {offen ? "Zuklappen" : eintrag.notizen ? "Notiz ansehen" : "Notiz & Ergebnis"}
        </Button>
      </div>

      {offen && (
        <div className="space-y-4 border-t border-border p-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Notiz</span>
            <textarea
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Was hast du geprüft, was fehlt noch, warum verworfen?"
              className="w-full rounded-[4px] border border-border bg-background p-2 text-sm"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            {ERGEBNIS_FELDER.map((feld) => (
              <label key={feld.key} className="space-y-1">
                <span className="text-xs text-muted-foreground">{feld.label}</span>
                <input
                  type="number"
                  min={0}
                  value={ergebnis[feld.key]}
                  onChange={(e) =>
                    setErgebnis((werte) => ({ ...werte, [feld.key]: e.target.value }))
                  }
                  className="h-9 w-full rounded-[4px] border border-border bg-background px-2 text-sm"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Erfasste Ist-Werte sind die Grundlage für den späteren Abgleich zwischen Schätzung und
            Realität.
          </p>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                onSpeichern({
                  notes: notiz.trim() || null,
                  ...Object.fromEntries(
                    ERGEBNIS_FELDER.map((feld) => [
                      feld.key,
                      ergebnis[feld.key] === "" ? null : Number(ergebnis[feld.key]),
                    ]),
                  ),
                })
              }
            >
              Speichern
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={onEntfernen}
              className="text-muted-foreground"
            >
              <Trash2 className="mr-1 size-3.5" />
              Vom Desk entfernen
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

const VERGLEICHS_ZEILEN: {
  label: string;
  wert: (eintrag: DeskEintrag) => string;
}[] = [
  { label: "Termin", wert: (e) => formatDate(e.terminDate) },
  {
    label: "Verkehrswert",
    wert: (e) => formatCurrency(e.pick?.metrics.verkehrswert ?? null),
  },
  {
    label: "Preis je m²",
    wert: (e) =>
      e.pick?.metrics.preisProM2 != null ? `${Math.round(e.pick.metrics.preisProM2)} €` : "—",
  },
  {
    label: "Marktlücke",
    wert: (e) =>
      e.pick?.metrics.marktlueckePct != null
        ? `${e.pick.metrics.marktlueckePct.toFixed(0)} %`
        : "keine Referenz",
  },
  { label: "Chance", wert: (e) => (e.pick ? String(e.pick.chance.wert) : "—") },
  { label: "Konfidenz", wert: (e) => e.pick?.chance.konfidenz ?? "—" },
  {
    label: "Maximalgebot",
    wert: (e) => formatCurrency(e.pick?.metrics.maxBidEur ?? null),
  },
  {
    label: "Miete (Basis)",
    wert: (e) => formatCurrency(e.pick?.metrics.mieteEur ?? null),
  },
  {
    label: "Flip-ROI (konservativ)",
    wert: (e) =>
      e.pick?.metrics.flipRoiPctMin != null ? `${e.pick.metrics.flipRoiPctMin.toFixed(1)} %` : "—",
  },
  {
    label: "Risiken",
    wert: (e) => (e.pick ? String(e.pick.risiken.length) : "—"),
  },
  { label: "Eigenes Gebot", wert: (e) => formatCurrency(e.gebotEur) },
];

function Vergleich({ eintraege }: { eintraege: DeskEintrag[] }) {
  return (
    <section className="overflow-x-auto rounded-[4px] border border-accent/40 bg-card p-4">
      <h2 className="mb-3 text-sm font-medium text-foreground">Vergleich ({eintraege.length})</h2>
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr>
            <th className="w-40 pb-2 text-left text-xs font-normal text-muted-foreground">
              Kennzahl
            </th>
            {eintraege.map((eintrag) => (
              <th key={eintrag.listingId} className="pb-2 text-left">
                {eintrag.href ? (
                  <Link href={eintrag.href} className="hover:underline">
                    {eintrag.titel}
                  </Link>
                ) : (
                  eintrag.titel
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VERGLEICHS_ZEILEN.map((zeile) => (
            <tr key={zeile.label} className="border-t border-border">
              <td className="py-1.5 text-xs text-muted-foreground">{zeile.label}</td>
              {eintraege.map((eintrag) => (
                <td key={eintrag.listingId} className="py-1.5 font-mono text-xs">
                  {zeile.wert(eintrag)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
