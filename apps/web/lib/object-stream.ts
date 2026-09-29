export const MAX_ZVG_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_ANALYSE_IMAGE_BYTES = 8 * 1024 * 1024;

export async function readBoundedStream(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("OBJECT_TOO_LARGE");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function isObjectTooLarge(error: unknown): boolean {
  return error instanceof Error && error.message === "OBJECT_TOO_LARGE";
}

export function isSafeObjectStoragePath(path: string | null | undefined): path is string {
  if (!path) return false;
  const value = path.trim();
  return (
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.startsWith("/")
  );
}

export function isListingOwnedStoragePath(
  listingId: string,
  path: string | null | undefined,
): path is string {
  if (!listingId || listingId.includes("/") || listingId.includes("..")) return false;
  if (!isSafeObjectStoragePath(path)) return false;
  if (path === listingId || path.startsWith(`${listingId}/`)) return true;
  const prefixed = `real-estate/${listingId}`;
  return path === prefixed || path.startsWith(`${prefixed}/`);
}
