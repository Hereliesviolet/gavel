export function customListingImageSrc(listingId: string, imageId: string): string {
  return `/api/analyse/${listingId}/images/${imageId}`;
}

export function customListingCoverSrc(listingId: string): string {
  return `/api/analyse/${listingId}/cover`;
}

export function listingImageNeedsBrowserCookies(src: string): boolean {
  return src.startsWith("/api/analyse/");
}
