"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PAGE_SHELL_GUTTER } from "@/components/ui/page-shell";
import { cn } from "@/lib/utils";

/**
 * Vier Seiten, vier Fragen: Was ist heute dran, was gibt es sonst noch,
 * woran arbeite ich, worauf kann ich mich verlassen. Die früheren
 * Strategieseiten sind Presets der Suche geworden.
 */
const ITEMS = [
  { label: "Heute", href: "/investor", exact: true },
  { label: "Suche", href: "/investor/suche" },
  { label: "Deal-Desk", href: "/investor/desk" },
  { label: "Datenbasis", href: "/investor/datenbasis" },
];

const TAB_CLASS =
  "px-3 py-1.5 rounded-[4px] text-sm whitespace-nowrap shrink-0 transition-colors border-b-2";

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function InvestorSubnav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className={PAGE_SHELL_GUTTER}>
        <div className="flex items-center gap-1 overflow-x-auto py-2 scrollbar-none -mx-1 px-1">
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                TAB_CLASS,
                isActive(pathname, item.href, item.exact)
                  ? "border-accent text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}

          <Link
            href="/account/investor"
            className={cn(
              TAB_CLASS,
              "ml-auto border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Investorenprofil
          </Link>
        </div>
      </div>
    </nav>
  );
}
