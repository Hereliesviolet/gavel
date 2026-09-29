import { MapPin, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isUsableGeoPoint } from "@/lib/geo-point";

interface MapLinksProps {
  lat?: number | null;
  lng?: number | null;
  adresse?: string | null;
}

function buildGoogleMapsUrl({ lat, lng, adresse }: MapLinksProps) {
  if (isUsableGeoPoint(lat, lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  if (adresse) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}`;
  }
  return null;
}

function buildAppleMapsUrl({ lat, lng, adresse }: MapLinksProps) {
  if (isUsableGeoPoint(lat, lng)) {
    return `https://maps.apple.com/?ll=${lat},${lng}`;
  }
  if (adresse) {
    return `https://maps.apple.com/?q=${encodeURIComponent(adresse)}`;
  }
  return null;
}

export function MapLinks({ lat, lng, adresse }: MapLinksProps) {
  const googleUrl = buildGoogleMapsUrl({ lat, lng, adresse });
  const appleUrl = buildAppleMapsUrl({ lat, lng, adresse });

  if (!googleUrl && !appleUrl) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {googleUrl && (
        <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer">
            <MapPin data-icon="inline-start" />
            In Google Maps öffnen
          </a>
        </Button>
      )}
      {appleUrl && (
        <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
          <a href={appleUrl} target="_blank" rel="noopener noreferrer">
            <Compass data-icon="inline-start" />
            In Apple Maps öffnen
          </a>
        </Button>
      )}
    </div>
  );
}
