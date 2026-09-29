import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { zvgListings, realEstateListings } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
import type { Metadata } from "next";
import { filterAccessibleFavorites } from "@/lib/analyse-access";
import { customListingCoverSrc } from "@/lib/analyse-images";
import { listExistingUserFavorites } from "@/lib/favorite-write";
import { canReadCustomListing } from "@/lib/listing-privacy";
import { LISTING_COVER_IMAGE_SQL } from "@/lib/listing-cover";
import { listingKategorieFuerPeer } from "@/lib/listing-kategorie";
import { zvgListingPath } from "@/lib/zvg-documents";
import { FavoritenClient, type FavoriteEntry } from "./client";

export const metadata: Metadata = { title: "Favoriten – Gavel" };

export default async function FavoritenPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/favoriten");

  const userId = session.user.id;
  const favRows = await listExistingUserFavorites(userId);

  const visibleFavs = await filterAccessibleFavorites(userId, favRows);

  const zvgIds = visibleFavs.filter((f) => f.listingType === "zvg").map((f) => f.listingId);
  const reIds = visibleFavs.filter((f) => f.listingType === "real_estate").map((f) => f.listingId);

  const [zvgRows, reRows] = await Promise.all([
    zvgIds.length
      ? db
          .select({
            id: zvgListings.id,
            slug: zvgListings.slug,
            bundesland: zvgListings.bundesland,
            typ: zvgListings.typ,
            kategorie: zvgListings.kategorie,
            adresse: zvgListings.adresse,
            ort: zvgListings.ort,
            verkehrswert: zvgListings.verkehrswert,
            wohnflaecheM2: zvgListings.wohnflaecheM2,
            nutzflaecheM2: zvgListings.nutzflaecheM2,
            zimmer: zvgListings.zimmer,
            baujahr: zvgListings.baujahr,
            terminDate: zvgListings.terminDate,
            amtsgericht: zvgListings.amtsgericht,
            istAktiv: zvgListings.istAktiv,
            istNeu: zvgListings.istNeu,
            denkmalschutz: zvgListings.denkmalschutz,
            vermietet: zvgListings.vermietet,
            lat: zvgListings.lat,
            lng: zvgListings.lng,
            coverImageUrl: LISTING_COVER_IMAGE_SQL,
          })
          .from(zvgListings)
          .where(inArray(zvgListings.id, zvgIds))
      : Promise.resolve([]),
    reIds.length
      ? db
          .select({
            id: realEstateListings.id,
            typ: realEstateListings.typ,
            adresse: realEstateListings.adresse,
            ort: realEstateListings.ort,
            preis: realEstateListings.preis,
            angebotstyp: realEstateListings.angebotstyp,
            wohnflaecheM2: realEstateListings.wohnflaecheM2,
            zimmer: realEstateListings.zimmer,
            baujahr: realEstateListings.baujahr,
            coverImageUrl: realEstateListings.coverImageUrl,
            denkmalschutz: realEstateListings.denkmalschutz,
            vermietet: realEstateListings.vermietet,
            lat: realEstateListings.lat,
            lng: realEstateListings.lng,
            sourceUrl: realEstateListings.sourceUrl,
            submittedByUserId: realEstateListings.submittedByUserId,
            rawData: realEstateListings.rawData,
            istAktiv: realEstateListings.istAktiv,
          })
          .from(realEstateListings)
          .where(inArray(realEstateListings.id, reIds))
      : Promise.resolve([]),
  ]);

  const zvgById = new Map(zvgRows.map((r) => [r.id, r]));
  const reById = new Map(reRows.map((r) => [r.id, r]));

  const initialFavorites = visibleFavs.flatMap((fav): FavoriteEntry[] => {
    if (fav.listingType === "zvg") {
      const r = zvgById.get(fav.listingId);
      if (!r) return [];
      return [
        {
          kind: "zvg",
          href: zvgListingPath(r.bundesland, r.slug) ?? "/",
          sourceBadge: "ZVG",
          addedAt: fav.createdAt ?? new Date(),
          listing: {
            id: r.id,
            slug: r.slug,
            bundesland: r.bundesland,
            typ: r.typ,
            kategorie: listingKategorieFuerPeer(r.kategorie, r.typ),
            adresse: r.adresse,
            ort: r.ort,
            verkehrswert: r.verkehrswert ? Number(r.verkehrswert) : null,
            wohnflaecheM2: r.wohnflaecheM2 != null ? String(r.wohnflaecheM2) : null,
            nutzflaecheM2: r.nutzflaecheM2 != null ? String(r.nutzflaecheM2) : null,
            zimmer: r.zimmer != null ? String(r.zimmer) : null,
            baujahr: r.baujahr,
            terminDate: r.terminDate,
            amtsgericht: r.amtsgericht,
            istNeu: r.istNeu,
            denkmalschutz: r.denkmalschutz,
            vermietet: r.vermietet,
            lat: r.lat,
            lng: r.lng,
            coverImageUrl: r.coverImageUrl ?? null,
            offline: r.istAktiv === false,
          },
        },
      ];
    }

    if (fav.listingType !== "real_estate") return [];
    const r = reById.get(fav.listingId);
    if (!r || !canReadCustomListing(r, userId)) return [];
    return [
      {
        kind: "real_estate",
        href: `/analyse/${r.id}`,
        sourceBadge: r.angebotstyp === "miete" ? "Miete" : "Markt",
        angebotstyp: r.angebotstyp,
        addedAt: fav.createdAt ?? new Date(),
        listing: {
          id: r.id,
          slug: r.id,
          bundesland: "analyse",
          typ: r.typ,
          kategorie: listingKategorieFuerPeer(null, r.typ),
          adresse: r.adresse,
          ort: r.ort,
          verkehrswert: r.preis,
          preisIstMonatlich: r.angebotstyp === "miete",
          wohnflaecheM2: r.wohnflaecheM2 != null ? String(r.wohnflaecheM2) : null,
          zimmer: r.zimmer != null ? String(r.zimmer) : null,
          baujahr: r.baujahr,
          terminDate: null,
          amtsgericht: null,
          istNeu: false,
          denkmalschutz: r.denkmalschutz,
          vermietet: r.vermietet,
          lat: r.lat,
          lng: r.lng,
          coverImageUrl: customListingCoverSrc(r.id),
          offline: r.istAktiv === false,
        },
      },
    ];
  });

  return <FavoritenClient initialFavorites={initialFavorites} />;
}
