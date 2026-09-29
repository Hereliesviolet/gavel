import { Building2, Clock, Gem, Hammer, LayoutGrid, Sprout, type LucideIcon } from "lucide-react";
import type { PickStrategy } from "@/lib/investor-picks";

export type StrategyKey = Exclude<PickStrategy, "wildcard"> | "einstieg";

export const STRATEGY_THEME: Record<
  StrategyKey,
  { color: string; icon: LucideIcon; label: string }
> = {
  fix_flip: {
    color: "var(--strategy-flip)",
    icon: Hammer,
    label: "Fix & Flip",
  },
  buy_hold: {
    color: "var(--strategy-hold)",
    icon: Building2,
    label: "Buy & Hold",
  },
  unter_markt: {
    color: "var(--strategy-value)",
    icon: Gem,
    label: "Marktlücke",
  },
  zeitnah: {
    color: "var(--strategy-urgent)",
    icon: Clock,
    label: "Zeitnah",
  },
  all: {
    color: "var(--primary)",
    icon: LayoutGrid,
    label: "Alle",
  },
  einstieg: {
    color: "var(--strategy-einstieg)",
    icon: Sprout,
    label: "Einstieg",
  },
};
