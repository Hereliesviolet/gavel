import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { LiveTicker, getTickerData } from "@/components/layout/live-ticker";
import { Providers } from "./providers";
import { filterAccessibleFavorites } from "@/lib/analyse-access";
import { auth } from "@/lib/auth";
import { listExistingUserFavorites } from "@/lib/favorite-write";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geistmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Gavel – Tagesaktuelle Zwangsversteigerungen",
    template: "%s | Gavel",
  },
  description: "Internes Portal für Zwangsversteigerungen mit KI-gestützter Analyse.",
  robots: "noindex, nofollow",
  manifest: "/site.webmanifest",
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "??";
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, tickerData, headersList] = await Promise.all([
    auth().catch(() => null),
    getTickerData(),
    headers(),
  ]);
  const userId = session?.user?.id;

  const pathname = headersList.get("x-pathname") ?? "";
  const isLoginPath = pathname === "/login" || pathname.startsWith("/login/");
  const isPublicAssetPath =
    pathname.startsWith("/zvg-images") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/site.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml";
  if (!userId && !isLoginPath && !isPublicAssetPath) {
    redirect(`/login?from=${encodeURIComponent(pathname || "/")}`);
  }

  let favoritenCount = 0;
  let navUser: { initials: string } | null = null;

  if (userId) {
    navUser = { initials: getInitials(session.user?.name, session.user?.email) };
    try {
      const favRows = await listExistingUserFavorites(userId);
      favoritenCount = (await filterAccessibleFavorites(userId, favRows)).length;
    } catch {
      favoritenCount = 0;
    }
  }

  return (
    <html lang="de" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${geistMono.variable} font-sans min-h-screen flex flex-col bg-background text-foreground`}
      >
        <Providers>
          {userId ? (
            <>
              <LiveTicker data={tickerData} />
              <Navbar user={navUser} favoritenCount={favoritenCount} />
              <main className="flex-1">{children}</main>
              <Footer />
            </>
          ) : (
            <main className="flex-1">{children}</main>
          )}
        </Providers>
      </body>
    </html>
  );
}
