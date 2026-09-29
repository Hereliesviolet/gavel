import { cn } from "@/lib/utils";

export type EnergieKlasse = "A+" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

const CLASSES: { key: EnergieKlasse; color: string }[] = [
  { key: "A+", color: "oklch(0.72 0.155 145)" },
  { key: "A", color: "oklch(0.65 0.16 130)" },
  { key: "B", color: "oklch(0.72 0.15 115)" },
  { key: "C", color: "oklch(0.78 0.15 95)" },
  { key: "D", color: "oklch(0.78 0.15 80)" },
  { key: "E", color: "oklch(0.74 0.16 60)" },
  { key: "F", color: "oklch(0.7 0.17 40)" },
  { key: "G", color: "oklch(0.66 0.195 25)" },
  { key: "H", color: "oklch(0.55 0.18 15)" },
];

export function EnergieSkala({
  klasse,
  kwh,
  className,
}: {
  klasse: EnergieKlasse;
  kwh?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-stretch h-8 rounded-[4px] overflow-hidden text-[11px] font-mono font-semibold",
        className,
      )}
    >
      {CLASSES.map((c) => {
        const active = c.key === klasse;
        const isLight = ["F", "G", "H"].includes(c.key);
        return (
          <div
            key={c.key}
            className="flex items-center justify-center"
            style={{
              flex: active ? 1.5 : 1,
              background: c.color,
              color: isLight ? "var(--color-graphite-deep)" : "var(--color-whiteout)",
              boxShadow: active ? "inset 0 0 0 2px var(--color-neon-glow)" : undefined,
            }}
          >
            {active && kwh != null ? `${c.key} · ${kwh} kWh` : c.key}
          </div>
        );
      })}
    </div>
  );
}
