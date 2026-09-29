import { cn } from "@/lib/utils";

/**
 * Minimal inline-SVG sparkline. Server-rendered, no JS.
 * Aspect ratio set by SVG; size via className width/height.
 */
export function Sparkline({
  values,
  color = "var(--color-neon-glow)",
  className,
  strokeWidth = 1.2,
  fill = false,
}: {
  values: number[];
  color?: string;
  className?: string;
  strokeWidth?: number;
  fill?: boolean;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const w = 100;
  const h = 24;
  const stepX = w / (values.length - 1);

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const areaPoints = fill ? `0,${h} ${points} ${w},${h}` : null;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("block", className)}
      aria-hidden
    >
      {areaPoints && <polygon points={areaPoints} fill={color} fillOpacity={0.18} />}
      <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}
