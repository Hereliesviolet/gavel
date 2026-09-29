"""Plain HTTP page fetching for the scrapers.

Two functions:

  fetch_page()  - GET a page and return markdown-like text, the raw HTML and the
                  links. Used by the court-portal and auction-site scrapers.
  fetch_html()  - GET a page for the custom-URL analysis, optionally with the
                  session cookies the user pasted for their own login.

Both send an honest User-Agent (see user_agent.py), check robots.txt, validate
every redirect hop against the SSRF rules (url_safety.fetch_public_request) and
do not execute JavaScript. Pages that need a browser or sit behind bot
protection are not fetched; callers get a failed result and log or report it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from loguru import logger

from src.utils.url_safety import (
    RobotsDisallowedError,
    UrlSafetyError,
    fetch_public_request,
    log_safe_url,
)
from src.utils.user_agent import default_headers


@dataclass
class FetchResult:
    url: str
    markdown: str = ""
    raw_html: str = ""
    links: list[str] = field(default_factory=list)
    status_code: int | None = None
    success: bool = True
    error: str | None = None


def html_to_markdown(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    return soup.get_text("\n", strip=True)


def extract_links(html: str, base_url: str) -> list[str]:
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    links: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            continue
        links.append(urljoin(base_url, href))
    return list(dict.fromkeys(links))


async def fetch_page(
    url: str,
    headers: dict[str, str] | None = None,
    timeout_ms: int = 30000,
    *,
    allowed_hosts: frozenset[str] | None = None,
    require_https: bool = True,
) -> FetchResult:
    """GET a page. Redirects are followed hop by hop with the SSRF checks and an
    optional host allowlist; robots.txt is honoured."""
    try:
        response = await fetch_public_request(
            "GET",
            url,
            timeout_sec=timeout_ms / 1000,
            headers=default_headers(headers),
            require_https=require_https,
            allowed_hosts=allowed_hosts,
        )
    except RobotsDisallowedError:
        logger.info(f"fetch_page übersprungen (robots.txt): {log_safe_url(url)}")
        return FetchResult(url=url, success=False, error="Abruf laut robots.txt nicht erlaubt")
    except UrlSafetyError as e:
        logger.warning(f"fetch_page URL abgelehnt ({log_safe_url(url)}): {e}")
        return FetchResult(url=url, success=False, error="URL nicht erlaubt")
    except Exception as e:
        logger.warning(f"fetch_page fehlgeschlagen ({log_safe_url(url)}): {e}")
        return FetchResult(url=url, success=False, error="Seite konnte nicht geladen werden.")

    final_url = str(response.url)
    raw_html = response.text
    return FetchResult(
        url=final_url,
        markdown=html_to_markdown(raw_html),
        raw_html=raw_html,
        links=extract_links(raw_html, final_url),
        status_code=response.status_code,
        success=True,
    )


def _cookie_jar(cookies: list[dict[str, Any]] | None, url: str) -> httpx.Cookies | None:
    if not cookies:
        return None
    host = (urlparse(url).hostname or "").lower()
    jar = httpx.Cookies()
    for cookie in cookies:
        name = cookie.get("name")
        if name:
            jar.set(str(name), str(cookie.get("value", "")), domain=host, path="/")
    return jar


async def fetch_html(
    url: str,
    *,
    cookies: list[dict[str, Any]] | None = None,
    timeout_ms: int = 15000,
) -> dict[str, Any]:
    """GET for the custom-URL analysis. `cookies` are the session cookies a user
    pasted on purpose for their own login; they are scoped to the target host,
    used for this single request and never stored.

    Returns {"content", "pageStatusCode", "userAgent"} or, when the page cannot
    be fetched, {"content": "", "pageStatusCode": None, "pageError": <reason>}.
    """
    headers = default_headers()
    try:
        response = await fetch_public_request(
            "GET",
            url,
            timeout_sec=timeout_ms / 1000,
            headers=headers,
            require_https=True,
            cookies=_cookie_jar(cookies, url),
        )
    except RobotsDisallowedError:
        raise
    except UrlSafetyError:
        raise
    except Exception as e:
        logger.warning(f"fetch_html fehlgeschlagen ({log_safe_url(url)}): {e}")
        return {"content": "", "pageStatusCode": None, "pageError": "fetch_failed"}
    return {
        "content": response.text,
        "pageStatusCode": response.status_code,
        "userAgent": headers["User-Agent"],
    }
