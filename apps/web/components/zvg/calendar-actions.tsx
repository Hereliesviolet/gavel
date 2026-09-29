"use client";

import { CalendarPlus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildVersteigerungIcs } from "@/lib/utils";

export type CalendarIcsParams = {
  title: string;
  terminDate: string;
  location: string;
  description?: string;
  uid?: string;
};

type CalendarActionsProps = {
  googleUrl: string;
  outlookUrl: string;
  ics: CalendarIcsParams;
  filename?: string;
};

export function CalendarActions({
  googleUrl,
  outlookUrl,
  ics,
  filename = "versteigerung.ics",
}: CalendarActionsProps) {
  function downloadIcs() {
    const content = buildVersteigerungIcs(ics);
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <Button size="sm" className="w-full" asChild>
        <a href={googleUrl} target="_blank" rel="noopener noreferrer">
          <CalendarPlus data-icon="inline-start" />
          In Google Kalender eintragen
        </a>
      </Button>
      <Button type="button" size="sm" variant="outline" className="w-full" onClick={downloadIcs}>
        <Download data-icon="inline-start" />
        In Outlook eintragen (.ics)
      </Button>
      <Button size="sm" variant="ghost" className="w-full" asChild>
        <a href={outlookUrl} target="_blank" rel="noopener noreferrer">
          <CalendarPlus data-icon="inline-start" />
          Outlook im Browser öffnen
        </a>
      </Button>
    </div>
  );
}
