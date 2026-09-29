import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { SectionHeader } from "@/components/ui/section-header";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import { TagBadge } from "@/components/ui/tag-badge";
import { FeatureListItem } from "@/components/ui/feature-list-item";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Design System · Gavel" };

export default async function DesignPage() {
  const { error } = await requireAdmin();
  if (error === "Nicht eingeloggt") redirect("/login?callbackUrl=/account/design");
  if (error) redirect("/");

  return (
    <PageShell className="space-y-10">
      <section>
        <SectionHeader label="Neon Design System" />
        <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
          Gavel nutzt ausschließlich das Neon-Dark-Theme (Blackout + Neon Glow). Kein Hell/Dunkel-
          oder Farbthemen-Wechsel.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-heading-sm">Typografie</h2>
        <p className="text-display max-w-3xl">Display Headline</p>
        <p className="text-heading-lg">Heading Large</p>
        <p className="font-mono text-sm text-muted-foreground">Geist Mono — Daten & Labels</p>
      </section>

      <section className="space-y-4">
        <h2 className="text-heading-sm">Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Primary Pill</Button>
          <Button variant="outline">Ghost Pill</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Warning</Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-heading-sm">Badges & Listen</h2>
        <div className="flex flex-wrap gap-2">
          <TagBadge>Neon Tag</TagBadge>
          <Badge variant="outline">Outline Badge</Badge>
        </div>
        <ul className="space-y-2">
          <FeatureListItem>Feature mit Neon-Dot</FeatureListItem>
          <FeatureListItem>Zweites Listenelement</FeatureListItem>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-heading-sm">Surfaces</h2>
        <Card>
          <CardHeader>
            <CardTitle>Graphite Deep Card</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            4px Radius, keine Box-Shadows, 24px Padding.
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
