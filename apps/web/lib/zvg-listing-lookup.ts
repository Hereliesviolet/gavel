import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { zvgListings } from "@/drizzle/schema";
import { bundeslandColumnMatches } from "@/lib/bundesland";
import { isUsableZvgSlug, zvgBundeslandFromRequest } from "@/lib/zvg-documents";

const ZVG_LOOKUP_ORDER = [desc(zvgListings.istAktiv), desc(zvgListings.lastSeenAt)] as const;

export async function findZvgListingBySlug(slug: string, bundesland?: string | null) {
  if (!isUsableZvgSlug(slug)) return undefined;
  const scoped = zvgBundeslandFromRequest(bundesland);

  if (scoped) {
    return db.query.zvgListings.findFirst({
      where: and(
        bundeslandColumnMatches(zvgListings.bundesland, scoped),
        eq(zvgListings.slug, slug),
      ),
      orderBy: [...ZVG_LOOKUP_ORDER],
    });
  }

  const rows = await db.query.zvgListings.findMany({
    where: eq(zvgListings.slug, slug),
    orderBy: [...ZVG_LOOKUP_ORDER],
    limit: 2,
  });
  return rows.length === 1 ? rows[0] : undefined;
}
