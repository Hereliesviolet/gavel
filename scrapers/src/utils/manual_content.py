"""
Manuelle Content-Quellen für die Custom-URL-Analyse (Phase 3 - private/
login-geschützte Angebote, siehe docs/CUSTOM_URL_ANALYSIS.md).

Drei Wege statt eines Live-Fetches:
  - HTML-Einfügung: Nutzer kopiert den Seitenquelltext aus dem eigenen,
    eingeloggten Browser-Tab.
  - PDF-Upload: z.B. ein gespeichertes Exposé-PDF.
  - Opt-in-Session-Cookie: Nutzer fügt EXPLIZIT einen Cookie-Header seiner
    eigenen, bereits authentifizierten Browser-Session ein - kein
    automatisches/stilles Abgreifen von Zugangsdaten.

Für HTML/PDF findet KEIN Netzwerk-Fetch zur Ziel-URL statt (SSRF entfällt
strukturell); die optionale Referenz-URL dient nur als Label/Link zur
Originalanzeige.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re
from typing import Any

MANUAL_UPLOAD_HOST = "manuelle-eingabe.immopulse"
MAX_MANUAL_HTML_CHARS = 1_500_000
MAX_MANUAL_PDF_BYTES = 15 * 1024 * 1024
MAX_COOKIE_HEADER_CHARS = 8000
MAX_COOKIES = 60
PDF_MAGIC = b"%PDF"
_COOKIE_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


class ManualContentError(ValueError):
    pass


def build_manual_reference_url(kind: str, content: str | bytes) -> str:
    """Synthetische, aber deterministische Referenz-URL, wenn der Nutzer keine
    echte Quell-URL angibt. Hash statt Zufall/Zeitstempel, damit ein erneutes
    Einfügen DESSELBEN Inhalts dieselbe Zeile aktualisiert (Refresh-Semantik,
    analog zum external_id/source-Unique-Key bei Live-Fetches)."""
    data = content.encode("utf-8", errors="ignore") if isinstance(content, str) else content
    digest = hashlib.sha256(data).hexdigest()[:32]
    return f"https://{MANUAL_UPLOAD_HOST}/{kind}/{digest}"


def is_manual_reference_url(url: str | None) -> bool:
    return f"//{MANUAL_UPLOAD_HOST}/" in (url or "")


def decode_pdf_base64(raw: str) -> bytes:
    """Dekodiert ein Base64-PDF und prüft Größe plus %PDF-Magic."""
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ManualContentError(
            "PDF-Datei konnte nicht gelesen werden (ungültige Kodierung)"
        ) from exc
    if len(data) > MAX_MANUAL_PDF_BYTES:
        raise ManualContentError(
            f"PDF-Datei ist zu groß (Limit {MAX_MANUAL_PDF_BYTES // (1024 * 1024)} MB)"
        )
    if not data.startswith(PDF_MAGIC):
        raise ManualContentError("Die Datei ist kein gültiges PDF")
    return data


def parse_cookie_header(raw: str, host: str) -> list[dict[str, Any]]:
    """Parst einen `Cookie:`-Header-String ("name=wert; name2=wert2") in
    Cookie-Dicts für die Ziel-Domain. Werte werden NIE geloggt."""
    cleaned = raw.strip()
    if cleaned.lower().startswith("cookie:"):
        cleaned = cleaned[7:].strip()
    if len(cleaned) > MAX_COOKIE_HEADER_CHARS:
        raise ManualContentError("Cookie-Wert ist zu lang")
    if _COOKIE_CONTROL_RE.search(cleaned):
        raise ManualContentError("Cookie-Wert enthält unzulässige Steuerzeichen")

    cookies: list[dict[str, Any]] = []
    for part in cleaned.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, _, value = part.partition("=")
        name = name.strip()
        value = value.strip()
        if not name or _COOKIE_CONTROL_RE.search(name) or _COOKIE_CONTROL_RE.search(value):
            continue
        cookies.append({"name": name, "value": value, "domain": host, "path": "/", "secure": True})
        if len(cookies) > MAX_COOKIES:
            raise ManualContentError("Cookie-Wert enthält zu viele Einträge")

    if not cookies:
        raise ManualContentError(
            "Cookie-Wert konnte nicht gelesen werden (Format: name=wert; name2=wert2)"
        )
    return cookies
