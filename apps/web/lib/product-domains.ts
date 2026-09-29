/**
 * Produktgrenzen als Konstante statt als Tabellenzeile im Glossar.
 *
 * Vorher stand die Grenze nur in docs/METRICS_GLOSSARY.md und konnte
 * unbemerkt vom Code abweichen. Hier ist sie die Datenquelle für das
 * Domänen-Gating zur Laufzeit; der Konformitätstest in
 * __tests__/deps/docs-conformance.test.ts erzwingt, dass die Tabelle im
 * Glossar dieser Konstante entspricht.
 */

export interface ProductDomain {
  /** Bezeichnung im Glossar. */
  label: string;
  /** Tabellenpräfix der Domäne. */
  tablePrefix: string;
  /** Fließt in Investor-Ranking und Investor-Seiten ein. */
  investor: boolean;
  /** Kann Alerts auslösen. */
  alerts: boolean;
  /** Kann favorisiert werden. */
  favorites: boolean;
}

export const PRODUCT_DOMAINS = {
  zvg: {
    label: "ZVG",
    tablePrefix: "zvg_*",
    investor: true,
    alerts: true,
    favorites: true,
  },
  real_estate: {
    label: "Custom (Markt-Exposé)",
    tablePrefix: "real_estate_*",
    // Investment-Sektionen liegen auf /analyse. /investor bleibt ZVG-only:
    // Angebot vs. gerichtlicher Verkehrswert ist keine gemeinsame Rangfolge.
    investor: false,
    alerts: false,
    favorites: true,
  },
} as const satisfies Record<string, ProductDomain>;

export type ListingDomain = keyof typeof PRODUCT_DOMAINS;

export const LISTING_DOMAINS = Object.keys(PRODUCT_DOMAINS) as ListingDomain[];

export const MAX_FAVORITES_PER_USER = 100;

export function isListingDomain(value: unknown): value is ListingDomain {
  return typeof value === "string" && value in PRODUCT_DOMAINS;
}

export function isFavoritableDomain(value: unknown): value is ListingDomain {
  return isListingDomain(value) && PRODUCT_DOMAINS[value].favorites;
}

export function isInvestorDomain(value: unknown): value is ListingDomain {
  return isListingDomain(value) && PRODUCT_DOMAINS[value].investor;
}

export function investorDomains(): ListingDomain[] {
  return LISTING_DOMAINS.filter((domain) => PRODUCT_DOMAINS[domain].investor);
}
