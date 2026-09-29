import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userFavorites, zvgListings } from "@/drizzle/schema";
import { findAccessibleRealEstateListing } from "@/lib/analyse-access";
import { publicLiveScrapePredicate } from "@/lib/listing-privacy";
import {
  isFavoritableDomain,
  MAX_FAVORITES_PER_USER,
  type ListingDomain,
} from "@/lib/product-domains";

export type AddFavoriteResult = "created" | "exists" | "full" | "not_found" | "invalid";

function existingFavoriteCondition() {
  return or(
    and(
      eq(userFavorites.listingType, "zvg"),
      sql`EXISTS (SELECT 1 FROM zvg_listings z WHERE z.id = ${userFavorites.listingId})`,
    ),
    and(
      eq(userFavorites.listingType, "real_estate"),
      sql`EXISTS (SELECT 1 FROM real_estate_listings r WHERE r.id = ${userFavorites.listingId})`,
    ),
  );
}

function quotaFavoriteCondition() {
  return or(
    and(
      eq(userFavorites.listingType, "zvg"),
      sql`EXISTS (SELECT 1 FROM zvg_listings z WHERE z.id = ${userFavorites.listingId} AND z.ist_aktiv = TRUE)`,
    ),
    and(
      eq(userFavorites.listingType, "real_estate"),
      sql`EXISTS (SELECT 1 FROM real_estate_listings r WHERE r.id = ${userFavorites.listingId} AND r.ist_aktiv = TRUE AND (r.submitted_by_user_id = ${userFavorites.userId} OR (${sql.raw(publicLiveScrapePredicate("r"))})))`,
    ),
  );
}

export async function listExistingUserFavorites(
  userId: string,
  opts?: { limit?: number; listingType?: ListingDomain },
) {
  const query = db
    .select()
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.userId, userId),
        opts?.listingType ? eq(userFavorites.listingType, opts.listingType) : undefined,
        existingFavoriteCondition(),
      ),
    )
    .orderBy(desc(userFavorites.createdAt), desc(userFavorites.id));
  return opts?.limit != null ? query.limit(opts.limit) : query;
}

export async function favoritedListingIds(
  userId: string,
  listingIds: string[],
  listingType: ListingDomain = "zvg",
): Promise<Set<string>> {
  if (listingIds.length === 0) return new Set();
  const rows = await db
    .select({ listingId: userFavorites.listingId })
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.userId, userId),
        eq(userFavorites.listingType, listingType),
        inArray(userFavorites.listingId, listingIds),
      ),
    );
  return new Set(rows.map((row) => row.listingId));
}

export async function tryAddFavorite(
  userId: string,
  listingId: string,
  listingType: unknown,
): Promise<AddFavoriteResult> {
  if (!isFavoritableDomain(listingType)) return "invalid";
  const domain: ListingDomain = listingType;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`favorites:${userId}`}))`);

    if (domain === "real_estate") {
      const listing = await findAccessibleRealEstateListing(userId, listingId, tx);
      if (!listing) return "not_found";
    }

    if (domain === "zvg") {
      const listing = await tx.query.zvgListings.findFirst({
        where: and(eq(zvgListings.id, listingId), eq(zvgListings.istAktiv, true)),
        columns: { id: true },
      });
      if (!listing) return "not_found";
    }

    const already = await tx.query.userFavorites.findFirst({
      where: and(
        eq(userFavorites.userId, userId),
        eq(userFavorites.listingType, domain),
        eq(userFavorites.listingId, listingId),
      ),
      columns: { listingId: true },
    });
    if (already) return "exists";

    const [used] = await tx
      .select({ n: count() })
      .from(userFavorites)
      .where(and(eq(userFavorites.userId, userId), quotaFavoriteCondition()));
    if (Number(used?.n ?? 0) >= MAX_FAVORITES_PER_USER) return "full";

    const [inserted] = await tx
      .insert(userFavorites)
      .values({ userId, listingType: domain, listingId })
      .onConflictDoNothing()
      .returning({ listingId: userFavorites.listingId });
    return inserted ? "created" : "exists";
  });
}
