import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { readAuthSecret } from "@/lib/auth-secret";
import { ephemeralJwtExpired, jwtHasBoundSession } from "@/lib/session-token";
import { isSessionRevoked } from "@/lib/session-revocation";
import { EMAIL_CONFIRM_COOKIE, emailConfirmCookieOptions } from "@/lib/email-change";
import { readEmailConfirmHandoff } from "@/lib/email-confirm-handoff";

/**
 * Auth-Gate: alles ist privat, außer /login, /api/auth (next-auth intern),
 * /api/cron (secret-basiert, siehe route.ts) und Static Assets.
 *
 * Prüft nicht nur ob ein Session-Cookie *vorhanden* ist, sondern verifiziert
 * das JWT tatsächlich (Signatur + Ablaufdatum) via next-auth/jwt#getToken.
 * Ein gefälschter/leerer Cookie-Wert reicht damit nicht mehr aus, um das
 * Gate zu umgehen.
 *
 * Sicherheitsfix: zusätzlich wird der `sid`-Claim
 * des JWTs gegen die Redis-Widerrufsliste geprüft (siehe
 * lib/session-revocation.ts). Vorher akzeptierte dieses Gate jedes JWT mit
 * gültiger Signatur/Ablaufzeit, unabhängig davon, ob die zugehörige
 * `user_login_sessions`-Zeile bereits per /api/account/sessions/[id]
 * widerrufen wurde - ein gestohlenes/verlorenes Gerät behielt dadurch bis
 * zum 30-Tage-Ablauf des JWTs vollen Zugriff, obwohl die Account-UI dem
 * Nutzer verspricht, dass das Gerät "beim nächsten Seitenaufruf" abgemeldet
 * wird. `proxy.ts` läuft seit Next.js 16 standardmäßig in der Node.js- statt
 * der Edge-Runtime (siehe next.js-Migrationsleitfaden "middleware zu
 * proxy"), ein direkter Redis-Zugriff ist hier also technisch problemlos
 * möglich. Redis hält Widerruf und einen kurzen Live-Marker; ohne Treffer
 * oder bei Redis-Ausfall entscheidet die DB.
 */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

/** Löscht alle bekannten Session-Cookie-Varianten auf der Response. */
function clearSessionCookies(res: NextResponse) {
  for (const name of SESSION_COOKIE_NAMES) {
    res.cookies.set(name, "", { maxAge: 0, path: "/" });
  }
}

/** Altlinks mit ?strategy= landen im passenden Preset der Suche. */
const STRATEGY_QUERY_PRESETS: Record<string, string> = {
  fix_flip: "fix-flip",
  buy_hold: "buy-hold",
  unter_markt: "unter-markt",
  zeitnah: "zeitnah",
};

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname === "/login/confirm-email") {
    const rid = req.nextUrl.searchParams.get("rid")?.trim();
    if (rid) {
      let token: string | null;
      try {
        token = await readEmailConfirmHandoff(rid);
      } catch (error) {
        console.error("email confirm handoff unavailable:", error);
        return NextResponse.redirect(new URL(`/login?email=unavailable`, req.url));
      }
      const url = req.nextUrl.clone();
      url.search = "";
      if (!token) {
        return NextResponse.redirect(new URL(`/login?email=invalid`, req.url));
      }
      const res = NextResponse.redirect(url);
      res.cookies.set(EMAIL_CONFIRM_COOKIE, token, emailConfirmCookieOptions());
      return res;
    }
  }

  if (pathname === "/investor" || pathname === "/statistik") {
    const strategy = req.nextUrl.searchParams.get("strategy");
    const preset = strategy ? STRATEGY_QUERY_PRESETS[strategy] : null;
    if (preset) {
      const url = req.nextUrl.clone();
      url.pathname = "/investor/suche";
      url.searchParams.delete("strategy");
      url.searchParams.set("preset", preset);
      return NextResponse.redirect(url, 301);
    }
  }

  // Wird an app/layout.tsx durchgereicht (siehe dortiger Kommentar), damit
  // die Root-Layout-RSC weiß, ob gerade /login gerendert wird - dort ist
  // (anders als auf allen anderen Seiten) ein fehlender `session.user.id`
  // erwartet und darf keinen Redirect auslösen.
  const nextWithPathname = () => {
    const forwardedHeaders = new Headers(req.headers);
    forwardedHeaders.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: forwardedHeaders } });
  };

  const isProbeOrAsset =
    pathname.startsWith("/api/cron") ||
    pathname === "/api/health" ||
    pathname === "/api/metrics" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/zvg-images") ||
    pathname === "/favicon.ico" ||
    pathname === "/site.webmanifest" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".webp");

  if (isProbeOrAsset) {
    return nextWithPathname();
  }

  const secret = readAuthSecret();
  if (!secret) {
    return NextResponse.json({ error: "Server falsch konfiguriert" }, { status: 503 });
  }

  const isPublic = pathname.startsWith("/api/auth");

  if (isPublic) {
    return nextWithPathname();
  }

  // next-auth vergibt je nach erkanntem Protokoll unterschiedliche Cookie-Namen:
  // "authjs.session-token" über HTTP (lokale Entwicklung), aber
  // "__Secure-authjs.session-token" sobald die Anfrage als HTTPS erkannt wird
  // (z.B. produktiv hinter Caddy). Beide Varianten müssen geprüft werden,
  // sonst bricht entweder Dev oder Prod.
  const secureCookieName = "__Secure-authjs.session-token";
  const plainCookieName = "authjs.session-token";
  const usesSecureCookie = req.cookies.has(secureCookieName);
  const cookieName = usesSecureCookie ? secureCookieName : plainCookieName;
  const hasStaleCookie = req.cookies.has(cookieName);

  // Nach einer Secret-Rotation (oder abgelaufenem/manipuliertem Cookie) kann
  // getToken() intern eine Decryption-Exception werfen statt sauber `null`
  // zurückzugeben. Wird hier abgefangen, damit weder die Middleware noch
  // spätere auth()-Aufrufe im Layout mit einem JWTSessionError crashen.
  let token: Awaited<ReturnType<typeof getToken>> = null;
  try {
    token = await getToken({
      req,
      secret,
      cookieName,
      secureCookie: usesSecureCookie,
    });
  } catch {
    token = null;
  }

  const isLoginPath = pathname === "/login" || pathname.startsWith("/login/");
  const isDeniedApiPath = pathname.startsWith("/api/") && !pathname.startsWith("/api/auth");

  // Gemeinsame Response für alle "Zugriff verweigert"-Fälle
  // (kein/ungültiges Token ODER widerrufene Session) - räumt in jedem Fall
  // den Cookie auf, damit der Browser ihn nicht erneut sendet.
  // API-Clients (fetch) dürfen kein HTML-Login bekommen: sonst ist res.ok
  // true und Optimistic-UI (Favoriten, Suche) rollt nicht zurück.
  const buildDeniedResponse = () => {
    const res = isDeniedApiPath
      ? NextResponse.json({ error: "Nicht eingeloggt" }, { status: 401 })
      : isLoginPath
        ? nextWithPathname()
        : NextResponse.redirect(
            (() => {
              const url = req.nextUrl.clone();
              url.pathname = "/login";
              url.searchParams.set("from", pathname + search);
              return url;
            })(),
          );
    if (hasStaleCookie) clearSessionCookies(res);
    return res;
  };

  if (!token) {
    // Ungültiger/veralteter Cookie (z.B. nach Secret-Rotation) wird entfernt,
    // damit der Browser ihn nicht bei jedem weiteren Request erneut sendet
    // und dadurch immer wieder denselben Decryption-Fehler auslöst.
    return buildDeniedResponse();
  }

  if (!jwtHasBoundSession(token) || ephemeralJwtExpired(token)) {
    return buildDeniedResponse();
  }
  if (await isSessionRevoked(token.sid, token.id)) {
    return buildDeniedResponse();
  }

  return nextWithPathname();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
