"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Archive, Menu, ScanSearch, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { SearchCommandDialog } from "@/components/layout/search-command-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFavoritesCount } from "@/hooks/use-favorites-count";

const NAV_ITEMS = [
  { label: "Übersicht", href: "/" },
  { label: "Termine", href: "/termine" },
  { label: "Rechner", href: "/rechner" },
  { label: "Analyse", href: "/analyse", icon: ScanSearch },
  { label: "Archiv", href: "/archiv", icon: Archive },
] as const;

const INVESTOR_LINKS = [
  { label: "Heute", href: "/investor" },
  { label: "Suche", href: "/investor/suche" },
  { label: "Deal-Desk", href: "/investor/desk" },
  { label: "Datenbasis", href: "/investor/datenbasis" },
] as const;

export interface NavbarProps {
  portal?: "ZVG";
  favoritenCount?: number;
  user?: { initials: string } | null;
}

export function Navbar({ portal = "ZVG", favoritenCount, user }: NavbarProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [investorOpen, setInvestorOpen] = useState(false);
  const liveFavoritenCount = useFavoritesCount(favoritenCount ?? 0);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-background px-4 py-2.5 sm:px-6">
      <div className="flex items-center gap-8">
        <Link href="/" className="group flex items-center gap-2">
          <Logo />
          <span className="font-medium tracking-tight text-foreground">Gavel</span>
          <span className="hidden rounded-[4px] border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground sm:inline">
            {portal}
          </span>
        </Link>
        <nav className="hidden items-center gap-0.5 text-sm lg:flex">
          {NAV_ITEMS.map((item) => {
            const active =
              mounted && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
            const Icon = "icon" in item ? item.icon : undefined;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "-mb-px flex items-center gap-1.5 px-3 py-1.5 transition-colors",
                  active
                    ? "border-b-2 border-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {Icon && <Icon className="size-3.5" />}
                {item.label}
              </Link>
            );
          })}
          <InvestorNavDropdown mounted={mounted} pathname={pathname} />
        </nav>
      </div>

      <div className="hidden items-center gap-2 lg:flex">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 font-mono text-xs"
          onClick={() => setSearchOpen(true)}
          aria-label="Suche öffnen"
        >
          <Search className="size-3" />
          <span className="text-muted-foreground">Suchen</span>
          <kbd className="text-[10px] text-muted-foreground">⌘K</kbd>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/favoriten" className="font-mono text-xs">
            Favoriten
            {user && <span className="ml-1 text-muted-foreground">· {liveFavoritenCount}</span>}
          </Link>
        </Button>
        {mounted && user && (
          <Link href="/account">
            <div className="flex size-7 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
              {user.initials}
            </div>
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setSearchOpen(true)}
          aria-label="Suche öffnen"
        >
          <Search className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setMenuOpen(true)}
          aria-label="Menü öffnen"
        >
          <Menu className="size-5" />
        </Button>
      </div>

      <SearchCommandDialog open={searchOpen} onOpenChange={setSearchOpen} />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="flex w-3/4 flex-col p-0 sm:max-w-sm">
          <SheetHeader className="border-b border-border px-4 py-4">
            <SheetTitle className="flex items-center gap-2">
              <Logo />
              Gavel
            </SheetTitle>
          </SheetHeader>

          <nav className="flex flex-col gap-1 overflow-y-auto p-3">
            {NAV_ITEMS.map((item) => {
              const active =
                mounted && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
              const Icon = "icon" in item ? item.icon : undefined;
              return (
                <SheetClose
                  key={item.href}
                  render={
                    <Link
                      href={item.href}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-[4px] border-l-2 px-3 text-base transition-colors",
                        active
                          ? "border-accent font-medium text-accent"
                          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    />
                  }
                >
                  {Icon && <Icon className="size-4 shrink-0" />}
                  {item.label}
                </SheetClose>
              );
            })}

            <button
              type="button"
              onClick={() => setInvestorOpen((o) => !o)}
              className={cn(
                "flex min-h-11 w-full items-center justify-between rounded-[4px] border-l-2 px-3 text-base transition-colors",
                mounted && pathname.startsWith("/investor")
                  ? "border-accent font-medium text-accent"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              KI Investor
              <ChevronDown
                className={cn("size-4 transition-transform", investorOpen && "rotate-180")}
              />
            </button>
            {investorOpen && (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-3">
                {INVESTOR_LINKS.map((link) => (
                  <SheetClose
                    key={link.href}
                    render={
                      <Link
                        href={link.href}
                        className={cn(
                          "flex min-h-10 items-center rounded-[4px] px-3 text-sm transition-colors",
                          mounted && pathname === link.href
                            ? "font-medium text-accent"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      />
                    }
                  >
                    {link.label}
                  </SheetClose>
                ))}
              </div>
            )}

            <div className="my-2 border-t border-border" />

            <SheetClose
              render={
                <Link
                  href="/favoriten"
                  className="flex min-h-11 items-center gap-3 rounded-[4px] px-3 text-base text-foreground transition-colors hover:bg-muted"
                />
              }
            >
              Favoriten
              {user && (
                <span className="text-sm text-muted-foreground">· {liveFavoritenCount}</span>
              )}
            </SheetClose>

            {mounted && user && (
              <SheetClose
                render={
                  <Link
                    href="/account"
                    className="flex min-h-11 items-center gap-3 rounded-[4px] px-3 text-base text-foreground transition-colors hover:bg-muted"
                  />
                }
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold">
                  {user.initials}
                </div>
                Account
              </SheetClose>
            )}
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}

function InvestorNavDropdown({ mounted, pathname }: { mounted: boolean; pathname: string }) {
  const active = mounted && pathname.startsWith("/investor");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "-mb-px flex items-center gap-1 px-3 py-1.5 outline-none transition-colors",
          active
            ? "border-b-2 border-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        KI Investor
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {INVESTOR_LINKS.map((link) => (
          <DropdownMenuItem key={link.href} render={<Link href={link.href} />}>
            {link.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Logo() {
  return (
    <div className="relative size-[18px] rounded-[4px] bg-accent">
      <div className="absolute inset-1 rounded-[2px] bg-background" />
      <div className="absolute left-2 top-1 h-2.5 w-0.5 bg-accent" />
    </div>
  );
}
