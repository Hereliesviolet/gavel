import { ilike, or } from "drizzle-orm";
import { zvgListings } from "@/drizzle/schema";
import { containsIlikePattern, prefixIlikePattern } from "@/lib/sql-like";

export function listingTextSearchSql(query: string) {
  const term = containsIlikePattern(query);
  const plzTerm = /^\d{2,5}$/.test(query) ? prefixIlikePattern(query) : term;
  return or(
    ilike(zvgListings.adresse, term),
    ilike(zvgListings.ort, term),
    ilike(zvgListings.amtsgericht, term),
    ilike(zvgListings.aktenzeichen, term),
    ilike(zvgListings.bundeslandName, term),
    ilike(zvgListings.plz, plzTerm),
  )!;
}
