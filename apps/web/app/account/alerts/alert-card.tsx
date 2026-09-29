"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Trash2, Bell, BellOff, Target, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { isUsableGeoPoint } from "@/lib/geo-point";
import { DISPLAY_TIME_ZONE } from "@/lib/utils";

interface AlertCriteria {
  bundesland?: string;
  kategorie?: string | string[];
  min_preis?: number;
  max_preis?: number;
  min_flaeche?: number;
  max_flaeche?: number;
  amtsgericht?: string;
  plz?: string;
  umkreis_km?: number;
  plz_lat?: number;
  plz_lng?: number;
}

interface Alert {
  id: string;
  name: string;
  alertType: string;
  criteria: unknown;
  frequency: string | null;
  isActive: boolean | null;
  createdAt: Date | null;
  lastTriggeredAt?: Date | null;
}

const FREQUENCY_LABELS: Record<string, string> = {
  instant: "Sofort",
  daily: "Täglich",
  weekly: "Wöchentlich",
};

function formatCriteria(criteria: unknown): string {
  if (!criteria || typeof criteria !== "object") return "—";
  const c = criteria as AlertCriteria;
  const parts: string[] = [];
  if (c.bundesland) parts.push(c.bundesland);
  if (c.kategorie) {
    const k = Array.isArray(c.kategorie) ? c.kategorie.join(", ") : c.kategorie;
    parts.push(k);
  }
  if (c.min_preis || c.max_preis) {
    const preis = [
      c.min_preis ? `ab ${c.min_preis.toLocaleString("de-DE")} €` : null,
      c.max_preis ? `bis ${c.max_preis.toLocaleString("de-DE")} €` : null,
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(preis);
  }
  if (c.min_flaeche || c.max_flaeche) {
    const fl = [
      c.min_flaeche ? `ab ${c.min_flaeche} m²` : null,
      c.max_flaeche ? `bis ${c.max_flaeche} m²` : null,
    ]
      .filter(Boolean)
      .join(" ");
    parts.push(fl);
  }
  if (c.amtsgericht) parts.push(`AG ${c.amtsgericht}`);
  if (c.plz && c.umkreis_km) parts.push(`${c.umkreis_km} km um ${c.plz}`);
  else if (c.plz) parts.push(c.plz);
  return parts.length > 0 ? parts.join(" · ") : "Alle Objekte";
}

function alertNeedsGeocode(criteria: unknown): boolean {
  if (!criteria || typeof criteria !== "object") return false;
  const c = criteria as AlertCriteria;
  return Boolean(c.plz && c.umkreis_km != null && !isUsableGeoPoint(c.plz_lat, c.plz_lng));
}

function formatDateTime(d?: Date | string | null): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function AlertCard({ alert, hitCount = 0 }: { alert: Alert; hitCount?: number }) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(alert.isActive ?? true);
  const [isPending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/alerts/${alert.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !isActive }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(data?.error ?? "Alert konnte nicht geändert werden.");
          return;
        }
        setIsActive((v) => !v);
      } catch {
        toast.error("Netzwerkfehler. Bitte erneut versuchen.");
      }
    });
  }

  function deleteAlert() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/alerts/${alert.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(data?.error ?? "Alert konnte nicht gelöscht werden.");
          return;
        }
        router.refresh();
      } catch {
        toast.error("Netzwerkfehler. Bitte erneut versuchen.");
      }
    });
  }

  return (
    <Card className="hover:border-border/80 transition-colors">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className="font-semibold text-foreground">{alert.name}</p>
              <Badge
                variant={isActive ? "default" : "secondary"}
                className={
                  isActive
                    ? "bg-[var(--success-container)] text-[var(--success-container-fg)] hover:bg-[var(--success-container)]"
                    : ""
                }
              >
                {isActive ? "Aktiv" : "Inaktiv"}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {alert.alertType.toUpperCase()}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground mt-1">{formatCriteria(alert.criteria)}</p>
            {alertNeedsGeocode(alert.criteria) ? (
              <p className="text-xs text-destructive mt-1.5">
                Umkreis ohne Koordinaten — keine Treffer-Mails, bis die PLZ geokodiert ist.
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground mt-1.5">
              Frequenz: {FREQUENCY_LABELS[alert.frequency ?? "daily"] ?? alert.frequency}
            </p>

            <div className="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-border/60">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Target size={13} className="text-primary" />
                <span>
                  <strong className="text-foreground font-semibold">{hitCount}</strong> Treffer
                  bisher
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Zuletzt geprüft:{" "}
                <span className="text-foreground">
                  {formatDateTime(alert.lastTriggeredAt) ?? "noch nie"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 sm:size-8"
              asChild
              title="Bearbeiten"
            >
              <Link href={`/account/alerts/${alert.id}/edit`}>
                <Pencil />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 sm:size-8"
              onClick={toggleActive}
              disabled={isPending}
              title={isActive ? "Deaktivieren" : "Aktivieren"}
            >
              {isActive ? <Bell /> : <BellOff />}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isPending}
                    title="Alert löschen"
                    className="size-10 sm:size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  />
                }
              >
                <Trash2 />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Alert löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Der Alert „{alert.name}“ wird unwiderruflich gelöscht.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteAlert}>Löschen</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
