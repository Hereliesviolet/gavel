"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isFullKiAnalysis, isKiFullPending } from "@/lib/ki-status";

interface FullAnalyseCtaProps {
  slug: string;
  bundesland: string;
  initialTier?: string | null;
  initialStatus?: string | null;
}

export function FullAnalyseCta({
  slug,
  bundesland,
  initialTier,
  initialStatus,
}: FullAnalyseCtaProps) {
  const router = useRouter();
  const [tier, setTier] = useState(initialTier ?? null);
  const [status, setStatus] = useState(initialStatus ?? "idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inProgress = isKiFullPending({ fullStatus: status });

  useEffect(() => {
    setTier(initialTier ?? null);
    setStatus(initialStatus ?? "idle");
  }, [initialTier, initialStatus]);

  useEffect(() => {
    if (!inProgress) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(
          `/api/zvg/${encodeURIComponent(slug)}?bundesland=${encodeURIComponent(bundesland)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          ki_analyse?: { analysisTier?: string | null; fullStatus?: string | null };
        };
        const nextTier = data.ki_analyse?.analysisTier ?? null;
        const nextStatus = data.ki_analyse?.fullStatus ?? "idle";
        setTier(nextTier);
        setStatus(nextStatus);
        if (isFullKiAnalysis({ analysisTier: nextTier }) || nextStatus === "error") {
          router.refresh();
        }
      } catch {
        /* nächster Tick */
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [bundesland, inProgress, router, slug]);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/zvg/${encodeURIComponent(slug)}/ki/full?bundesland=${encodeURIComponent(bundesland)}`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        analysisTier?: string;
        fullStatus?: string;
        status?: string;
      };
      if (res.status === 401) {
        router.push(`/login?from=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Analyse konnte nicht gestartet werden.");
        return;
      }
      setTier(data.analysisTier ?? tier);
      setStatus(data.fullStatus ?? "queued");
      if (data.status === "already_full") {
        router.refresh();
      }
    } catch {
      setError("Analyse konnte nicht gestartet werden.");
    } finally {
      setPending(false);
    }
  }

  if (isFullKiAnalysis({ analysisTier: tier })) {
    return null;
  }

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          {status === "error"
            ? "Die ausführliche Analyse ist fehlgeschlagen. Sie kann erneut gestartet werden und bleibt für alle sichtbar."
            : inProgress
              ? "Die ausführliche Investment-Analyse läuft. Das Ergebnis erscheint hier für alle Nutzer."
              : initialTier
                ? "Die Basisdaten liegen vor. Die ausführliche Investment-Analyse kann ein Nutzer starten — danach sehen sie alle."
                : "Die ausführliche Investment-Analyse kann ein Nutzer starten — danach sehen sie alle."}
        </p>
        <Button onClick={start} disabled={pending || inProgress}>
          {inProgress
            ? "Analyse läuft…"
            : status === "error"
              ? "Erneut versuchen"
              : "Ausführliche Analyse starten"}
        </Button>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
