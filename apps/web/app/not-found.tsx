import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="max-w-[var(--page-max-width)] mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-4">
        404
      </p>
      <h1 className="text-2xl sm:text-3xl font-medium text-foreground mb-3">
        Seite nicht gefunden
      </h1>
      <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
        Die angeforderte Seite existiert nicht oder wurde verschoben.
      </p>
      <Button asChild>
        <Link href="/">Zur Startseite</Link>
      </Button>
    </div>
  );
}
