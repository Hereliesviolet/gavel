"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAnalyseJobs } from "@/components/analyse/analyse-job-context";
import { jobDomain, stepLabel } from "@/lib/analyse-jobs";
import { cn } from "@/lib/utils";

const VISIBLE = 2;

export function AnalyseJobDock() {
  const pathname = usePathname();
  const { activeJobs } = useAnalyseJobs();
  if (pathname === "/analyse") return null;
  if (activeJobs.length === 0) return null;

  const visible = activeJobs.slice(0, VISIBLE);
  const rest = activeJobs.length - visible.length;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-3xl px-4 pb-4 flex flex-col gap-2 items-stretch pointer-events-auto">
        {rest > 0 && (
          <Link
            href="/analyse"
            className="self-end font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground border border-border bg-blackout px-2 py-1 rounded-[4px] hover:text-accent"
          >
            +{rest} weitere
          </Link>
        )}
        {visible.map((job) => {
          const progress = job.progressPct ?? 0;
          const step = stepLabel(job.step);
          const domain = jobDomain(job.url);
          const doneCount = Math.max(
            1,
            ["FETCH", "EXTRACT", "MARKET", "DEAL", "IMAGES"].indexOf(step) + 1,
          );

          return (
            <Link
              key={job.id}
              href="/analyse"
              className={cn(
                "block rounded-[4px] border border-border bg-blackout px-3 py-2.5",
                "hover:border-accent/60 transition-colors",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-foreground truncate">
                    Analyse läuft · {domain} · {step} {doneCount}/5
                  </p>
                </div>
                <div className="h-1 w-14 shrink-0 rounded-[2px] bg-graphite overflow-hidden">
                  <div
                    className="h-full bg-accent transition-[width] duration-500"
                    style={{ width: `${Math.min(Math.max(progress, 4), 100)}%` }}
                  />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
