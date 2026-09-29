"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Bell, Lock, History, Palette, TrendingUp, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/account", label: "Profil", icon: User, adminOnly: false },
  { href: "/account/investor", label: "Investorenprofil", icon: TrendingUp, adminOnly: false },
  { href: "/account/alerts", label: "Alerts", icon: Bell, adminOnly: false },
  { href: "/account/security", label: "Sicherheit", icon: Lock, adminOnly: false },
  { href: "/account/sessions", label: "Aktive Sitzungen", icon: History, adminOnly: false },
  { href: "/account/audit", label: "Audit-Log", icon: ScrollText, adminOnly: true },
  { href: "/account/design", label: "Design System", icon: Palette, adminOnly: true },
];

export function AccountNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => !item.adminOnly || isAdmin);
  return (
    <aside className="border-b lg:border-b-0 lg:border-r border-border bg-[var(--sidebar)] p-2 lg:p-3 flex flex-row lg:flex-col gap-0.5 overflow-x-auto lg:overflow-visible">
      <div className="label-mono px-3 pt-2 pb-3 hidden lg:block">Einstellungen</div>
      {items.map((item) => {
        const active =
          item.href === "/account" ? pathname === "/account" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 lg:py-1.5 text-sm rounded-[4px] transition-colors shrink-0 whitespace-nowrap",
              active
                ? "bg-[var(--primary-container)] text-[var(--primary-container-fg)]"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            )}
          >
            <Icon className="size-3.5" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </aside>
  );
}
