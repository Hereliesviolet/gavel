import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { realEstateImages } from "@/drizzle/schema";
import { findAccessibleRealEstateListing } from "@/lib/analyse-access";
import { minioClient, MINIO_BUCKET } from "@/lib/minio";
import {
  isListingOwnedStoragePath,
  isObjectTooLarge,
  MAX_ANALYSE_IMAGE_BYTES,
  readBoundedStream,
} from "@/lib/object-stream";

async function streamObject(storagePath: string) {
  const stream = await minioClient.getObject(MINIO_BUCKET, storagePath);
  const body = await readBoundedStream(stream, MAX_ANALYSE_IMAGE_BYTES);
  const ext = storagePath.split(".").pop()?.toLowerCase();
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function streamAccessibleListingImage(
  userId: string,
  listingId: string,
  imageId: string,
) {
  const listing = await findAccessibleRealEstateListing(userId, listingId);
  if (!listing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const image = await db.query.realEstateImages.findFirst({
    where: and(eq(realEstateImages.id, imageId), eq(realEstateImages.listingId, listingId)),
  });
  if (!image || !isListingOwnedStoragePath(listingId, image.storagePath)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  try {
    return await streamObject(image.storagePath);
  } catch (error) {
    if (isObjectTooLarge(error)) {
      return NextResponse.json({ error: "Bild zu groß" }, { status: 413 });
    }
    console.error("[analyse-image]", error);
    return NextResponse.json({ error: "Bild nicht lesbar" }, { status: 404 });
  }
}

export async function streamAccessibleListingCover(userId: string, listingId: string) {
  const listing = await findAccessibleRealEstateListing(userId, listingId);
  if (!listing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const image = await db.query.realEstateImages.findFirst({
    where: eq(realEstateImages.listingId, listingId),
    orderBy: [asc(realEstateImages.position)],
  });
  const storagePath = image?.storagePath;
  if (!isListingOwnedStoragePath(listingId, storagePath)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  try {
    return await streamObject(storagePath);
  } catch (error) {
    if (isObjectTooLarge(error)) {
      return NextResponse.json({ error: "Bild zu groß" }, { status: 413 });
    }
    console.error("[analyse-cover]", error);
    return NextResponse.json({ error: "Bild nicht lesbar" }, { status: 404 });
  }
}
