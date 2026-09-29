"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { listingImageNeedsBrowserCookies } from "@/lib/analyse-images";
import { listingImageSrc } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { FavoriteButton } from "@/components/shared/favorite-button";

export interface GalleryImage {
  url: string;
  alt?: string;
  caption?: string;
}

/**
 * Carbon-style Gallery: 1 großes Bild links, 4 Thumbnails rechts in 2x2.
 * Bei mehr als 5 Bildern: das letzte Thumbnail bekommt einen "+ N weitere"
 * Overlay und öffnet den Lightbox.
 *
 * Ein Klick auf ein beliebiges Bild öffnet die Lightbox (Vollbild-Ansicht
 * mit Vor/Zurück-Navigation, Bildzähler, Escape zum Schließen, Klick
 * außerhalb schließt).
 */
export function GalleryHero({
  images: imagesProp,
  listingId,
  initialFavorited = false,
  className,
}: {
  images: GalleryImage[];
  listingId?: string;
  initialFavorited?: boolean;
  className?: string;
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // Der Scraper legt Bilder derselben Position teils mehrfach ab (siehe
  // zvg_images, u.a. beim Rohracker-Objekt 1-k-113-25: 9 Zeilen für nur 3
  // tatsächliche Fotos). Ohne Dedupe zeigt die Galerie dieselbe URL mehrfach
  // als "verschiedene" Thumbnails. Bis der Scraper-Import idempotent ist,
  // hier defensiv nach URL deduplizieren.
  const images = useMemo(() => {
    const seen = new Set<string>();
    const next: GalleryImage[] = [];
    for (const img of imagesProp) {
      const src = listingImageSrc(img.url);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      next.push({ ...img, url: src });
    }
    return next;
  }, [imagesProp]);

  const hero = images[0];
  const thumbs = images.slice(1, 5);
  const more = images.length - 5;

  const close = useCallback(() => setLightboxIdx(null), []);
  const prev = useCallback(() => {
    setLightboxIdx((i) => (i == null ? null : (i - 1 + images.length) % images.length));
  }, [images.length]);
  const next = useCallback(() => {
    setLightboxIdx((i) => (i == null ? null : (i + 1) % images.length));
  }, [images.length]);

  useEffect(() => {
    if (lightboxIdx == null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIdx, close, prev, next]);

  // Touch-Swipe für die Lightbox (Mobile): horizontales Wischen navigiert
  // vor/zurück, ohne dass eine zusätzliche Dependency nötig ist. Ein
  // Mindestabstand verhindert, dass Tap-Zittern versehentlich als Swipe
  // gewertet wird; ist die Bewegung eher vertikal als horizontal, wird sie
  // ignoriert (z.B. um nicht mit Pinch/Scroll-Gesten zu kollidieren).
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD_PX = 40;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) prev();
        else next();
      }
    },
    [prev, next],
  );

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-4 grid-rows-2 gap-1 rounded-[4px] overflow-hidden border border-border",
          className,
        )}
        style={{ minHeight: 280 }}
      >
        <div className="relative col-span-2 row-span-2">
          <button
            type="button"
            onClick={() => hero && setLightboxIdx(0)}
            className="absolute inset-0 w-full h-full bg-muted overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {hero ? (
              <Image
                src={hero.url}
                alt={hero.alt ?? "Hauptbild"}
                fill
                priority
                unoptimized={listingImageNeedsBrowserCookies(hero.url)}
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            ) : (
              <Placeholder label="OBJEKTBILD · AUSSEN" />
            )}
            <span className="absolute bottom-2 left-2 font-mono text-[10px] bg-background/80 px-1.5 py-0.5 rounded-[4px]">
              1 / {images.length || 1}
            </span>
          </button>

          {listingId && (
            <div className="absolute top-2 right-2 z-10">
              <FavoriteButton listingId={listingId} initialFavorited={initialFavorited} />
            </div>
          )}
        </div>

        {[0, 1, 2, 3].map((i) => {
          const img = thumbs[i];
          const showMore = i === 3 && more > 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => img && setLightboxIdx(i + 1)}
              className="relative bg-muted overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {img ? (
                <>
                  <Image
                    src={img.url}
                    alt={img.alt ?? `Bild ${i + 2}`}
                    fill
                    unoptimized={listingImageNeedsBrowserCookies(img.url)}
                    sizes="(max-width: 1024px) 25vw, 12vw"
                    className="object-cover"
                  />
                  {showMore && (
                    <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                      <span className="font-mono text-sm font-semibold">+ {more}</span>
                    </div>
                  )}
                </>
              ) : (
                <Placeholder small label={["INNEN", "GRUNDRISS", "KÜCHE", "BAD"][i] ?? "BILD"} />
              )}
            </button>
          );
        })}
      </div>

      {/* Lightbox Overlay */}
      {lightboxIdx != null && images.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center touch-pan-y"
          onClick={close}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Schließen-Button */}
          <button
            type="button"
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10 flex items-center justify-center size-11 rounded-full bg-background/10 hover:bg-background/20 transition-colors"
            onClick={close}
            aria-label="Schließen"
          >
            <X size={24} />
          </button>

          {/* Zähler */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm font-mono">
            {lightboxIdx + 1} / {images.length}
          </div>

          {/* Vorheriges Bild */}
          {images.length > 1 && (
            <button
              type="button"
              className="absolute left-2 sm:left-4 text-white/80 hover:text-white z-10 flex items-center justify-center size-11 rounded-full bg-background/10 hover:bg-background/20 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              aria-label="Vorheriges Bild"
            >
              <ChevronLeft size={28} />
            </button>
          )}

          {/* Bild */}
          <div className="w-[90vw] h-[90vh] relative" onClick={(e) => e.stopPropagation()}>
            <Image
              src={images[lightboxIdx].url}
              alt={images[lightboxIdx].alt ?? `Bild ${lightboxIdx + 1}`}
              fill
              unoptimized={listingImageNeedsBrowserCookies(images[lightboxIdx].url)}
              sizes="90vw"
              className="object-contain rounded-[4px]"
            />
          </div>

          {/* Nächstes Bild */}
          {images.length > 1 && (
            <button
              type="button"
              className="absolute right-2 sm:right-4 text-white/80 hover:text-white z-10 flex items-center justify-center size-11 rounded-full bg-background/10 hover:bg-background/20 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              aria-label="Nächstes Bild"
            >
              <ChevronRight size={28} />
            </button>
          )}

          {/* Thumbnails */}
          {images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 overflow-x-auto max-w-[90vw] pb-1">
              {images.map((img, idx) => (
                <button
                  type="button"
                  key={idx}
                  className={cn(
                    "relative w-14 h-10 shrink-0 rounded overflow-hidden border-2 transition-colors",
                    idx === lightboxIdx ? "border-white" : "border-white/30 hover:border-white/60",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIdx(idx);
                  }}
                >
                  <Image
                    src={img.url}
                    alt=""
                    fill
                    unoptimized={listingImageNeedsBrowserCookies(img.url)}
                    sizes="56px"
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Placeholder({ label, small }: { label: string; small?: boolean }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, var(--muted) 0 6px, var(--color-graphite-deep) 6px 12px)",
      }}
    >
      <span
        className={cn(
          "font-mono tracking-[0.1em] text-muted-foreground bg-background/60 px-2 py-1 rounded-[4px]",
          small ? "text-[10px]" : "text-[11px]",
        )}
      >
        {label}
      </span>
    </div>
  );
}
