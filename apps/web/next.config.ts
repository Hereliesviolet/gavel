import type { NextConfig } from "next";

// Content-Security-Policy für MapLibre GL / Maptiler
// (Karten auf Objekt-Detailseiten und in der Kartenansicht, siehe
// components/zvg/map-view.tsx und components/zvg/detail/standort-map.tsx) und
// next-auth/Next.js selbst konfiguriert. 'unsafe-inline' bei script-src und
// style-src ist ein bewusster Kompromiss: Next.js (App Router) setzt ohne
// explizite Nonce-Konfiguration Inline-Scripts für die Hydration ein, und
// Tailwind/Next injizieren Inline-Styles (u.a. für CSS-in-JS-artige
// Style-Attribute, z.B. in map-view.tsx). Eine strikte nonce-basierte CSP
// wäre restriktiver, hätte aber ein höheres Risiko, produktiv etwas zu
// brechen - daher hier zunächst die konservativste CSP, die die App
// nachweislich nicht bricht (siehe Deployment-Verifikation).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://api.maptiler.com https://*.maptiler.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.maptiler.com https://*.maptiler.com https://*.ingest.sentry.io https://*.ingest.de.sentry.io",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Eigener öffentlicher Host für absolute Bild-URLs (NEXT_PUBLIC_SITE_URL, wird
// beim Build ausgewertet). Ohne https-Wert entfällt das Muster; relative
// /zvg-images-Pfade brauchen es nicht.
function siteImagePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return [];
    return [{ protocol: "https", hostname: url.hostname, pathname: "/zvg-images/**" }];
  } catch {
    return [];
  }
}

const config: NextConfig = {
  output: "standalone",
  // `next dev` would otherwise write AGENTS.md / CLAUDE.md into the app directory.
  agentRules: false,
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/statistik",
        destination: "/investor",
        permanent: true,
      },
      // Die vier Strategieseiten sind Presets der Suche geworden, Finder und
      // Einstieg sind darin aufgegangen, Markt in der Datenbasis.
      { source: "/investor/finder", destination: "/investor/suche", permanent: true },
      {
        source: "/investor/einstieg",
        destination: "/investor/suche?preset=einsteiger-paket",
        permanent: true,
      },
      {
        source: "/investor/fix-flip",
        destination: "/investor/suche?preset=fix-flip",
        permanent: true,
      },
      {
        source: "/investor/buy-hold",
        destination: "/investor/suche?preset=buy-hold",
        permanent: true,
      },
      {
        source: "/investor/unter-markt",
        destination: "/investor/suche?preset=unter-markt",
        permanent: true,
      },
      {
        source: "/investor/zeitnah",
        destination: "/investor/suche?preset=zeitnah",
        permanent: true,
      },
      { source: "/investor/markt", destination: "/investor/datenbasis", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: CONTENT_SECURITY_POLICY,
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
        ],
      },
      {
        source: "/login/confirm-email",
        headers: [
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
        ],
      },
    ];
  },
  async rewrites() {
    const rawHost = (process.env.MINIO_ENDPOINT || "minio").trim() || "minio";
    const minioHost =
      process.env.NODE_ENV === "production" && (rawHost === "localhost" || rawHost === "127.0.0.1")
        ? "minio"
        : rawHost;
    const minioPort = process.env.MINIO_PORT || "9000";
    return [
      {
        source: "/zvg-images/:path*",
        destination: `http://${minioHost}:${minioPort}/zvg-images/:path*`,
      },
    ];
  },
  images: {
    localPatterns: [{ pathname: "/zvg-images/**" }, { pathname: "/api/analyse/**" }],
    remotePatterns: [
      ...siteImagePatterns(),
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/zvg-images/**",
      },
      {
        protocol: "http",
        hostname: "minio",
        port: "9000",
        pathname: "/zvg-images/**",
      },
    ],
  },
  serverExternalPackages: ["@neondatabase/serverless"],
  // Next.js bündelt bei diesen
  // Paketen sonst ungenutzte Submodule mit (recharts+d3 ist auf /statistik
  // bereits isoliert, aber weiterhin größer als nötig). optimizePackageImports
  // transformiert Barrel-Importe automatisch in gezielte Einzelimporte.
  experimental: {
    optimizePackageImports: ["recharts", "lucide-react", "date-fns"],
  },
};

export default config;
