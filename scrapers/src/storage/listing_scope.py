from __future__ import annotations

import json
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from src.utils.manual_content import is_manual_reference_url

OWNER_EXTERNAL_ID_MARKER = "#owner:"
# "scrapling" is the value older rows carry for the same kind of fetch.
PUBLIC_LIVE_FETCH_SOURCES = frozenset({"http", "scrapling"})
_QUERYLESS_LISTING_PATHS = ("/expose/", "/s-anzeige/")
_TRACKING_QUERY_KEYS = frozenset(
    {
        "fbclid",
        "gclid",
        "gclsrc",
        "dclid",
        "msclkid",
        "twclid",
        "yclid",
        "ttclid",
        "wbraid",
        "gbraid",
        "li_fat_id",
        "igshid",
        "mc_cid",
        "mc_eid",
        "_ga",
        "_gl",
        "_gac",
        "referrer",
        "searchid",
    }
)
_TRACKING_QUERY_PREFIXES = ("utm_", "mtm_", "pk_", "hsa_")


def _flag_is_true(value: Any) -> bool:
    if value is True or value == 1:
        return True
    if isinstance(value, str):
        return value.strip().lower() in {"true", "t", "1"}
    return False


def scrape_metadata_is_private(meta: Optional[dict[str, Any]]) -> bool:
    if not isinstance(meta, dict):
        return True
    if _flag_is_true(meta.get("session_cookie_used")):
        return True
    source = meta.get("fetch_source")
    if source in ("manual_html", "manual_pdf"):
        return True
    return source not in PUBLIC_LIVE_FETCH_SOURCES


def raw_data_is_private(raw_data: Any, source_url: Optional[str] = None) -> bool:
    if is_manual_reference_url(source_url):
        return True
    if isinstance(raw_data, str):
        try:
            raw_data = json.loads(raw_data)
        except json.JSONDecodeError:
            return True
    if not isinstance(raw_data, dict):
        return True
    meta = raw_data.get("scrape_metadata")
    return scrape_metadata_is_private(meta if isinstance(meta, dict) else None)


def is_listing_tracking_query_key(key: str) -> bool:
    lower = key.strip().lower()
    if not lower:
        return False
    if lower in _TRACKING_QUERY_KEYS:
        return True
    return lower.startswith(_TRACKING_QUERY_PREFIXES)


def strip_listing_identity_query(url: str) -> str:
    owner = ""
    base = url
    if OWNER_EXTERNAL_ID_MARKER in url:
        base, _, rest = url.partition(OWNER_EXTERNAL_ID_MARKER)
        owner = f"{OWNER_EXTERNAL_ID_MARKER}{rest}"
    parsed = urlparse(base)
    path = (parsed.path or "").lower()
    drop_query = any(marker in path for marker in _QUERYLESS_LISTING_PATHS)
    if drop_query:
        query = ""
        changed = bool(parsed.query or parsed.fragment)
    elif parsed.query:
        pairs = parse_qsl(parsed.query, keep_blank_values=True)
        kept = [(key, value) for key, value in pairs if not is_listing_tracking_query_key(key)]
        if len(kept) == len(pairs):
            query = parsed.query
            changed = bool(parsed.fragment)
        else:
            query = urlencode(kept)
            changed = True
    else:
        query = ""
        changed = bool(parsed.fragment)
    if not changed:
        return url
    rebuilt = urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path or "/", parsed.params, query, "")
    )
    return f"{rebuilt}{owner}"


def listing_url_host_variants(url: str) -> list[str]:
    owner = ""
    base = url
    if OWNER_EXTERNAL_ID_MARKER in url:
        base, _, rest = url.partition(OWNER_EXTERNAL_ID_MARKER)
        owner = f"{OWNER_EXTERNAL_ID_MARKER}{rest}"
    parsed = urlparse(base)
    host = (parsed.hostname or "").lower()
    if not host:
        return [url]
    apex = host.removeprefix("www.") if host.startswith("www.") else host
    hosts = [apex]
    www = host if host.startswith("www.") else f"www.{host}"
    if www != apex:
        hosts.append(www)
    out: list[str] = []
    for candidate in hosts:
        netloc = f"{candidate}:{parsed.port}" if parsed.port else candidate
        rebuilt = urlunparse(
            (parsed.scheme, netloc, parsed.path or "/", parsed.params, parsed.query, "")
        )
        rebuilt = f"{rebuilt}{owner}"
        if rebuilt not in out:
            out.append(rebuilt)
    return out


def listing_url_lookup_variants(url: str) -> list[str]:
    out: list[str] = []
    for candidate in (url, strip_listing_identity_query(url)):
        for variant in listing_url_host_variants(candidate):
            if variant not in out:
                out.append(variant)
    return out


def listing_url_identity(url: str) -> str:
    return listing_url_host_variants(strip_listing_identity_query(url))[0]


def listing_url_identity_base(url: str) -> str:
    return listing_url_identity(url.partition(OWNER_EXTERNAL_ID_MARKER)[0])


def listing_url_leftover_prefixes(url: str) -> list[str]:
    ident = listing_url_identity_base(url)
    parsed = urlparse(ident)
    if not parsed.scheme or not parsed.netloc:
        return []
    bare = urlunparse((parsed.scheme, parsed.netloc, parsed.path or "/", "", "", ""))
    out: list[str] = []
    for variant in listing_url_host_variants(bare):
        cleaned = variant.partition("?")[0].partition("#")[0]
        if cleaned and cleaned not in out:
            out.append(cleaned)
    return out


def listing_external_id(
    source_url: str,
    user_id: Optional[str],
    scrape_metadata: Optional[dict[str, Any]],
) -> str:
    ident = listing_url_identity(source_url)
    if scrape_metadata_is_private(scrape_metadata) or is_manual_reference_url(source_url):
        if OWNER_EXTERNAL_ID_MARKER in ident:
            return ident
        return owner_scoped_external_id(ident, user_id)
    return ident


def owner_scoped_external_id(source_url: str, user_id: Optional[str]) -> str:
    return f"{source_url}{OWNER_EXTERNAL_ID_MARKER}{user_id or 'system'}"


def blocks_cross_user_private_update(
    existing_user_id: Optional[str],
    existing_raw_data: Any,
    incoming_user_id: Optional[str],
    incoming_meta: Optional[dict[str, Any]],
    existing_source_url: Optional[str] = None,
    incoming_source_url: Optional[str] = None,
) -> bool:
    existing = str(existing_user_id) if existing_user_id else None
    incoming = str(incoming_user_id) if incoming_user_id else None
    incoming_private = scrape_metadata_is_private(incoming_meta) or is_manual_reference_url(
        incoming_source_url
    )
    existing_private = raw_data_is_private(existing_raw_data, existing_source_url)
    if existing_private != incoming_private:
        return True
    if existing and incoming and existing == incoming:
        return False
    return existing_private or incoming_private
