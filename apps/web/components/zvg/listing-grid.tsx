import { ListingCard, ZvgListingCardData } from "./listing-card";
import { Home } from "lucide-react";

interface ListingGridProps {
  listings: ZvgListingCardData[];
  favoritedIds?: string[];
}

export function ListingGrid({ listings, favoritedIds = [] }: ListingGridProps) {
  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Home size={48} className="text-gray-200 mb-4" />
        <p className="text-gray-500 font-medium">Keine Objekte gefunden</p>
        <p className="text-sm text-gray-400 mt-1">
          Passen Sie die Filter an oder wählen Sie ein anderes Bundesland.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
      {listings.map((listing) => (
        <ListingCard
          key={listing.id}
          listing={listing}
          isFavorited={favoritedIds.includes(listing.id)}
        />
      ))}
    </div>
  );
}
