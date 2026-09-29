import { cn } from "@/lib/utils";

export function SectionHeading({
  children,
  className,
  as: Tag = "h2",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <Tag className={cn("text-heading-sm font-medium tracking-tight text-foreground", className)}>
      {children}
    </Tag>
  );
}
