"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  type AnalyseJob,
  isAnalyseJobPayload,
  isJobActive,
  loadJobIdsFromStorage,
  saveJobIdsToStorage,
} from "@/lib/analyse-jobs";
import { isValidUuid } from "@/lib/utils";

interface AnalyseJobContextValue {
  jobs: AnalyseJob[];
  activeJobs: AnalyseJob[];
  trackJob: (jobId: string) => void;
  dismissJob: (jobId: string) => void;
}

const AnalyseJobContext = createContext<AnalyseJobContextValue | null>(null);

const POLL_MS_ACTIVE = 500;
const POLL_MS_IDLE = 5000;

export function AnalyseJobProvider({ children }: { children: ReactNode }) {
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [jobsById, setJobsById] = useState<Record<string, AnalyseJob>>({});
  const jobIdsRef = useRef<string[]>([]);
  const jobsByIdRef = useRef<Record<string, AnalyseJob>>({});
  const toastShown = useRef<Set<string>>(new Set());
  const authDeniedShown = useRef(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    const ids = loadJobIdsFromStorage();
    jobIdsRef.current = ids;
    setJobIds(ids);
  }, []);

  useEffect(() => {
    jobsByIdRef.current = jobsById;
  }, [jobsById]);

  const persistIds = useCallback((ids: string[]) => {
    jobIdsRef.current = ids;
    setJobIds(ids);
    saveJobIdsToStorage(ids);
  }, []);

  const applyJob = useCallback((job: AnalyseJob) => {
    const prev = jobsByIdRef.current[job.id];
    const becameTerminal =
      (job.status === "success" || job.status === "error") && (!prev || isJobActive(prev));

    setJobsById((current) => {
      const next = { ...current, [job.id]: job };
      jobsByIdRef.current = next;
      return next;
    });

    if (becameTerminal && !toastShown.current.has(job.id)) {
      toastShown.current.add(job.id);
      if (job.status === "success" && job.listingId && isValidUuid(job.listingId)) {
        toast.success("Analyse fertig", {
          action: {
            label: "Öffnen",
            onClick: () => {
              window.location.href = `/analyse/${job.listingId}`;
            },
          },
        });
      } else if (job.status === "error") {
        toast.error(job.errorMessage ?? "Analyse fehlgeschlagen");
      }
    }
  }, []);

  const denyAuth = useCallback(() => {
    stoppedRef.current = true;
    persistIds([]);
    if (!authDeniedShown.current) {
      authDeniedShown.current = true;
      toast.error("Bitte erneut anmelden");
    }
  }, [persistIds]);

  const poll = useCallback(async () => {
    if (stoppedRef.current) return;
    const ids = jobIdsRef.current;
    try {
      const listRes = await fetch("/api/analyse/jobs");
      if (listRes.status === 401 || listRes.status === 403) {
        denyAuth();
        return;
      }
      if (listRes.status === 429) return;
      if (listRes.ok) {
        const data = (await listRes.json().catch(() => null)) as {
          jobs?: unknown;
          recent?: unknown;
        } | null;
        const active = Array.isArray(data?.jobs) ? data.jobs.filter(isAnalyseJobPayload) : [];
        const recent = Array.isArray(data?.recent) ? data.recent.filter(isAnalyseJobPayload) : [];
        for (const job of [...active, ...recent]) {
          applyJob(job);
        }
        if (active.length > 0) {
          const next = Array.from(new Set([...ids, ...active.map((j) => j.id)]));
          if (next.length !== ids.length || next.some((id, i) => id !== ids[i])) {
            persistIds(next);
          }
        }
      }

      const latestIds = jobIdsRef.current;
      await Promise.all(
        latestIds.map(async (id) => {
          const res = await fetch(`/api/analyse/jobs/${id}`);
          if (res.status === 401 || res.status === 403) {
            denyAuth();
            return;
          }
          if (res.status === 429) return;
          if (res.status === 404) {
            persistIds(jobIdsRef.current.filter((x) => x !== id));
            return;
          }
          if (!res.ok) return;
          const job = await res.json().catch(() => null);
          if (isAnalyseJobPayload(job)) applyJob(job);
        }),
      );
    } catch {
      /* ignore */
    }
  }, [applyJob, denyAuth, persistIds]);

  useEffect(() => {
    void poll();
    let timer: number | undefined;

    const tick = () => {
      if (stoppedRef.current) return;
      const ids = jobIdsRef.current;
      const anyActive = Object.values(jobsByIdRef.current).some(isJobActive);
      if (ids.length === 0 && !anyActive) {
        timer = window.setTimeout(tick, POLL_MS_IDLE);
        return;
      }
      void poll();
      timer = window.setTimeout(tick, anyActive ? POLL_MS_ACTIVE : POLL_MS_IDLE);
    };

    timer = window.setTimeout(tick, POLL_MS_ACTIVE);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [poll]);

  const trackJob = useCallback(
    (jobId: string) => {
      stoppedRef.current = false;
      authDeniedShown.current = false;
      toastShown.current.delete(jobId);
      const next = jobIdsRef.current.includes(jobId)
        ? jobIdsRef.current
        : [...jobIdsRef.current, jobId];
      persistIds(next);
      void poll();
    },
    [persistIds, poll],
  );

  const dismissJob = useCallback(
    (jobId: string) => {
      persistIds(jobIdsRef.current.filter((id) => id !== jobId));
      setJobsById((prev) => {
        const next = { ...prev };
        delete next[jobId];
        jobsByIdRef.current = next;
        return next;
      });
    },
    [persistIds],
  );

  const jobs = useMemo(() => {
    return jobIds
      .map((id) => jobsById[id])
      .filter((j): j is AnalyseJob => j != null)
      .sort((a, b) => (b.requestedAt ?? "").localeCompare(a.requestedAt ?? ""));
  }, [jobIds, jobsById]);

  const activeJobs = useMemo(() => jobs.filter(isJobActive), [jobs]);

  const value = useMemo(
    () => ({ jobs, activeJobs, trackJob, dismissJob }),
    [jobs, activeJobs, trackJob, dismissJob],
  );

  return <AnalyseJobContext.Provider value={value}>{children}</AnalyseJobContext.Provider>;
}

export function useAnalyseJobs(): AnalyseJobContextValue {
  const ctx = useContext(AnalyseJobContext);
  if (!ctx) {
    throw new Error("useAnalyseJobs muss innerhalb von AnalyseJobProvider verwendet werden");
  }
  return ctx;
}
