import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isListingOwnedStoragePath,
  isObjectTooLarge,
  isSafeObjectStoragePath,
  readBoundedStream,
} from "@/lib/object-stream";

async function* chunksOf(parts: string[]) {
  for (const part of parts) {
    yield part;
  }
}

describe("readBoundedStream", () => {
  it("liest innerhalb des Limits", async () => {
    const body = await readBoundedStream(chunksOf(["ab", "cd"]), 10);
    expect(body.toString()).toBe("abcd");
  });

  it("lehnt zu große Objekte ab", async () => {
    await expect(readBoundedStream(chunksOf(["abcdef"]), 4)).rejects.toThrow("OBJECT_TOO_LARGE");
    expect(isObjectTooLarge(new Error("OBJECT_TOO_LARGE"))).toBe(true);
    expect(isObjectTooLarge(new Error("other"))).toBe(false);
  });
});

describe("isSafeObjectStoragePath", () => {
  it("lässt relative Objektpfade zu", () => {
    expect(isSafeObjectStoragePath("abc/foto_0.jpg")).toBe(true);
    expect(isSafeObjectStoragePath("uuid/gutachten.pdf")).toBe(true);
  });

  it("lehnt Traversal und absolute Pfade ab", () => {
    expect(isSafeObjectStoragePath("../etc/passwd")).toBe(false);
    expect(isSafeObjectStoragePath("/secret/foto.jpg")).toBe(false);
    expect(isSafeObjectStoragePath("a\\b.jpg")).toBe(false);
    expect(isSafeObjectStoragePath("")).toBe(false);
    expect(isSafeObjectStoragePath("a\0b.jpg")).toBe(false);
  });
});

describe("isListingOwnedStoragePath", () => {
  it("bindet den Pfad an die Listing-ID", () => {
    expect(isListingOwnedStoragePath("abc", "abc/foto_0.jpg")).toBe(true);
    expect(isListingOwnedStoragePath("abc", "other/foto_0.jpg")).toBe(false);
    expect(isListingOwnedStoragePath("abc", "real-estate/abc/foto_0.jpg")).toBe(true);
    expect(isListingOwnedStoragePath("abc", "real-estate/other/foto_0.jpg")).toBe(false);
    expect(isListingOwnedStoragePath("abc", "real-estate/abcdef/foto_0.jpg")).toBe(false);
    expect(isListingOwnedStoragePath("", "real-estate/abc/foto_0.jpg")).toBe(false);
  });

  it("filtert Analyse-Löschung auf listen-eigene Pfade", () => {
    const del = readFileSync(
      path.join(__dirname, "../../app/api/analyse/[listingId]/route.ts"),
      "utf8",
    );
    expect(del).toContain("isListingOwnedStoragePath(listingId, path)");
    const access = readFileSync(path.join(__dirname, "../../lib/analyse-access.ts"), "utf8");
    expect(access).toContain("isListingOwnedStoragePath(listingId, path)");
    expect(access).toContain('eq(userFavorites.listingType, "real_estate")');
    expect(access).toContain("canReadCustomListing(listing, userId)");
    expect(access).toContain("visibleAnalyseListingIds");
    expect(access).not.toContain("maybeShared");
  });
});
