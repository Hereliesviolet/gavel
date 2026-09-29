import {
  publicListingImageUrl,
  isSafePublicHttpsUrl,
  stripSensitiveUrlQuery,
} from "@/lib/safe-url";
import { isPublicZvgSourceUrl, publicZvgDocumentHref } from "@/lib/zvg-documents";

type ListingInternals = {
  rawData?: unknown;
  dataQualityFlags?: unknown;
  needsReview?: unknown;
  dataQualityCheckedAt?: unknown;
  scrapeCompletedAt?: unknown;
  scrapedAt?: unknown;
  submittedByUserId?: unknown;
  externalId?: unknown;
  coverImageUrl?: string | null;
  gutachtenUrl?: string | null;
  exposeUrl?: string | null;
  slug?: string | null;
  bundesland?: string | null;
  sourceUrl?: string | null;
  direktlink?: string | null;
};

type OmittedInternal = keyof Pick<
  ListingInternals,
  | "rawData"
  | "dataQualityFlags"
  | "needsReview"
  | "dataQualityCheckedAt"
  | "scrapeCompletedAt"
  | "scrapedAt"
  | "submittedByUserId"
  | "externalId"
>;

export function omitListingInternals<T extends ListingInternals>(
  listing: T,
): Omit<T, OmittedInternal> {
  const {
    rawData: _raw,
    dataQualityFlags: _flags,
    needsReview: _review,
    dataQualityCheckedAt: _checked,
    scrapeCompletedAt: _done,
    scrapedAt: _scraped,
    submittedByUserId: _submitter,
    externalId: _external,
    ...rest
  } = listing;

  const publicListing = { ...rest } as Omit<T, OmittedInternal> & {
    coverImageUrl?: string | null;
    gutachtenUrl?: string | null;
    exposeUrl?: string | null;
    slug?: string | null;
    bundesland?: string | null;
    sourceUrl?: string | null;
    direktlink?: string | null;
  };

  if (typeof publicListing.sourceUrl === "string") {
    const cleaned = stripSensitiveUrlQuery(publicListing.sourceUrl);
    publicListing.sourceUrl = isSafePublicHttpsUrl(cleaned) ? cleaned : null;
  }
  if (typeof publicListing.direktlink === "string") {
    const cleaned = stripSensitiveUrlQuery(publicListing.direktlink);
    publicListing.direktlink = isPublicZvgSourceUrl(cleaned) ? cleaned : null;
  }

  if (typeof publicListing.coverImageUrl === "string" || publicListing.coverImageUrl === null) {
    publicListing.coverImageUrl = publicListingImageUrl(publicListing.coverImageUrl);
  }

  const slug = typeof publicListing.slug === "string" ? publicListing.slug : "";
  if (publicListing.gutachtenUrl) {
    publicListing.gutachtenUrl = publicZvgDocumentHref(
      publicListing.gutachtenUrl,
      slug,
      "gutachten",
      publicListing.bundesland,
    );
  }
  if (publicListing.exposeUrl) {
    publicListing.exposeUrl = publicZvgDocumentHref(
      publicListing.exposeUrl,
      slug,
      "expose",
      publicListing.bundesland,
    );
  }

  return publicListing;
}

type KiRow = {
  modelUsed?: unknown;
  tokensUsed?: unknown;
  fullRequestedBy?: unknown;
};

export function omitKiInternals<T extends KiRow>(
  ki: T,
): Omit<T, "modelUsed" | "tokensUsed" | "fullRequestedBy"> {
  const { modelUsed: _model, tokensUsed: _tokens, fullRequestedBy: _by, ...rest } = ki;
  return rest;
}

const PURCHASE_UNDERWRITING_KEYS = [
  "renditeGeschaetztPct",
  "investmentScore",
  "investmentScoreBegruendung",
  "risikenInvestor",
  "cashflowEinschaetzung",
  "fixFlipMassnahmen",
  "fixFlipWerteinschaetzung",
  "fixFlipGesamtkostenMinEur",
  "fixFlipGesamtkostenMaxEur",
  "jahresrohertrag",
  "liegenschaftszinssatz",
  "ertragswert",
  "arvMinEur",
  "arvMaxEur",
  "arvBegruendung",
  "arvKonfidenz",
  "holdingMonate",
] as const;

type PurchaseUnderwritingKey = (typeof PURCHASE_UNDERWRITING_KEYS)[number];

export function omitPurchaseUnderwriting<T extends object>(
  ki: T,
  angebotstyp: string | null | undefined,
): T {
  if (angebotstyp === "kauf") return ki;
  const next = { ...ki } as T & Record<PurchaseUnderwritingKey, unknown>;
  for (const key of PURCHASE_UNDERWRITING_KEYS) {
    next[key] = key === "risikenInvestor" || key === "fixFlipMassnahmen" ? [] : null;
  }
  return next;
}

type ZvgImageRow = {
  id: string;
  publicUrl?: string | null;
  position?: number | null;
  isCover?: boolean | null;
  width?: number | null;
  height?: number | null;
};

export function omitZvgImageInternals<T extends ZvgImageRow>(image: T) {
  return {
    id: image.id,
    publicUrl: publicListingImageUrl(image.publicUrl),
    position: image.position ?? null,
    isCover: image.isCover ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
  };
}
