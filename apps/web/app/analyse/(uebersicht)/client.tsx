"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Link2,
  Loader2,
  Search,
  AlertTriangle,
  Trash2,
  ChevronDown,
  FileText,
  Code2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, isValidUuid } from "@/lib/utils";
import { PreisBewertungIcon, PREIS_BEWERTUNG_LABEL } from "@/components/analyse/preis-bewertung";
import { AnalyseTerminal } from "@/components/analyse/analyse-terminal";
import { useAnalyseJobs } from "@/components/analyse/analyse-job-context";
import { isJobActive, isManualUploadUrl, jobDomain } from "@/lib/analyse-jobs";
import { normalizeCookieHeader, validateAnalyseUrl } from "@/lib/safe-url";

type AnalyseMode = "url" | "html" | "pdf";

const MAX_HTML_CHARS = 1_500_000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

interface AnalyseSubmission {
  url?: string;
  html?: string;
  pdfBase64?: string;
  cookieHeader?: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.onload = () => {
      const result = reader.result as string;
      // data:application/pdf;base64,XXXX → nur den Teil nach dem Komma senden.
      resolve(result.split(",", 2)[1] ?? "");
    };
    reader.readAsDataURL(file);
  });
}

export interface AnalyseHistoryEntry {
  listingId: string;
  titel: string | null;
  sourceUrl: string;
  source: string;
  preis: number | null;
  angebotstyp: string | null;
  wohnflaecheM2: number | null;
  ort: string | null;
  preisBewertung: string | null;
  zusammenfassung: string | null;
  analyzedAt: Date | null;
  offline?: boolean;
}

export function AnalyseClient({
  initialHistory,
  failedAttempts,
}: {
  initialHistory: AnalyseHistoryEntry[];
  failedAttempts: number;
}) {
  const router = useRouter();
  const { jobs, trackJob, dismissJob } = useAnalyseJobs();
  const [mode, setMode] = useState<AnalyseMode>("url");
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [showCookieField, setShowCookieField] = useState(false);
  const [cookieHeader, setCookieHeader] = useState("");
  const [cookieConsent, setCookieConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const mergedSuccess = useRef<Set<string>>(new Set());

  useEffect(() => {
    setHistory(initialHistory);
  }, [initialHistory]);

  // Historie nach Erfolg neu laden; Terminal mit CTA bleibt sichtbar.
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== "success" || !job.listingId) continue;
      if (mergedSuccess.current.has(job.id)) continue;
      mergedSuccess.current.add(job.id);
      router.refresh();
    }
  }, [jobs, router]);

  const assemblyJobs = useMemo(() => {
    return jobs
      .filter((j) => isJobActive(j) || j.status === "error" || j.status === "success")
      .sort((a, b) => (b.requestedAt ?? "").localeCompare(a.requestedAt ?? ""));
  }, [jobs]);

  async function startAnalyse(submission: AnalyseSubmission) {
    setSubmitting(true);
    setError(null);

    try {
      const postRes = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });
      const postData = await postRes.json();

      if (!postRes.ok) {
        setError(postData.error ?? "Analyse konnte nicht gestartet werden");
        return;
      }

      if (typeof postData.jobId === "string" && isValidUuid(postData.jobId)) {
        trackJob(postData.jobId);
        setUrl("");
        setHtml("");
        setPdfFile(null);
        setReferenceUrl("");
        setCookieHeader("");
        setCookieConsent(false);
        setShowCookieField(false);
        toast.message("Analyse gestartet");
      }
    } catch {
      setError("Der Analyse-Dienst ist gerade nicht erreichbar. Bitte später erneut versuchen.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUrlRetry(retryUrl: string) {
    if (isManualUploadUrl(retryUrl)) return;
    await startAnalyse({ url: retryUrl });
  }

  function optionalReferenceUrl(): string | undefined | false {
    const raw = referenceUrl.trim();
    if (!raw) return undefined;
    const validated = validateAnalyseUrl(raw);
    if (!validated.ok) {
      setError(validated.error);
      return false;
    }
    return validated.url;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (mode === "url") {
      if (!url.trim()) return;
      if (showCookieField && cookieHeader.trim() && !cookieConsent) {
        setError("Bitte die Bestätigung zum eingefügten Sitzungs-Cookie ankreuzen.");
        return;
      }
      const cookie = showCookieField && cookieConsent ? normalizeCookieHeader(cookieHeader) : "";
      await startAnalyse({
        url: url.trim(),
        cookieHeader: cookie || undefined,
      });
      return;
    }

    if (mode === "html") {
      if (!html.trim()) return;
      if (html.length > MAX_HTML_CHARS) {
        setError(
          `HTML-Inhalt ist zu groß (Limit ${MAX_HTML_CHARS.toLocaleString("de-DE")} Zeichen)`,
        );
        return;
      }
      const ref = optionalReferenceUrl();
      if (ref === false) return;
      await startAnalyse({ url: ref, html });
      return;
    }

    if (mode === "pdf") {
      if (!pdfFile) return;
      if (pdfFile.size > MAX_PDF_BYTES) {
        setError("PDF-Datei ist zu groß (Limit 15 MB)");
        return;
      }
      const ref = optionalReferenceUrl();
      if (ref === false) return;
      setSubmitting(true);
      setError(null);
      try {
        const pdfBase64 = await fileToBase64(pdfFile);
        await startAnalyse({ url: ref, pdfBase64 });
      } catch {
        setError("PDF-Datei konnte nicht gelesen werden.");
        setSubmitting(false);
      }
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28">
      <div className="flex items-center gap-3 mb-2">
        <Search className="text-primary size-6" />
        <h1 className="text-2xl font-bold text-foreground">Custom-URL-Analyse</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">
        Füge den Link zu einem beliebigen Immobilien-Angebot ein - egal ob ImmoScout24, eBay
        Kleinanzeigen, Immowelt oder eine andere Makler-/Anbieter-Website - und erhalte eine
        unabhängige Markt-Fairness-Einschätzung. Für private/login-geschützte Angebote gibt es
        HTML-Einfügung, PDF-Upload und einen optionalen Sitzungs-Cookie.
      </p>

      <Card className="mb-8">
        <CardContent className="pt-6">
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as AnalyseMode);
              setError(null);
            }}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="url">
                <Link2 className="size-3.5" /> Link
              </TabsTrigger>
              <TabsTrigger value="html">
                <Code2 className="size-3.5" /> HTML einfügen
              </TabsTrigger>
              <TabsTrigger value="pdf">
                <FileText className="size-3.5" /> PDF hochladen
              </TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <TabsContent value="url" className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="url">Angebots-URL</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="url"
                        type="url"
                        required={mode === "url"}
                        placeholder="https://www.beispiel-makler.de/angebot/..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={submitting}
                        className="pl-9"
                      />
                    </div>
                    <Button type="submit" disabled={submitting || !url.trim()}>
                      {submitting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Search className="size-4" />
                      )}
                      Analysieren
                    </Button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCookieField((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground self-start"
                >
                  <ChevronDown
                    className={`size-3.5 transition-transform ${showCookieField ? "rotate-180" : ""}`}
                  />
                  Erweitert: privates/eingeloggtes Angebot per Sitzungs-Cookie
                </button>

                {showCookieField && (
                  <div className="flex flex-col gap-2 rounded-[4px] border border-border bg-muted/30 p-3">
                    <Label htmlFor="cookieHeader">Sitzungs-Cookie (optional)</Label>
                    <Textarea
                      id="cookieHeader"
                      rows={2}
                      placeholder="name1=wert1; name2=wert2"
                      value={cookieHeader}
                      onChange={(e) => setCookieHeader(e.target.value)}
                      disabled={submitting}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Nur nötig, wenn das Angebot einen Login erfordert. Öffne die Anzeige in deinem
                      eigenen Browser, kopiere den Cookie-Header aus den Entwicklertools
                      (Netzwerk-Tab → Anfrage → &quot;Cookie&quot;) und füge ihn hier ein. Der
                      Cookie wird ausschließlich für diese eine Anfrage genutzt, nirgendwo
                      gespeichert und nie an andere Nutzer weitergegeben.
                    </p>
                    <label className="flex items-start gap-2 text-xs text-foreground">
                      <Checkbox
                        checked={cookieConsent}
                        onCheckedChange={(v) => setCookieConsent(v === true)}
                        disabled={submitting}
                      />
                      <span>
                        Ich bestätige, dass dies mein eigener, aktuell eingeloggter Cookie ist und
                        ich zum Zugriff auf diese Seite berechtigt bin.
                      </span>
                    </label>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="html" className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="referenceUrlHtml">Angebots-URL (optional)</Label>
                  <Input
                    id="referenceUrlHtml"
                    type="url"
                    placeholder="https://www.beispiel-makler.de/angebot/... (nur als Link zur Originalanzeige)"
                    value={referenceUrl}
                    onChange={(e) => setReferenceUrl(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="html">Seitenquelltext</Label>
                  <Textarea
                    id="html"
                    rows={8}
                    required={mode === "html"}
                    placeholder="Seite im Browser öffnen → Rechtsklick → Seitenquelltext anzeigen → alles kopieren und hier einfügen"
                    value={html}
                    onChange={(e) => setHtml(e.target.value)}
                    disabled={submitting}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Für private/login-geschützte Angebote: öffne die Anzeige eingeloggt in deinem
                    eigenen Browser und füge den vollständigen Seitenquelltext ein. Es findet kein
                    automatischer Abruf der URL statt.
                  </p>
                </div>
                <Button type="submit" disabled={submitting || !html.trim()} className="self-start">
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Code2 className="size-4" />
                  )}
                  Analysieren
                </Button>
              </TabsContent>

              <TabsContent value="pdf" className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="referenceUrlPdf">Angebots-URL (optional)</Label>
                  <Input
                    id="referenceUrlPdf"
                    type="url"
                    placeholder="https://www.beispiel-makler.de/angebot/... (nur als Link zur Originalanzeige)"
                    value={referenceUrl}
                    onChange={(e) => setReferenceUrl(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="pdfFile">Exposé-PDF</Label>
                  <input
                    id="pdfFile"
                    type="file"
                    accept="application/pdf"
                    disabled={submitting}
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                    className="text-sm text-foreground file:mr-3 file:rounded-[4px] file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/70"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ein gespeichertes Exposé-PDF (max. 15 MB) - z.B. aus einer E-Mail oder einem
                    Login-Bereich. Der Text wird direkt aus dem PDF gelesen, ohne die Seite live
                    abzurufen.
                  </p>
                </div>
                <Button type="submit" disabled={submitting || !pdfFile} className="self-start">
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileText className="size-4" />
                  )}
                  Analysieren
                </Button>
              </TabsContent>

              {error && (
                <div className="flex items-start gap-2 rounded-[4px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </form>
          </Tabs>
        </CardContent>
      </Card>

      {assemblyJobs.length > 0 && (
        <div className="mb-10 space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Laufende Analysen</h2>
          {assemblyJobs.map((job) => (
            <AnalyseTerminal
              key={job.id}
              job={job}
              onRetry={(retryUrl) => void handleUrlRetry(retryUrl)}
              onDismiss={() => dismissJob(job.id)}
            />
          ))}
        </div>
      )}

      <div className="flex items-baseline justify-between mt-10 mb-3">
        <h2 className="text-lg font-semibold text-foreground">Meine bisherigen Analysen</h2>
        {failedAttempts > 0 && (
          <span className="text-xs text-muted-foreground">
            {failedAttempts} fehlgeschlagene{failedAttempts === 1 ? "r" : ""} Versuch
            {failedAttempts === 1 ? "" : "e"} nicht angezeigt
          </span>
        )}
      </div>

      {history.length === 0 && assemblyJobs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6">Noch keine Analysen durchgeführt.</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Noch keine abgeschlossenen Analysen in der Historie.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <HistoryRow
              key={h.listingId}
              entry={h}
              onDeleted={(listingId) =>
                setHistory((prev) => prev.filter((entry) => entry.listingId !== listingId))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  entry,
  onDeleted,
}: {
  entry: AnalyseHistoryEntry;
  onDeleted: (listingId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    if (
      !window.confirm(
        "Analyse aus dem Verlauf entfernen? Geteilte öffentliche Live-Scrapes anderer Nutzer bleiben erhalten.",
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/analyse/${entry.listingId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error ?? "Analyse konnte nicht gelöscht werden.");
        return;
      }
      onDeleted(entry.listingId);
    } catch {
      toast.error("Netzwerkfehler beim Löschen.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-[4px] border border-border hover:border-foreground/40 transition-colors">
      <Link href={`/analyse/${entry.listingId}`} className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate">
          {entry.titel ?? entry.sourceUrl}
        </div>
        <div className="text-xs text-muted-foreground font-mono truncate">
          {jobDomain(entry.sourceUrl) || entry.source}
          {entry.ort ? ` · ${entry.ort}` : ""}
          {entry.offline ? " · nicht mehr online" : ""}
        </div>
      </Link>
      <div className="flex items-center gap-3 shrink-0">
        {entry.preis != null && (
          <span className="text-sm text-foreground">
            {formatCurrency(entry.preis)}
            {entry.angebotstyp === "miete" ? " / Monat" : ""}
          </span>
        )}
        {entry.preisBewertung && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <PreisBewertungIcon bewertung={entry.preisBewertung} />
            {PREIS_BEWERTUNG_LABEL[entry.preisBewertung] ?? entry.preisBewertung}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={deleting}
          onClick={handleDelete}
          aria-label="Analyse löschen"
        >
          {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
