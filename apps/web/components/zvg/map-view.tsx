"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { zvgListingPath } from "@/lib/zvg-documents";
import { isUsableGeoPoint } from "@/lib/geo-point";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const MAP_STYLE_DARK = `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`;

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  verkehrswert: number;
  typ: string;
  slug: string;
  bundesland: string;
}

function formatEur(v: number) {
  if (!v) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

export function MapView({ pins }: { pins: MapPin[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const validPins = pins.filter((p) => isUsableGeoPoint(p.lat, p.lng));
  const mapStyle = MAP_STYLE_DARK;

  useEffect(() => {
    if (!mapRef.current || validPins.length === 0) return;

    const avgLat = validPins.reduce((s, p) => s + p.lat, 0) / validPins.length;
    const avgLng = validPins.reduce((s, p) => s + p.lng, 0) / validPins.length;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: mapStyle,
      center: [avgLng, avgLat],
      zoom: validPins.length === 1 ? 13 : 9,
      attributionControl: { compact: false },
      // Touch-UX-Fix (Mobile-Audit): Die Karte ist inline in die Seite
      // eingebettet (kein Vollbild) - ohne cooperativeGestures würde ein
      // Ein-Finger-Swipe über die Karte sie verschieben statt die Seite zu
      // scrollen, was auf Mobile das Weiterscrollen blockiert. Mit dieser
      // Option scrollt ein Finger die Seite; Zwei-Finger-Gesten
      // pan/zoomen die Karte (Touch-Äquivalent zu Ctrl+Scroll am Desktop).
      cooperativeGestures: true,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // Bug-Fix (2026-07-04): Bei Objekten, die über weite Teile eines
    // Bundeslands verstreut liegen, reichte die geografische Ausdehnung
    // zwischen den Punkten oft schon bei der bisherigen fest verdrahteten
    // Zoomstufe (9) über den sichtbaren Kartenausschnitt hinaus - die
    // Marker wurden dadurch weit ausserhalb des Containers positioniert
    // (nicht sichtbar, obwohl im DOM korrekt vorhanden). fitBounds
    // berechnet Center/Zoom stattdessen so, dass alle Marker tatsächlich
    // im sichtbaren Bereich liegen.
    if (validPins.length > 1) {
      const bounds = validPins.reduce(
        (b, p) => b.extend([p.lng, p.lat]),
        new maplibregl.LngLatBounds(
          [validPins[0].lng, validPins[0].lat],
          [validPins[0].lng, validPins[0].lat],
        ),
      );
      map.on("load", () => {
        map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 0 });
      });
    }

    validPins.forEach((pin) => {
      const el = document.createElement("div");
      const badge = document.createElement("div");
      badge.style.cssText =
        "background:var(--primary);color:var(--primary-foreground);padding:4px 8px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35)";
      badge.textContent = formatEur(pin.verkehrswert);
      el.appendChild(badge);
      el.style.zIndex = "1";
      el.addEventListener("click", () => {
        const path = zvgListingPath(pin.bundesland, pin.slug);
        if (path) window.location.href = path;
      });

      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = pin.typ?.trim() || "Objekt";
      popup.appendChild(title);
      popup.appendChild(document.createElement("br"));
      popup.appendChild(document.createTextNode(formatEur(pin.verkehrswert)));

      new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .setPopup(new maplibregl.Popup({ offset: 28 }).setDOMContent(popup))
        .addTo(map);
    });

    return () => map.remove();
  }, [validPins, mapStyle]);

  if (validPins.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-[4px] border border-gray-200 bg-gray-50 text-gray-500"
        style={{ height: "500px" }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <p className="text-sm font-medium">
          Für diese Objekte sind noch keine Koordinaten verfügbar.
        </p>
        <p className="text-xs text-gray-400">
          Geocodierung läuft automatisch – bitte bald nochmals versuchen.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      style={{ width: "100%", height: "500px", borderRadius: "12px", overflow: "hidden" }}
    />
  );
}
