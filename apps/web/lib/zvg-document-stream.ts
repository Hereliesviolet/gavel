import { NextResponse } from "next/server";
import { minioClient, MINIO_BUCKET } from "@/lib/minio";
import { isObjectTooLarge, MAX_ZVG_PDF_BYTES, readBoundedStream } from "@/lib/object-stream";
import { isSafePublicHttpsUrl } from "@/lib/safe-url";
import { findZvgListingBySlug } from "@/lib/zvg-listing-lookup";
import {
  candidateZvgDocumentKeys,
  extractStoredZvgDocumentKey,
  isAllowedExternalZvgDocumentUrl,
  isGavelStorageUrl,
  zvgPdfDownloadName,
  type ZvgDocumentKind,
} from "@/lib/zvg-documents";

async function streamPdf(storagePath: string, filename: string) {
  const stream = await minioClient.getObject(MINIO_BUCKET, storagePath);
  const body = await readBoundedStream(stream, MAX_ZVG_PDF_BYTES);
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function streamZvgDocument(
  slug: string,
  kind: ZvgDocumentKind,
  bundesland?: string | null,
) {
  const listing = await findZvgListingBySlug(slug, bundesland);
  if (!listing) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const url = kind === "gutachten" ? listing.gutachtenUrl : listing.exposeUrl;
  const keys = [
    url && isGavelStorageUrl(url) ? extractStoredZvgDocumentKey(url, listing, kind) : null,
    ...candidateZvgDocumentKeys(listing, kind),
  ].filter((key, index, all): key is string => Boolean(key) && all.indexOf(key) === index);

  for (const key of keys) {
    try {
      return await streamPdf(key, zvgPdfDownloadName(kind, listing.slug));
    } catch (error) {
      if (isObjectTooLarge(error)) {
        return NextResponse.json({ error: "Datei zu groß" }, { status: 413 });
      }
    }
  }

  if (url && isSafePublicHttpsUrl(url) && isAllowedExternalZvgDocumentUrl(url)) {
    return NextResponse.redirect(url, 302);
  }
  return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
}
