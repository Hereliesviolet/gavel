import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { BUNDESLAENDER } from "@/lib/utils";
import { clipSearchQuery } from "@/lib/sql-like";
import { isUsableGeoPoint } from "@/lib/geocode";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

const GEO_RATE = { max: 30, windowSeconds: 60, failClosed: true };

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 });
  }

  const rateKey = `geo:${session.user.id}`;
  if (await isRateLimited(rateKey, GEO_RATE)) {
    return NextResponse.json({ error: "Zu viele Ortssuchen." }, { status: 429 });
  }
  await recordRateLimitHit(rateKey, GEO_RATE);

  const query = clipSearchQuery(req.nextUrl.searchParams.get("query")?.toLowerCase() ?? "");

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const bundeslandMatches = BUNDESLAENDER.filter(
    (bl) =>
      bl.name.toLowerCase().includes(query) ||
      bl.slug.includes(query) ||
      bl.kuerzel.toLowerCase() === query,
  ).map((bl) => ({
    label: bl.name,
    bundesland: bl.slug,
    lat: 51.165691,
    lng: 10.451526,
  }));

  try {
    const maptilerKey = process.env.MAPTILER_SERVER_KEY?.trim();
    if (!maptilerKey) {
      return NextResponse.json({ results: bundeslandMatches.slice(0, 8) });
    }

    const maptilerUrl =
      `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json` +
      `?key=${maptilerKey}&country=de&language=de&limit=5`;

    const res = await fetch(maptilerUrl, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ results: bundeslandMatches.slice(0, 8) });
    }

    const json: unknown = await res.json();
    const data =
      json &&
      typeof json === "object" &&
      "features" in json &&
      Array.isArray((json as { features: unknown }).features)
        ? (json as { features: unknown[] }).features
        : [];

    const geoResults = data.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as {
        context?: { id?: string; text?: string }[];
        center?: number[];
        place_name?: string;
        text?: string;
      };
      const context = Array.isArray(item.context) ? item.context : [];
      const stateEntry = context.find((c) => c.id?.startsWith("region"));
      const stateLabel = stateEntry?.text ?? "";
      const bl = BUNDESLAENDER.find(
        (b) =>
          stateLabel.toLowerCase().includes(b.name.toLowerCase()) ||
          b.name.toLowerCase().includes(stateLabel.toLowerCase()),
      );
      const center = item.center;
      if (!Array.isArray(center) || center.length < 2) {
        return [];
      }
      const [itemLng, itemLat] = center;
      if (!isUsableGeoPoint(itemLat, itemLng)) {
        return [];
      }
      const postcodeEntry = context.find((c) => c.id?.startsWith("postcode"));
      return [
        {
          label: item.place_name ?? item.text ?? "",
          bundesland: bl?.slug ?? "deutschland",
          lat: itemLat,
          lng: itemLng,
          plz: postcodeEntry?.text,
        },
      ];
    });

    const results = [...bundeslandMatches, ...geoResults].slice(0, 8);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[/api/geo/de/suche]", error);
    return NextResponse.json({ results: bundeslandMatches.slice(0, 8) });
  }
}
