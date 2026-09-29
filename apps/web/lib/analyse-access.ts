import { db } from "@/lib/db";
import {
  customUrlRequests,
  realEstateImages,
  realEstateListings,
  userFavorites,
  zvgListings,
} from "@/drizzle/schema";
import { and, asc, eq, inArray, isNotNull, min, ne, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  analyseJobLooksPrivate,
  analyseJobTargetsListing,
  analyseListingUrlCandidates,
} from "@/lib/analyse-jobs";
import { listingSourceUrlKey, listingSourceUrlLikePatterns } from "@/lib/safe-url";
import {
  canReadCustomListing,
  isManualUploadSourceUrl,
  isPrivateCustomListing,
  MANUAL_UPLOAD_HOST,
} from "@/lib/listing-privacy";
import { nextListingOwnerId, shouldHardDeleteCustomListing } from "@/lib/listing-delete";
import { isListingOwnedStoragePath } from "@/lib/object-stream";

type ListingAccessDb = Pick<typeof db, "query" | "select">;

/**
 * Lesender Zugriff: Einreicher immer; sonst öffentlicher Live-Scrape plus
 * erfolgreicher custom_url_requests-Eintrag oder eigener Favorit.
 * Cookie-/HTML-/PDF-Listings bleiben trotz URL-Dedupe beim Einreicher.
 */
export async function findAccessibleRealEstateListing(
  userId: string,
  listingId: string,
  executor: ListingAccessDb = db,
) {
  const listing = await executor.query.realEstateListings.findFirst({
    where: eq(realEstateListings.id, listingId),
  });
  if (!listing || !canReadCustomListing(listing, userId)) return null;
  if (listing.submittedByUserId === userId) return listing;

  const [viaRequest] = await executor
    .select({ id: customUrlRequests.id })
    .from(customUrlRequests)
    .where(
      and(
        eq(customUrlRequests.userId, userId),
        eq(customUrlRequests.listingId, listingId),
        eq(customUrlRequests.status, "success"),
      ),
    )
    .limit(1);
  if (viaRequest) return listing;

  const [favorite] = await executor
    .select({ listingId: userFavorites.listingId })
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.userId, userId),
        eq(userFavorites.listingType, "real_estate"),
        eq(userFavorites.listingId, listingId),
      ),
    )
    .limit(1);
  return favorite ? listing : null;
}

export async function visibleAnalyseListingIds(
  userId: string,
  listingIds: Array<string | null | undefined>,
  executor: ListingAccessDb = db,
): Promise<Set<string>> {
  const unique = [...new Set(listingIds.filter((id): id is string => Boolean(id)))];
  const visible = new Set<string>();
  await Promise.all(
    unique.map(async (id) => {
      const listing = await findAccessibleRealEstateListing(userId, id, executor);
      if (listing) visible.add(id);
    }),
  );
  return visible;
}

export function retainReachableFavorites<T extends { listingId: string; listingType: string }>(
  favorites: T[],
  existingZvgIds: Iterable<string>,
  allowedRealEstateIds: Iterable<string>,
): T[] {
  const zvg = new Set(existingZvgIds);
  const realEstate = new Set(allowedRealEstateIds);
  return favorites.filter((favorite) => {
    if (favorite.listingType === "zvg") return zvg.has(favorite.listingId);
    if (favorite.listingType === "real_estate") return realEstate.has(favorite.listingId);
    return false;
  });
}

export async function filterAccessibleFavorites<
  T extends { listingId: string; listingType: string },
>(userId: string, favorites: T[]): Promise<T[]> {
  const realEstateIds = [
    ...new Set(
      favorites
        .filter((favorite) => favorite.listingType === "real_estate")
        .map((favorite) => favorite.listingId),
    ),
  ];
  const zvgIds = [
    ...new Set(
      favorites
        .filter((favorite) => favorite.listingType === "zvg")
        .map((favorite) => favorite.listingId),
    ),
  ];

  const existingZvg = new Set<string>();
  if (zvgIds.length > 0) {
    const rows = await db
      .select({ id: zvgListings.id })
      .from(zvgListings)
      .where(inArray(zvgListings.id, zvgIds));
    for (const row of rows) existingZvg.add(row.id);
  }

  const allowed = new Set<string>();
  if (realEstateIds.length > 0) {
    const listings = await db.query.realEstateListings.findMany({
      where: inArray(realEstateListings.id, realEstateIds),
    });
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    for (const listingId of realEstateIds) {
      const listing = byId.get(listingId);
      if (listing && canReadCustomListing(listing, userId)) {
        allowed.add(listingId);
      }
    }
  }

  return retainReachableFavorites(favorites, existingZvg, allowed);
}

export function manualAnalyseReferenceUrl(kind: "html" | "pdf", content: string): string {
  const digest = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 32);
  return `https://${MANUAL_UPLOAD_HOST}/${kind}/${digest}`;
}

export function resolveAnalyseTargetUrl(input: {
  hasHtml?: boolean;
  hasPdf?: boolean;
  referenceUrl?: string | null;
  html?: string | null;
  pdfBase64?: string | null;
}): string | null {
  if (input.referenceUrl) return input.referenceUrl;
  if (input.hasHtml && input.html) return manualAnalyseReferenceUrl("html", input.html);
  if (input.hasPdf && input.pdfBase64) return manualAnalyseReferenceUrl("pdf", input.pdfBase64);
  return null;
}

export async function findExistingAnalyseTargetListing(
  userId: string,
  sourceUrl: string,
  privateFetch: boolean,
  executor: ListingAccessDb = db,
): Promise<string | null> {
  const candidates = analyseListingUrlCandidates(sourceUrl);
  const likePatterns = listingSourceUrlLikePatterns(sourceUrl);
  if (candidates.length === 0 && likePatterns.length === 0) return null;
  const identity = listingSourceUrlKey(sourceUrl);
  const rows = await executor.query.realEstateListings.findMany({
    where: or(
      candidates.length > 0 ? inArray(realEstateListings.sourceUrl, candidates) : sql`false`,
      ...likePatterns.map(
        (pattern) => sql`${realEstateListings.sourceUrl} LIKE ${pattern} ESCAPE '\\'`,
      ),
    ),
    orderBy: [asc(realEstateListings.firstSeenAt), asc(realEstateListings.id)],
    limit: 20,
  });
  const match = rows.find((listing) => {
    const url = listing.sourceUrl ?? "";
    if (listingSourceUrlKey(url) !== identity && !candidates.includes(url)) {
      return false;
    }
    const isPrivate = isPrivateCustomListing(listing.rawData, listing.sourceUrl);
    if (privateFetch) {
      return isPrivate && listing.submittedByUserId === userId;
    }
    return !isPrivate;
  });
  return match?.id ?? null;
}

function inflightUrlCandidates(sourceUrl: string | null | undefined, isPrivate: boolean): string[] {
  const urls = new Set(analyseListingUrlCandidates(sourceUrl ?? ""));
  if (isPrivate && isManualUploadSourceUrl(sourceUrl)) {
    urls.add(`https://${MANUAL_UPLOAD_HOST}/html/pending`);
    urls.add(`https://${MANUAL_UPLOAD_HOST}/pdf/pending`);
  }
  return [...urls].filter(Boolean);
}

/** Schreibender/destruktiver Zugriff: nur der Einreicher. */
export async function findOwnedRealEstateListing(
  userId: string,
  listingId: string,
  executor: ListingAccessDb = db,
) {
  return executor.query.realEstateListings.findFirst({
    where: and(
      eq(realEstateListings.id, listingId),
      eq(realEstateListings.submittedByUserId, userId),
    ),
  });
}

export type RemoveCustomListingResult =
  { outcome: "deleted"; storagePaths: string[] } | { outcome: "unlinked" } | { outcome: "busy" };

/**
 * Entfernt die Analyse aus dem Verlauf des Nutzers.
 * Geteilte öffentliche Live-Scrapes werden nicht gelöscht, solange
 * andere erfolgreiche Requests existieren — nur der eigene Verlauf
 * und Favorit gehen. Private Cookie-/HTML-/PDF-Zeilen löscht nur der Einreicher.
 */
export async function removeUserCustomListingAccess(
  userId: string,
  listingId: string,
): Promise<RemoveCustomListingResult | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`listing-delete:${listingId}`}))`);

    const listing = await tx.query.realEstateListings.findFirst({
      where: eq(realEstateListings.id, listingId),
    });
    if (!listing) return null;

    const isOwner = listing.submittedByUserId === userId;
    const isPrivate = isPrivateCustomListing(listing.rawData, listing.sourceUrl);
    if (isPrivate && !isOwner) return null;

    const [ownSuccess] = await tx
      .select({ id: customUrlRequests.id })
      .from(customUrlRequests)
      .where(
        and(
          eq(customUrlRequests.userId, userId),
          eq(customUrlRequests.listingId, listingId),
          eq(customUrlRequests.status, "success"),
        ),
      )
      .limit(1);

    if (!isOwner && !ownSuccess) return null;

    const others = await tx
      .select({
        userId: customUrlRequests.userId,
        requestedAt: min(customUrlRequests.requestedAt),
      })
      .from(customUrlRequests)
      .where(
        and(
          eq(customUrlRequests.listingId, listingId),
          eq(customUrlRequests.status, "success"),
          ne(customUrlRequests.userId, userId),
          isNotNull(customUrlRequests.userId),
        ),
      )
      .groupBy(customUrlRequests.userId);
    const otherSuccessfulUserIds = others
      .map((row) => row.userId)
      .filter((id): id is string => Boolean(id));
    const otherSuccessfulOwners = others
      .filter((row): row is { userId: string; requestedAt: Date | null } => Boolean(row.userId))
      .map((row) => ({ userId: row.userId, requestedAt: row.requestedAt }));

    const hardDelete = shouldHardDeleteCustomListing({
      isOwner,
      isPrivate,
      otherSuccessfulUserIds,
    });
    const urlCandidates = inflightUrlCandidates(listing.sourceUrl, isPrivate);
    const sourcePath = (listing.sourceUrl ?? "").split("?")[0];
    const inflightRows = await tx
      .select({
        id: customUrlRequests.id,
        userId: customUrlRequests.userId,
        listingId: customUrlRequests.listingId,
        url: customUrlRequests.url,
        stepDetail: customUrlRequests.stepDetail,
        stepLog: customUrlRequests.stepLog,
      })
      .from(customUrlRequests)
      .where(
        and(
          inArray(customUrlRequests.status, ["queued", "running"]),
          or(
            eq(customUrlRequests.listingId, listingId),
            eq(customUrlRequests.userId, userId),
            hardDelete && !isPrivate && sourcePath
              ? or(
                  urlCandidates.length > 0
                    ? inArray(customUrlRequests.url, urlCandidates)
                    : sql`false`,
                  sql`${customUrlRequests.url} LIKE ${`${sourcePath}?%`}`,
                )
              : sql`false`,
          ),
        ),
      );
    const inflight = inflightRows.find((job) => {
      const targets = analyseJobTargetsListing({
        jobListingId: job.listingId,
        jobUrl: job.url,
        jobLooksPrivate: analyseJobLooksPrivate({
          url: job.url,
          stepDetail: job.stepDetail,
          stepLog: job.stepLog as Array<{ msg?: string } | string> | null,
        }),
        listingId,
        listingSourceUrl: listing.sourceUrl,
        listingIsPrivate: isPrivate,
      });
      if (!targets) return false;
      if (hardDelete) return true;
      return job.userId === userId;
    });
    if (inflight) return { outcome: "busy" };

    if (hardDelete) {
      const images = await tx.query.realEstateImages.findMany({
        where: eq(realEstateImages.listingId, listingId),
        columns: { storagePath: true },
      });
      await tx
        .delete(userFavorites)
        .where(
          and(eq(userFavorites.listingType, "real_estate"), eq(userFavorites.listingId, listingId)),
        );
      await tx.delete(realEstateListings).where(eq(realEstateListings.id, listingId));
      return {
        outcome: "deleted",
        storagePaths: images
          .map((image) => image.storagePath)
          .filter((path): path is string => isListingOwnedStoragePath(listingId, path)),
      };
    }

    await tx
      .update(customUrlRequests)
      .set({ listingId: null })
      .where(and(eq(customUrlRequests.listingId, listingId), eq(customUrlRequests.userId, userId)));
    await tx
      .delete(userFavorites)
      .where(
        and(
          eq(userFavorites.userId, userId),
          eq(userFavorites.listingType, "real_estate"),
          eq(userFavorites.listingId, listingId),
        ),
      );

    if (isOwner) {
      const nextOwner = nextListingOwnerId(otherSuccessfulOwners);
      if (nextOwner) {
        await tx
          .update(realEstateListings)
          .set({ submittedByUserId: nextOwner })
          .where(eq(realEstateListings.id, listingId));
      }
    }

    return { outcome: "unlinked" };
  });
}
