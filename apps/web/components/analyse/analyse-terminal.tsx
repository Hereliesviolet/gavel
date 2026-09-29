"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AnalysePreviewPanel } from "@/components/analyse/analyse-preview";
import {
  type AnalyseJob,
  formatLogTime,
  isJobActive,
  canRetryAnalyseJob,
  jobDomain,
  stepLabel,
} from "@/lib/analyse-jobs";
import { cn } from "@/lib/utils";

export function AnalyseExperience({
  job,
  onRetry,
  onDismiss,
}: {
  job: AnalyseJob;
  onRetry?: (url: string) => void;
  onDismiss?: () => void;
}) {
  const active = isJobActive(job);
  const domain = jobDomain(job.url);
  const label = stepLabel(job.step);
  const progress = job.progressPct ?? (job.status === "success" ? 100 : 0);
  const stream = useMemo(() => job.stepLog ?? [], [job.stepLog]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [flashDone, setFlashDone] = useState(false);
  const wasSuccess = useRef(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [stream.length, job.stepDetail, job.updatedAt]);

  useEffect(() => {
    if (job.status === "success" && !wasSuccess.current) {
      wasSuccess.current = true;
      setFlashDone(true);
      const t = window.setTimeout(() => setFlashDone(false), 700);
      return () => window.clearTimeout(t);
    }
  }, [job.status]);

  const verdictLines = stream.filter((e) => e.kind === "verdict");
  const lastVerdict = verdictLines[verdictLines.length - 1]?.msg;

  return (
    <div
      className={cn(
        "rounded-[4px] border border-border bg-blackout px-4 py-4 transition-colors duration-500",
        flashDone && "border-accent",
      )}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground truncate">
            {domain}
          </p>
          <p className="font-mono text-xs text-foreground mt-0.5">
            {job.status === "error"
              ? "FAIL"
              : job.status === "success"
                ? "DONE"
                : `${label} · ${Math.min(progress, 100)}%`}
          </p>
        </div>
        {(active || job.status === "success") && (
          <div
            className={cn(
              "h-1 w-20 shrink-0 rounded-[2px] bg-graphite overflow-hidden",
              active && "animate-pulse",
            )}
          >
            <div
              className="h-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.min(Math.max(progress, 4), 100)}%` }}
            />
          </div>
        )}
      </div>

      <AnalysePreviewPanel preview={job.preview} active={active} />

      <div
        ref={scrollerRef}
        className={cn(
          "rounded-[4px] border border-border bg-graphite/40 px-3 py-2.5",
          "font-mono text-[11px] leading-relaxed",
          "min-h-[14rem] max-h-[28rem] overflow-y-auto",
        )}
        aria-live="polite"
      >
        {stream.length === 0 ? (
          <p className="text-muted-foreground/60">
            <span className="text-muted-foreground/40">[--:--:--]</span>{" "}
            <span className="text-accent/70">&gt;</span> warte auf Worker…
          </p>
        ) : (
          <ul className="space-y-0.5">
            {stream.map((entry, idx) => {
              const isLast = idx === stream.length - 1;
              if (entry.kind === "chapter") {
                return (
                  <li
                    key={`${idx}-ch-${entry.msg}`}
                    className="pt-2 first:pt-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80 animate-in fade-in duration-150"
                  >
                    ── {entry.msg} ──
                  </li>
                );
              }
              const isFail =
                job.status === "error" &&
                isLast &&
                (entry.msg === job.errorMessage?.trim() || entry.msg === job.stepDetail?.trim());
              const isTeaser = entry.kind === "teaser";
              const isVerdict = entry.kind === "verdict";
              return (
                <li
                  key={`${idx}-${entry.t ?? ""}-${entry.msg.slice(0, 48)}`}
                  className={cn(
                    "break-words animate-in fade-in slide-in-from-bottom-1 duration-150",
                    entry.hb && isLast && "text-accent",
                    isVerdict && "text-accent",
                    isTeaser && !isLast && "text-foreground/80",
                    isLast
                      ? isFail
                        ? "text-warning"
                        : entry.hb || isVerdict
                          ? "text-accent"
                          : "text-foreground"
                      : !isVerdict && "text-muted-foreground",
                  )}
                >
                  <span className="text-muted-foreground/45">[{formatLogTime(entry.t)}]</span>{" "}
                  <span className={cn(isFail ? "text-warning" : "text-accent/70")}>&gt;</span>{" "}
                  {entry.msg}
                </li>
              );
            })}
            {active && (
              <li className="text-accent/50 animate-pulse">
                <span className="text-muted-foreground/45">[--:--:--]</span>{" "}
                <span className="text-accent/70">&gt;</span> _
              </li>
            )}
          </ul>
        )}
      </div>

      {job.status === "success" && job.listingId && (
        <div className="mt-4 space-y-2 animate-in fade-in duration-300">
          {lastVerdict && <p className="font-mono text-xs text-accent">{lastVerdict}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <Link href={`/analyse/${job.listingId}`}>Ergebnis öffnen</Link>
            </Button>
            {onDismiss && (
              <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
                Ausblenden
              </Button>
            )}
          </div>
        </div>
      )}

      {job.status === "error" && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-warning">{job.errorMessage ?? "Analyse fehlgeschlagen."}</p>
          <div className="flex flex-wrap gap-2">
            {onRetry && canRetryAnalyseJob(job) && (
              <Button type="button" size="sm" variant="secondary" onClick={() => onRetry(job.url)}>
                Erneut versuchen
              </Button>
            )}
            {onDismiss && (
              <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
                Ausblenden
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** @deprecated Alias — Experience ist die kanonische UI */
export const AnalyseTerminal = AnalyseExperience;
