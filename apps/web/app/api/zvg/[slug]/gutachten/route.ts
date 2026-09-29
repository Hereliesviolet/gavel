import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { streamZvgDocument } from "@/lib/zvg-document-stream";
import { isUsableZvgSlug, zvgBundeslandFromRequest } from "@/lib/zvg-documents";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

const DOC_READ_RATE = { max: 30, windowSeconds: 60, failClosed: true };

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }
  const rateKey = `zvg-doc:${session.user.id}`;
  if (await isRateLimited(rateKey, DOC_READ_RATE)) {
    return NextResponse.json({ error: "Zu viele Dokument-Anfragen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, DOC_READ_RATE);
  const { slug } = await params;
  if (!isUsableZvgSlug(slug)) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  return streamZvgDocument(
    slug,
    "gutachten",
    zvgBundeslandFromRequest(req.nextUrl.searchParams.get("bundesland")),
  );
}
