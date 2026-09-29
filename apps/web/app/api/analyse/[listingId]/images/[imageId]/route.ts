import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { streamAccessibleListingImage } from "@/lib/analyse-image-stream";
import { isValidUuid } from "@/lib/utils";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

const IMAGE_READ_RATE = { max: 60, windowSeconds: 60, failClosed: true };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ listingId: string; imageId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }
  const rateKey = `analyse-image:${session.user.id}`;
  if (await isRateLimited(rateKey, IMAGE_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Bild-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, IMAGE_READ_RATE);
  const { listingId, imageId } = await params;
  if (!isValidUuid(listingId) || !isValidUuid(imageId)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return streamAccessibleListingImage(session.user.id, listingId, imageId);
}
