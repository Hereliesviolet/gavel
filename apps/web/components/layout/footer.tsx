import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border/40 mt-auto">
      <div className="max-w-[var(--page-max-width)] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row justify-between items-center gap-3">
        <p className="text-xs font-mono text-muted-foreground tracking-wide">
          GAVEL · Internes Tool · {new Date().getFullYear()}
        </p>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <Link href="/archiv" className="hover:text-foreground transition-colors">
            Archiv
          </Link>
        </div>
      </div>
    </footer>
  );
}
