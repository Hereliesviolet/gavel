import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TrustRow({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode; href?: string }>;
  className?: string;
}) {
  const visible = items.filter((item) => item.value != null && item.value !== "");
  if (visible.length === 0) return null;

  return (
    <p
      className={cn(
        "font-mono text-[11px] text-muted-foreground flex flex-wrap items-baseline gap-x-4 gap-y-1",
        className,
      )}
    >
      {visible.map((item) => (
        <span key={item.label}>
          <span className="uppercase tracking-[0.08em]">{item.label}</span>
          {" · "}
          {item.href ? (
            <a
              href={item.href}
              {...(item.href.startsWith("http")
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="text-foreground hover:underline"
            >
              {item.value}
            </a>
          ) : (
            <span className="text-foreground">{item.value}</span>
          )}
        </span>
      ))}
    </p>
  );
}
