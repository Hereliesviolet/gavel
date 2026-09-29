"use client";

import { useEffect, useState } from "react";
import { Building2, Home } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const PORTALS = [
  {
    id: "zvg",
    label: "Zwangsversteigerungen",
    icon: Building2,
    href: "/",
    match: (p: string) =>
      p === "/" ||
      (p.startsWith("/") &&
        !p.startsWith("/analyse") &&
        !p.startsWith("/investor") &&
        !p.startsWith("/statistik") &&
        !p.startsWith("/archiv") &&
        !p.startsWith("/rechner") &&
        !p.startsWith("/favoriten") &&
        !p.startsWith("/account") &&
        !p.startsWith("/login")),
  },
  {
    id: "immobilien",
    label: "Immobilienmarkt",
    icon: Home,
    href: "/analyse",
    match: (p: string) => p.startsWith("/analyse"),
  },
] as const;

export function PortalToggle() {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted ? (PORTALS.find((p) => p.match(pathname))?.id ?? "zvg") : "zvg";

  return (
    <div className="w-full bg-primary py-1.5 flex justify-center">
      <div className="flex gap-1">
        {PORTALS.map((p) => {
          const Icon = p.icon;
          const active = current === p.id;
          return (
            <button
              key={p.id}
              onClick={() => router.push(p.href)}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-1 h-7 rounded text-sm font-medium transition-colors",
                active ? "bg-white text-primary" : "text-primary-foreground hover:bg-white/20",
              )}
            >
              <Icon size={14} />
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
