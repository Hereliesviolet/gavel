import { cn } from "@/lib/utils";

/**
 * Horizontaler segmentierter Balken für die drei ZVG-Bietergrenzen:
 *   0   → 50 %   5/10  · Zuschlagsverbot
 *   50  → 70 %   7/10  · Mindestgebot Behörde
 *   70  → 100 %  10/10 · bis Verkehrswert
 *
 * Farben über dedizierte Tokens (--color-bietgrenze-*), nicht --warning/--destructive
 * (die im Neon-Theme identisch auf system-warning mappen).
 *
 * <BietergrenzeBar verkehrswert={285000} />
 */
export function BietergrenzeBar({
  verkehrswert,
  currentBid,
  geringstesGebot,
  className,
}: {
  verkehrswert: number;
  currentBid?: number;
  /** Aus der Terminsbestimmung gelesen; undefined heißt unbekannt. */
  geringstesGebot?: number | null;
  className?: string;
}) {
  const halb = verkehrswert * 0.5;
  const sieben = verkehrswert * 0.7;
  const bidPct =
    currentBid != null ? Math.max(0, Math.min(100, (currentBid / verkehrswert) * 100)) : null;

  const color5 = "var(--color-bietgrenze-5-10)";
  const color7 = "var(--color-bietgrenze-7-10)";
  const color10 = "var(--color-bietgrenze-10-10)";

  return (
    <div
      className={cn("w-full", className)}
      role="img"
      aria-label={`Bietgrenzen: 0–50 % Zuschlagsverbot (${halb.toLocaleString("de-DE")} €), 50–70 % Mindestgebot (${sieben.toLocaleString("de-DE")} €), 70–100 % bis Verkehrswert (${verkehrswert.toLocaleString("de-DE")} €)`}
    >
      <div className="relative h-2 rounded-[4px] bg-graphite overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1/2" style={{ background: color5 }} />
        <div
          className="absolute inset-y-0"
          style={{ left: "50%", width: "20%", background: color7 }}
        />
        <div
          className="absolute inset-y-0"
          style={{ left: "70%", right: 0, background: color10 }}
        />
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-whiteout"
          style={{ left: "50%", transform: "translateX(-50%)" }}
        />
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-whiteout"
          style={{ left: "70%", transform: "translateX(-50%)" }}
        />
        {bidPct != null && (
          <div
            className="absolute -top-1.5 -bottom-1.5 w-1 bg-accent"
            style={{ left: `${bidPct}%`, transform: "translateX(-50%)" }}
            aria-label="Aktueller Stand"
          />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 font-mono text-[11px]">
        <Threshold
          color={color5}
          label="5/10"
          value={`${halb.toLocaleString("de-DE")} €`}
          note="Zuschlagsverbot"
        />
        <Threshold
          color={color7}
          label="7/10"
          value={`${sieben.toLocaleString("de-DE")} €`}
          note="Mindestgebot"
        />
        <Threshold
          color={color10}
          label="10/10"
          value={`${verkehrswert.toLocaleString("de-DE")} €`}
          note="Verkehrswert"
        />
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {geringstesGebot != null ? (
          <>
            Geringstes Gebot laut Terminsbestimmung:{" "}
            <span className="font-mono text-foreground">
              {geringstesGebot.toLocaleString("de-DE")} €
            </span>
          </>
        ) : (
          "Geringstes Gebot: nicht bekannt. Es steht in der Terminsbestimmung und lässt sich nicht aus dem Verkehrswert ableiten."
        )}
      </p>
    </div>
  );
}

function Threshold({
  color,
  label,
  value,
  note,
}: {
  color: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 label-mono">
        <span className="inline-block size-2 rounded-[4px]" style={{ background: color }} />
        {label}
      </div>
      <div className="text-foreground font-semibold mt-0.5">{value}</div>
      <div className="text-muted-foreground text-[10px]">{note}</div>
    </div>
  );
}
