"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="de" className="dark">
      <body className="bg-blackout text-foreground min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Kritischer Fehler
          </p>
          <h1 className="text-xl font-medium">Gavel konnte nicht starten</h1>
          <p className="text-sm text-muted-foreground">
            Die Anwendung konnte nicht geladen werden. Bitte erneut versuchen.
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center rounded-[4px] bg-foreground text-background px-4 py-2 text-sm font-medium"
          >
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
