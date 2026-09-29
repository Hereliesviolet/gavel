import { notFound } from "next/navigation";
import { getListingBySlug } from "./get-listing";

/**
 * Die Existenzprüfung gehört hierher und nicht nur in die Seite: loading.tsx
 * spannt eine Suspense-Grenze um die Seite, wodurch der Rumpf mit Status 200
 * rausgeht, bevor die Seitenfunktion läuft - ein notFound() dort käme für den
 * HTTP-Status zu spät. Das Layout rendert außerhalb dieser Grenze, sodass die
 * Ladeanzeige erhalten bleibt und unbekannte Slugs trotzdem 404 liefern.
 */
export default async function ListingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ bundesland: string; slug: string }>;
}) {
  const { bundesland, slug } = await params;
  if (!(await getListingBySlug(bundesland, slug))) notFound();

  return children;
}
