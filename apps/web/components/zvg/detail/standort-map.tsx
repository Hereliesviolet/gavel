"use client";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { isUsableGeoPoint } from "@/lib/geo-point";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const MAP_STYLE_DARK = `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`;

interface StandortMapProps {
  lat: number;
  lng: number;
  adresse?: string | null;
  verkehrswert?: number | null;
  priceLabel?: string;
}

function formatEur(v: number | null | undefined) {
  if (!v) return null;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

export function StandortMap({
  lat,
  lng,
  adresse,
  verkehrswert,
  priceLabel = "Verkehrswert",
}: StandortMapProps) {
  const usable = isUsableGeoPoint(lat, lng);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapStyle = MAP_STYLE_DARK;

  // Die Karte mountete bisher
  // sofort beim Rendern der Detailseite und konkurrierte per WebGL-Init auf
  // dem Hauptthread mit der Text-Darstellung (LCP-Element) um Rechenzeit -
  // gemessen: LCP 2,9s trotz <300ms Netzwerkzeit. Der IntersectionObserver
  // verschiebt die Initialisierung, bis die Kartensektion nahe am Viewport
  // ist (rootMargin sorgt dafür, dass die Karte beim Erreichen bereits fertig
  // geladen ist), statt beim ersten Paint der Seite.
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (!usable || !wrapperRef.current || isNearViewport) return;
    const el = wrapperRef.current;
    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [usable, isNearViewport]);

  useEffect(() => {
    if (!usable || !isNearViewport || !mapRef.current) return;
    const container = mapRef.current;
    let cleanup: (() => void) | null = null;

    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (!container.isConnected) return;

      const map = new maplibregl.Map({
        container,
        style: mapStyle,
        center: [lng, lat],
        zoom: 15,
        attributionControl: undefined,
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");

      const popupNode = document.createElement("div");
      if (adresse?.trim()) {
        const title = document.createElement("strong");
        title.textContent = adresse.trim();
        popupNode.appendChild(title);
      }
      const wert = formatEur(verkehrswert);
      if (wert) {
        if (popupNode.childNodes.length) popupNode.appendChild(document.createElement("br"));
        popupNode.appendChild(document.createTextNode(`${priceLabel}: ${wert}`));
      }
      if (!popupNode.childNodes.length) {
        popupNode.textContent = "Standort";
      }

      const popup = new maplibregl.Popup({ offset: 28, maxWidth: "240px" }).setDOMContent(
        popupNode,
      );

      const primaryColor = "var(--color-neon-glow)";

      new maplibregl.Marker({ color: primaryColor })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map)
        .togglePopup();

      cleanup = () => map.remove();
    });

    return () => {
      cleanup?.();
    };
  }, [usable, isNearViewport, lat, lng, adresse, verkehrswert, priceLabel, mapStyle]);

  if (!usable) return null;

  return (
    <div
      ref={wrapperRef}
      style={{ width: "100%", height: "300px", borderRadius: "12px", overflow: "hidden" }}
    >
      {isNearViewport && <div ref={mapRef} style={{ width: "100%", height: "100%" }} />}
    </div>
  );
}
