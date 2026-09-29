"use client";

import { useState } from "react";
import { Check, HelpCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Verdict = "useful" | "not_useful" | "unclear";

const OPTIONS: Array<{
  verdict: Verdict;
  label: string;
  icon: typeof ThumbsUp;
}> = [
  { verdict: "useful", label: "Hilfreich", icon: ThumbsUp },
  { verdict: "not_useful", label: "Nicht hilfreich", icon: ThumbsDown },
  { verdict: "unclear", label: "Unklar", icon: HelpCircle },
];

export function InvestmentFeedback({
  listingId,
  analysisVersion,
}: {
  listingId: string;
  analysisVersion: string;
}) {
  const [selected, setSelected] = useState<Verdict | null>(null);
  const [saving, setSaving] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(verdict: Verdict) {
    setSaving(verdict);
    setError(null);
    try {
      const response = await fetch("/api/investor/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, verdict, analysisVersion }),
      });
      if (!response.ok) {
        throw new Error(
          response.status === 429
            ? "Zu viele Änderungen. Bitte später erneut versuchen."
            : "Feedback fehlgeschlagen",
        );
      }
      setSelected(verdict);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Feedback fehlgeschlagen");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-medium">War dieses Decision Memo hilfreich?</div>
          <div className="text-[10px] text-muted-foreground">
            Feedback dient nur der Evaluation, nicht der automatischen Kaufentscheidung.
          </div>
        </div>
        <div className="flex gap-1.5">
          {OPTIONS.map((option) => {
            const Icon = selected === option.verdict ? Check : option.icon;
            return (
              <button
                key={option.verdict}
                type="button"
                disabled={saving != null}
                onClick={() => submit(option.verdict)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-[4px] border px-2 py-1 text-[10px] transition-colors disabled:opacity-50",
                  selected === option.verdict
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <Icon className="size-3" />
                {saving === option.verdict ? "Speichert …" : option.label}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
