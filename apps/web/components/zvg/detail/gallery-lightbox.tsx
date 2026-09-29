"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight, ZoomIn } from "lucide-react";
import { listingImageSrc } from "@/lib/safe-url";

interface GalleryImage {
  publicUrl: string;
  position?: number | null;
}

interface GalleryLightboxProps {
  images: GalleryImage[];
  listingId: string;
  favoriteButton?: React.ReactNode;
}

export function GalleryLightbox({ images: imagesProp, favoriteButton }: GalleryLightboxProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Siehe gallery-hero.tsx: der Scraper legt Bilder derselben Position teils
  // mehrfach in zvg_images ab. Defensiv nach publicUrl deduplizieren, bis der
  // Import idempotent ist.
  const images = useMemo(() => {
    const seen = new Set<string>();
    const next: GalleryImage[] = [];
    for (const img of imagesProp) {
      const src = listingImageSrc(img.publicUrl);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      next.push({ ...img, publicUrl: src });
    }
    return next;
  }, [imagesProp]);

  const open = useCallback((idx: number) => setLightboxIndex(idx), []);
  const close = useCallback(() => setLightboxIndex(null), []);

  const prev = useCallback(() => {
    setLightboxIndex((i) => (i == null ? null : (i - 1 + images.length) % images.length));
  }, [images.length]);

  const next = useCallback(() => {
    setLightboxIndex((i) => (i == null ? null : (i + 1) % images.length));
  }, [images.length]);

  useEffect(() => {
    if (lightboxIndex == null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, close, prev, next]);

  // Touch-Swipe für Mobile (siehe gallery-hero.tsx für Details zur Logik).
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

  if (images.length === 0) {
    return (
      <div className="h-[400px] mb-8 rounded-[4px] overflow-hidden bg-muted flex items-center justify-center">
        <span className="text-muted-foreground text-6xl">🏠</span>
      </div>
    );
  }

  const coverImage = images[0];
  const sideImages = images.slice(1, 5);
  const remainingCount = images.length - 5;

  return (
    <>
      {/* Galerie-Grid */}
      <div className="grid grid-cols-4 grid-rows-2 gap-2 h-[420px] mb-8 rounded-[4px] overflow-hidden relative">
        {/* Hauptbild (links, 2 Spalten, 2 Zeilen) */}
        <button
          className="col-span-2 row-span-2 relative bg-muted overflow-hidden group cursor-zoom-in"
          onClick={() => open(0)}
        >
          <Image
            src={coverImage.publicUrl}
            alt="Hauptbild"
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <ZoomIn
              className="text-white opacity-0 group-hover:opacity-100 transition-opacity"
              size={28}
            />
          </div>
        </button>

        {/* 4 kleine Bilder (rechts) */}
        {Array.from({ length: 4 }).map((_, i) => {
          const img = sideImages[i];
          const isLast = i === 3 && remainingCount > 0;
          const globalIdx = i + 1;
          return (
            <button
              key={i}
              className="relative bg-muted overflow-hidden group cursor-zoom-in"
              onClick={() => open(img ? globalIdx : 0)}
              disabled={!img}
            >
              {img ? (
                <>
                  <Image
                    src={img.publicUrl}
                    alt={`Bild ${globalIdx + 1}`}
                    fill
                    sizes="(max-width: 1024px) 25vw, 12vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                  {isLast && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm font-semibold">
                      +{remainingCount} weitere
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <span className="text-2xl">🏠</span>
                </div>
              )}
            </button>
          );
        })}

        {/* Overlay-Buttons (Favorit, Bilder-Count) */}
        <div className="absolute top-3 right-3 flex flex-col gap-2 z-10">
          {favoriteButton}
          {images.length > 0 && (
            <span className="bg-black/60 text-white text-xs px-2 py-1 rounded-[4px]">
              {images.length} Bilder
            </span>
          )}
        </div>
      </div>

      {/* Lightbox Overlay */}
      {lightboxIndex != null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center touch-pan-y"
          onClick={close}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Schließen-Button */}
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10 flex items-center justify-center size-11 rounded-full bg-background/10 hover:bg-background/20 transition-colors"
            onClick={close}
            aria-label="Schließen"
          >
            <X size={24} />
          </button>

          {/* Zähler */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
            {lightboxIndex + 1} / {images.length}
          </div>

          {/* Vorheriges Bild */}
          {images.length > 1 && (
            <button
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
              src={images[lightboxIndex].publicUrl}
              alt={`Bild ${lightboxIndex + 1}`}
              fill
              sizes="90vw"
              className="object-contain rounded-[4px]"
            />
          </div>

          {/* Nächstes Bild */}
          {images.length > 1 && (
            <button
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
                  key={idx}
                  className={`relative w-14 h-10 shrink-0 rounded overflow-hidden border-2 transition-colors ${
                    idx === lightboxIndex ? "border-white" : "border-white/30 hover:border-white/60"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex(idx);
                  }}
                >
                  <Image src={img.publicUrl} alt="" fill sizes="56px" className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
