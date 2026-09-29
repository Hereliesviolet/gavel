"""
Bild-URL-Extraktion aus gescraptem HTML für Custom-URL-Analysen.

Markdown enthält bei Portalen wie Immowelt keine Galerie-URLs (JS-Rendering);
die vollständigen Bild-Links stehen im raw_html (mms.immowelt.de, img-Tags, …).
"""

from __future__ import annotations

import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from src.utils.scrape_domains import normalize_domain

_IMAGE_EXT_RE = re.compile(r"\.(?:jpe?g|png|webp)(?:\?|$)", re.I)
_EXCLUDE_SUBSTRINGS = (
    "mapbox.com",
    "/shared/images/map",
    "favicon",
    "logo",
    "partner-badges",
    "profilbilder",
    "travel-time",
    ".svg",
    "apple-touch-icon",
    "placeholder",
    "data:image",
)

_IMMOWELT_MMS_RE = re.compile(
    r"https?://mms\.immowelt\.de/(?!c/b/)(?:[0-9a-f]/){4}[0-9a-f\-]+\.jpe?g",
    re.I,
)
_IS24_PICTURES_RE = re.compile(
    r"https?://pictures\.immobilienscout24\.de/[^\"'\s<>]+\.(?:jpe?g|png|webp)",
    re.I,
)
_IS24_LEGACY_RE = re.compile(
    r"https?://[^\"'\s<>]*immobilienscout24[^\"'\s<>]*\.(?:jpe?g|png|webp)",
    re.I,
)


def _normalize_image_url(url: str, page_url: str) -> str:
    url = url.strip()
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        url = urljoin(page_url, url)
    return url


def _is_listing_image(url: str) -> bool:
    lower = url.lower()
    if not _IMAGE_EXT_RE.search(lower):
        return False
    return not any(marker in lower for marker in _EXCLUDE_SUBSTRINGS)


def _collect_img_tag_urls(soup: BeautifulSoup, page_url: str) -> list[str]:
    urls: list[str] = []
    for img in soup.find_all("img"):
        for attr in ("src", "data-src", "data-lazy-src", "data-imgsrc", "data-original"):
            value = img.get(attr)
            if value:
                urls.append(_normalize_image_url(value, page_url))
        srcset = img.get("srcset")
        if srcset:
            for part in srcset.split(","):
                candidate = part.strip().split(" ", 1)[0]
                if candidate:
                    urls.append(_normalize_image_url(candidate, page_url))
    return urls


def extract_listing_images(raw_html: str, page_url: str, limit: int = 12) -> list[str]:
    if not raw_html:
        return []

    domain = normalize_domain(page_url)
    candidates: list[str] = []

    if domain == "immowelt.de":
        candidates.extend(_IMMOWELT_MMS_RE.findall(raw_html))
    elif domain == "immobilienscout24.de":
        candidates.extend(_IS24_PICTURES_RE.findall(raw_html))
        candidates.extend(_IS24_LEGACY_RE.findall(raw_html))
    else:
        soup = BeautifulSoup(raw_html, "html.parser")
        candidates.extend(_collect_img_tag_urls(soup, page_url))
        for meta in soup.find_all("meta", property="og:image"):
            content = meta.get("content")
            if content:
                candidates.append(_normalize_image_url(content, page_url))

    seen: set[str] = set()
    result: list[str] = []
    for raw in candidates:
        url = _normalize_image_url(raw, page_url)
        if not _is_listing_image(url):
            continue
        key = url.split("?")[0].strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(url)
        if len(result) >= limit:
            break

    return result
