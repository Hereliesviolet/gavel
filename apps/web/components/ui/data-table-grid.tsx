import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Carbon-style dense table built on CSS-grid (NOT <table>),
 * so cells can hold badges / sparklines / kategorie stripes.
 *
 * Usage:
 *   <DataTableGrid columns="80px 110px 1fr 90px 130px 24px">
 *     <DataTableGrid.Head>...</DataTableGrid.Head>
 *     <DataTableGrid.Row href={...}>...</DataTableGrid.Row>
 *   </DataTableGrid>
 */
export function DataTableGrid({
  columns,
  className,
  children,
}: {
  columns: string;
  className?: string;
  children: ReactNode;
}) {
  const style = { ["--cols" as string]: columns } as CSSProperties;
  return (
    <div
      className={cn(
        "border border-border rounded-[4px] overflow-x-auto overscroll-x-contain",
        className,
      )}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {/* min-w-max verhindert, dass die feste --cols-Spaltenbreite auf schmalen
          Viewports gequetscht wird - stattdessen scrollt der äußere Wrapper
          horizontal, statt Spalten abzuschneiden oder Body-Overflow auszulösen. */}
      <div className="min-w-max" style={style}>
        {children}
      </div>
    </div>
  );
}

function Head({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid gap-x-3 bg-[var(--surface-toolbar)] border-b border-border px-3 py-1.5 label-mono [grid-template-columns:var(--cols)] items-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Row({
  children,
  href,
  className,
  highlight = false,
}: {
  children: ReactNode;
  href?: string;
  className?: string;
  highlight?: boolean;
}) {
  const inner = (
    <div
      className={cn(
        "grid gap-x-3 px-3 py-2 text-sm border-b border-border/50 last:border-b-0 items-center transition-colors [grid-template-columns:var(--cols)]",
        href && "hover:bg-muted/40 cursor-pointer",
        highlight && "bg-muted/30",
        className,
      )}
    >
      {children}
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block">
        {inner}
      </a>
    );
  }
  return inner;
}

DataTableGrid.Head = Head;
DataTableGrid.Row = Row;
