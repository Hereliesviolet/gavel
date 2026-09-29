import { or, sql, type SQL } from "drizzle-orm";
import { zvgListings } from "@/drizzle/schema";
import { isListingKategorie } from "@/lib/kategorien";
import {
  GEWERBE_FIRST_TOKENS,
  GEWERBE_TOKENS,
  GRUNDSTUECK_TOKENS,
  HAUS_TOKENS,
  listingKategorieFuerPeer,
  WOHNUNG_TOKENS,
} from "@/lib/listing-kategorie";

export { inferListingKategorie } from "@/lib/listing-kategorie";

export function listingMatchesWantedTypes(
  listing: { kategorie?: string | null; typ?: string | null },
  wanted: readonly string[],
): boolean {
  const allowed = new Set(wanted.map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (allowed.size === 0) return true;
  const resolved = listingKategorieFuerPeer(listing.kategorie, listing.typ);
  return resolved != null && allowed.has(resolved);
}

function sqlStringLiteral(value: string): SQL {
  return sql.raw(`'${value.replaceAll("'", "''")}'`);
}

function typContainsAny(tokens: readonly string[]): SQL {
  return or(
    ...tokens.map(
      (token) =>
        sql`strpos(lower(coalesce(${zvgListings.typ}, '')), ${sqlStringLiteral(token)}) > 0`,
    ),
  )!;
}

/** Dieselbe Peer-Kategorie wie listingKategorieFuerPeer, für GROUP BY / Mediane. */
export function peerKategorieSql(): SQL<string | null> {
  return sql<string | null>`CASE
    WHEN lower(trim(coalesce(${zvgListings.kategorie}, ''))) IN ('wohnung', 'haus', 'grundstueck', 'gewerbe')
      THEN lower(trim(${zvgListings.kategorie}))
    WHEN ${typContainsAny(WOHNUNG_TOKENS)} THEN 'wohnung'
    WHEN ${typContainsAny(GEWERBE_FIRST_TOKENS)} THEN 'gewerbe'
    WHEN ${typContainsAny(HAUS_TOKENS)} THEN 'haus'
    WHEN ${typContainsAny(GRUNDSTUECK_TOKENS)} THEN 'grundstueck'
    WHEN ${typContainsAny(GEWERBE_TOKENS)} THEN 'gewerbe'
    ELSE NULL
  END`;
}

/** Dieselbe Marktkategorie wie listingKategorieFuerMarkt: nur Wohnung/Haus. */
export function marktKategorieSql(): SQL<string | null> {
  return sql<string | null>`CASE
    WHEN lower(trim(coalesce(${zvgListings.kategorie}, ''))) IN ('wohnung', 'haus')
      THEN lower(trim(${zvgListings.kategorie}))
    WHEN lower(trim(coalesce(${zvgListings.kategorie}, ''))) IN ('grundstueck', 'gewerbe')
      THEN NULL
    WHEN ${typContainsAny(WOHNUNG_TOKENS)} THEN 'wohnung'
    WHEN ${typContainsAny(GEWERBE_FIRST_TOKENS)} THEN NULL
    WHEN ${typContainsAny(HAUS_TOKENS)} THEN 'haus'
    ELSE NULL
  END`;
}

/** Dieselbe 5-stellige PLZ-Regel wie germanPostalCode / mikromarktAusPlz. */
export function mikromarktSql(): SQL<string | null> {
  return sql<string | null>`(
    CASE
      WHEN regexp_replace(trim(coalesce(${zvgListings.plz}, '')), '[^0-9]', '', 'g') ~ '^[0-9]{5}$'
      THEN left(regexp_replace(trim(coalesce(${zvgListings.plz}, '')), '[^0-9]', '', 'g'), 3)
      ELSE NULL
    END
  )`;
}

export function listingTypeColumnMatches(types: readonly string[]): SQL | undefined {
  const wanted = [
    ...new Set(types.map((value) => value.trim().toLowerCase()).filter(isListingKategorie)),
  ];
  if (wanted.length === 0) return undefined;
  const list = wanted.map((value) => `'${value}'`).join(", ");
  return sql`${peerKategorieSql()} IN (${sql.raw(list)})`;
}
