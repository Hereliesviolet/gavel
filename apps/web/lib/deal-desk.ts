import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { investorDealOutcomes } from "@/drizzle/schema/investor";
import { zvgListings } from "@/drizzle/schema";
import { listExistingUserFavorites } from "@/lib/favorite-write";
import { fetchPicksByListingIds } from "@/lib/investor-queries";
import type { InvestorPick } from "@/lib/investor-picks";
import type { InvestorProfile } from "@/lib/investor-profile";
import { DESK_STATUS, type DeskStatus } from "@/lib/deal-desk-status";
import { isUpcomingTermin } from "@/lib/utils";
import { zvgListingPath } from "@/lib/zvg-documents";

export interface DeskEintrag {
  listingId: string;
  status: DeskStatus;
  notizen: string | null;
  strategie: string | null;
  gebotEur: number | null;
  kaufpreisEur: number | null;
  sanierungEur: number | null;
  verkaufspreisEur: number | null;
  monatsmieteEur: number | null;
  haltedauerMonate: number | null;
  eingetragenAm: Date | null;
  /** Fehlt, wenn das Objekt keine KI-Analyse (mehr) hat. */
  pick: InvestorPick | null;
  /** Ohne Analyse bleibt wenigstens der Objekttitel bekannt. */
  titel: string;
  href: string | null;
  terminDate: Date | null;
  offline: boolean;
}

function toDeskStatus(wert: string): DeskStatus {
  return (DESK_STATUS as readonly string[]).includes(wert) ? (wert as DeskStatus) : "watching";
}

function zahl(wert: number | null): number | null {
  return wert == null ? null : wert;
}

/**
 * Der Desk speist sich aus zwei Quellen: Favoriten sind der leichte Einstieg
 * ("merk dir das"), ein Outcome-Eintrag entsteht, sobald der Nutzer den Status
 * bewegt. Beide zusammen ergeben die Arbeitsliste; der Status gewinnt.
 */
export async function fetchDeskEintraege(
  userId: string,
  profile?: Partial<InvestorProfile> | null,
): Promise<DeskEintrag[]> {
  const [outcomes, favoriten] = await Promise.all([
    db
      .select()
      .from(investorDealOutcomes)
      .where(
        and(
          eq(investorDealOutcomes.userId, userId),
          sql`EXISTS (SELECT 1 FROM zvg_listings z WHERE z.id = ${investorDealOutcomes.listingId})`,
        ),
      )
      .orderBy(desc(investorDealOutcomes.updatedAt), desc(investorDealOutcomes.id))
      .limit(200),
    listExistingUserFavorites(userId, { limit: 200, listingType: "zvg" }),
  ]);

  const outcomeNachListing = new Map(outcomes.map((o) => [o.listingId, o]));
  const listingIds = [
    ...new Set([...outcomes.map((o) => o.listingId), ...favoriten.map((f) => f.listingId)]),
  ];
  if (listingIds.length === 0) return [];

  const preferredStrategyByListingId = Object.fromEntries(
    outcomes.map((outcome) => [outcome.listingId, outcome.strategy]),
  );
  const [picks, stammdaten] = await Promise.all([
    fetchPicksByListingIds(listingIds, profile, preferredStrategyByListingId),
    db
      .select({
        id: zvgListings.id,
        slug: zvgListings.slug,
        bundesland: zvgListings.bundesland,
        typ: zvgListings.typ,
        ort: zvgListings.ort,
        terminDate: zvgListings.terminDate,
        istAktiv: zvgListings.istAktiv,
      })
      .from(zvgListings)
      .where(inArray(zvgListings.id, listingIds)),
  ]);
  const stammNachId = new Map(stammdaten.map((s) => [s.id, s]));

  const favoritZeit = new Map(favoriten.map((f) => [f.listingId, f.createdAt]));

  return listingIds
    .map((listingId): DeskEintrag | null => {
      const stamm = stammNachId.get(listingId);
      if (!stamm) return null;
      const outcome = outcomeNachListing.get(listingId);
      return {
        listingId,
        status: outcome ? toDeskStatus(outcome.status) : "watching",
        notizen: outcome?.notes ?? null,
        strategie: outcome?.strategy ?? null,
        gebotEur: zahl(outcome?.actualBidEur ?? null),
        kaufpreisEur: zahl(outcome?.actualPurchasePriceEur ?? null),
        sanierungEur: zahl(outcome?.actualRenovationEur ?? null),
        verkaufspreisEur: zahl(outcome?.actualSalePriceEur ?? null),
        monatsmieteEur: zahl(outcome?.actualMonthlyRentEur ?? null),
        haltedauerMonate: zahl(outcome?.actualHoldingMonths ?? null),
        eingetragenAm: outcome?.createdAt ?? favoritZeit.get(listingId) ?? null,
        pick: picks.get(listingId) ?? null,
        titel: [stamm.typ, stamm.ort].filter(Boolean).join(" · ") || "Objekt",
        href: zvgListingPath(stamm.bundesland, stamm.slug),
        terminDate: stamm.terminDate,
        offline: stamm.istAktiv === false,
      };
    })
    .filter((eintrag): eintrag is DeskEintrag => eintrag != null)
    .sort(compareDeskEintraege);
}

function deskTerminGruppe(eintrag: DeskEintrag): number {
  if (!eintrag.terminDate) return 2;
  return isUpcomingTermin(eintrag.terminDate) ? 0 : 1;
}

function compareDeskEintraege(a: DeskEintrag, b: DeskEintrag): number {
  const gruppe = deskTerminGruppe(a) - deskTerminGruppe(b);
  if (gruppe !== 0) return gruppe;
  const aTermin = a.terminDate?.getTime() ?? 0;
  const bTermin = b.terminDate?.getTime() ?? 0;
  if (aTermin !== bTermin) {
    return deskTerminGruppe(a) === 1 ? bTermin - aTermin : aTermin - bTermin;
  }
  return a.listingId.localeCompare(b.listingId);
}
