"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center space-y-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Fehler
      </p>
      <h1 className="text-heading-sm text-foreground">Etwas ist schiefgelaufen</h1>
      <p className="text-sm text-muted-foreground">
        Die Seite konnte nicht geladen werden. Bitte erneut versuchen.
      </p>
      <Button type="button" onClick={reset}>
        Erneut versuchen
      </Button>
    </div>
  );
}
