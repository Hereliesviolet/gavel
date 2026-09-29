"""
DB-Zugriff für die Custom-URL-Analyse (Baustein 3 der Firecrawl-Migration,
siehe docs/CUSTOM_URL_ANALYSIS.md). Bewusst getrennt von postgres.py
(zvg_*-Tabellen, andere Domäne) - nutzt aber denselben Connection-Pool.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from loguru import logger

from src.models.real_estate import CustomListingExtraction, CustomMarketAnalyse
from src.storage.listing_scope import (
    OWNER_EXTERNAL_ID_MARKER,
    blocks_cross_user_private_update,
    listing_external_id,
    listing_url_identity,
    listing_url_identity_base,
    listing_url_leftover_prefixes,
    listing_url_lookup_variants,
    owner_scoped_external_id,
)
from src.storage.object_paths import is_listing_owned_storage_path
from src.storage.postgres import get_connection, release_connection
from src.utils.analysis_version import with_schema_version
from src.utils.manual_content import MANUAL_UPLOAD_HOST
from src.utils.geocoding import is_usable_geo_point
from src.utils.url_safety import log_safe_url, strip_sensitive_query


def _blank_to_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class RealEstateListingGoneError(Exception):
    """Refresh/Reanalyse ohne Zielzeile — kein INSERT einer neuen Anzeige."""


def refresh_target_gone(existing_id: Optional[str], expected_id: Optional[str]) -> bool:
    if not expected_id:
        return False
    return existing_id is None or str(existing_id) != str(expected_id)


def job_expected_listing_id(listing_id) -> Optional[str]:
    if listing_id is None:
        return None
    text = str(listing_id).strip()
    return text or None


def _positive_or_none(value):
    if value is None:
        return None
    try:
        if float(value) <= 0:
            return None
    except (TypeError, ValueError):
        return None
    return value


_EXISTING_LISTING_SQL = """
                SELECT id, external_id, source, submitted_by_user_id, raw_data, source_url,
                       adresse, plz, ort, angebotstyp
                FROM real_estate_listings
                WHERE external_id = $1 AND source = $2
                """

_EXISTING_LISTING_BY_ID_SQL = """
                SELECT id, external_id, source, submitted_by_user_id, raw_data, source_url,
                       adresse, plz, ort, angebotstyp
                FROM real_estate_listings
                WHERE id = $1::uuid
                """

_EXISTING_LISTING_BY_IDENTITY_SQL = """
                SELECT id, external_id, source, submitted_by_user_id, raw_data, source_url,
                       adresse, plz, ort, angebotstyp
                FROM real_estate_listings
                WHERE external_id = ANY($1::text[])
                   OR source_url = ANY($1::text[])
                   OR (
                     cardinality($2::text[]) > 0
                     AND EXISTS (
                       SELECT 1
                       FROM unnest($2::text[]) AS pat
                       WHERE external_id LIKE pat ESCAPE '\\'
                          OR source_url LIKE pat ESCAPE '\\'
                     )
                   )
                ORDER BY first_seen_at ASC NULLS LAST, id ASC
                LIMIT 20
                """


def _like_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _load_existing_listing(conn, external_id: str, source: str):
    return await conn.fetchrow(_EXISTING_LISTING_SQL, external_id, source)


async def _load_existing_listing_by_id(conn, listing_id: str):
    try:
        uuid.UUID(str(listing_id))
    except (TypeError, ValueError):
        return None
    return await conn.fetchrow(_EXISTING_LISTING_BY_ID_SQL, listing_id)


async def _load_existing_listings_matching_identity(conn, source_url: str):
    exact = listing_url_lookup_variants(source_url)
    likes = []
    for prefix in listing_url_leftover_prefixes(source_url):
        escaped = _like_literal(prefix)
        likes.append(f"{escaped}?%")
        likes.append(f"{escaped}#%")
    return await conn.fetch(_EXISTING_LISTING_BY_IDENTITY_SQL, exact, likes)


async def _resolve_listing_row(
    conn,
    source_url: str,
    source: str,
    user_id: Optional[str],
    stored_meta: dict,
    expected_listing_id: Optional[str] = None,
):
    if expected_listing_id:
        existing = await _load_existing_listing_by_id(conn, expected_listing_id)
        if existing and blocks_cross_user_private_update(
            existing["submitted_by_user_id"],
            existing["raw_data"],
            user_id,
            stored_meta,
            existing["source_url"],
            source_url,
        ):
            existing = None
        if existing:
            return str(existing["external_id"]), existing["source"], existing
        return listing_external_id(source_url, user_id, stored_meta), source, None
    for cand_url in listing_url_lookup_variants(source_url):
        cand_source = urlparse(cand_url.partition(OWNER_EXTERNAL_ID_MARKER)[0]).netloc or source
        seen_ids: list[str] = []
        for external_id in (
            listing_external_id(cand_url, user_id, stored_meta),
            cand_url,
            owner_scoped_external_id(cand_url, user_id),
        ):
            if external_id in seen_ids:
                continue
            seen_ids.append(external_id)
            existing = await _load_existing_listing(conn, external_id, cand_source)
            if existing and blocks_cross_user_private_update(
                existing["submitted_by_user_id"],
                existing["raw_data"],
                user_id,
                stored_meta,
                existing["source_url"],
                cand_url,
            ):
                continue
            if existing:
                return str(existing["external_id"]), existing["source"], existing
    incoming_ident = listing_url_identity_base(source_url)
    for existing in await _load_existing_listings_matching_identity(conn, source_url):
        row_idents = {
            listing_url_identity_base(existing["external_id"] or ""),
            listing_url_identity_base(existing["source_url"] or ""),
        }
        if incoming_ident not in row_idents:
            continue
        if blocks_cross_user_private_update(
            existing["submitted_by_user_id"],
            existing["raw_data"],
            user_id,
            stored_meta,
            existing["source_url"],
            source_url,
        ):
            continue
        return str(existing["external_id"]), existing["source"], existing
    return listing_external_id(source_url, user_id, stored_meta), source, None


async def peek_existing_real_estate_state(
    source_url: str,
    source: str,
    user_id: Optional[str],
    scrape_metadata: Optional[dict] = None,
    expected_listing_id: Optional[str] = None,
) -> tuple[
    Optional[str],
    tuple[Optional[str], Optional[str], Optional[str]] | None,
    Optional[str],
]:
    source_url = strip_sensitive_query(source_url)
    stored_meta = scrape_metadata if isinstance(scrape_metadata, dict) else {}
    conn = await get_connection()
    try:
        _, _, existing = await _resolve_listing_row(
            conn,
            source_url,
            source,
            user_id,
            stored_meta,
            expected_listing_id=expected_listing_id,
        )
        if not existing:
            return None, None, None
        typ = (existing["angebotstyp"] or "").strip()
        return (
            typ if typ in ("kauf", "miete") else None,
            (existing["adresse"], existing["plz"], existing["ort"]),
            str(existing["id"]),
        )
    finally:
        await release_connection(conn)


async def peek_existing_real_estate_angebotstyp(
    source_url: str,
    source: str,
    user_id: Optional[str],
    scrape_metadata: Optional[dict] = None,
) -> Optional[str]:
    typ, _previous, _listing_id = await peek_existing_real_estate_state(
        source_url, source, user_id, scrape_metadata
    )
    return typ


async def _upsert_real_estate_listing_on_conn(
    conn,
    extraction: CustomListingExtraction,
    source_url: str,
    source: str,
    user_id: Optional[str],
    scrape_metadata: Optional[dict] = None,
    expected_listing_id: Optional[str] = None,
) -> tuple[str, tuple[Optional[str], Optional[str], Optional[str]] | None, Optional[str]]:
    """
    Speichert/aktualisiert ein Custom-URL-Listing. Conflict-Key
    (external_id, source) - für öffentliche Live-Fetches ist external_id die
    normalisierte Quell-URL, für Cookie-/HTML-/PDF-Einreichungen
    URL#owner:<user> damit private Inhalte nicht über Dedupe fremde Zeilen
    überschreiben. Ein erneutes Einreichen derselben öffentlichen URL
    aktualisiert die bestehende Zeile (Refresh), OHNE submitted_by_user_id
    des ursprünglichen Einreichers zu überschreiben (Verlauf über
    custom_url_requests, siehe log_custom_url_request()).
    """
    titel = _blank_to_none(extraction.titel)
    typ = _blank_to_none(extraction.typ)
    adresse = _blank_to_none(extraction.adresse)
    plz = _blank_to_none(extraction.plz)
    ort = _blank_to_none(extraction.ort)
    etage = _blank_to_none(extraction.etage)
    effizienzklasse = _blank_to_none(extraction.effizienzklasse)
    energieausweis_typ = _blank_to_none(extraction.energieausweis_typ)
    heizung = _blank_to_none(extraction.heizung)
    zustand_kurz = _blank_to_none(extraction.zustand_kurz)
    wohnflaeche_m2 = _positive_or_none(extraction.flaeche_m2)
    grundstuecksflaeche_m2 = _positive_or_none(extraction.grundstuecksflaeche_m2)
    nutzflaeche_m2 = _positive_or_none(extraction.nutzflaeche_m2)
    zimmer = _positive_or_none(extraction.zimmer)
    anzahl_etagen = _positive_or_none(extraction.anzahl_etagen)
    preis = int(extraction.preis) if extraction.preis else None
    baujahr = int(extraction.baujahr) if extraction.baujahr else None
    endenergiebedarf_kwh = _positive_or_none(extraction.endenergiebedarf_kwh)
    hausgeld_eur = _positive_or_none(extraction.hausgeld_eur)
    kaltmiete_eur = _positive_or_none(extraction.kaltmiete_eur)
    preis_pro_m2 = round(preis / wohnflaeche_m2, 2) if preis and wohnflaeche_m2 else None

    # cover_image_url wird bewusst NICHT hier gesetzt (mehr die externe
    # Quell-URL aus extraction.bilder[0] - Hotlinking auf Fremdportale ist
    # unzuverlässig/CORS-anfällig). Wird stattdessen NACH dem Bild-Upload
    # nach MinIO in replace_real_estate_images() auf die hochgeladene
    # public_url des ersten Bilds gesetzt. Beim Refresh bleibt ein
    # vorheriger Wert dank COALESCE unten erhalten, bis der neue Upload
    # durchläuft.
    source_url = strip_sensitive_query(source_url)
    stored_meta = scrape_metadata if isinstance(scrape_metadata, dict) else {}
    raw_data: dict = {"quelle": "custom-url-analyse"}
    beschreibung = _blank_to_none(extraction.beschreibung)
    if beschreibung:
        raw_data["beschreibung"] = beschreibung
    if extraction.bilder:
        raw_data["bilder"] = extraction.bilder
    if stored_meta:
        raw_data["scrape_metadata"] = stored_meta

    await conn.execute(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        f"re-listing:{listing_url_identity(source_url)}",
    )
    external_id, source, existing = await _resolve_listing_row(
        conn,
        source_url,
        source,
        user_id,
        stored_meta,
        expected_listing_id=expected_listing_id,
    )
    existing_id = str(existing["id"]) if existing else None
    if refresh_target_gone(existing_id, expected_listing_id):
        raise RealEstateListingGoneError(expected_listing_id)

    row = await conn.fetchrow(
        """
            INSERT INTO real_estate_listings (
                external_id, source, source_url, typ, angebotstyp, titel,
                adresse, plz, ort, preis, preis_pro_m2, wohnflaeche_m2,
                grundstuecksflaeche_m2, nutzflaeche_m2, zimmer, etage, anzahl_etagen,
                baujahr, effizienzklasse, energieausweis_typ, endenergiebedarf_kwh,
                heizung, denkmalschutz, vermietet, hausgeld_eur, kaltmiete_eur,
                zustand_kurz, cover_image_url, raw_data, submitted_by_user_id, last_seen_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18, $19, $20, $21,
                $22, $23, $24, $25, $26, $27, $28, $29::jsonb, $30::uuid, NOW()
            )
            ON CONFLICT (external_id, source) DO UPDATE SET
                titel = COALESCE(NULLIF(BTRIM(EXCLUDED.titel), ''), real_estate_listings.titel),
                typ = COALESCE(NULLIF(BTRIM(EXCLUDED.typ), ''), real_estate_listings.typ),
                angebotstyp = CASE
                  WHEN EXCLUDED.angebotstyp IS NOT NULL
                   AND EXCLUDED.angebotstyp IS DISTINCT FROM real_estate_listings.angebotstyp
                   AND (
                     (EXCLUDED.angebotstyp = 'miete' AND (
                       EXCLUDED.preis IS NOT NULL OR EXCLUDED.kaltmiete_eur IS NOT NULL
                     ))
                     OR (EXCLUDED.angebotstyp = 'kauf' AND EXCLUDED.preis IS NOT NULL)
                   )
                  THEN EXCLUDED.angebotstyp
                  ELSE COALESCE(real_estate_listings.angebotstyp, EXCLUDED.angebotstyp)
                END,
                adresse = CASE
                  WHEN NULLIF(BTRIM(EXCLUDED.ort), '') IS NOT NULL
                   AND NULLIF(BTRIM(real_estate_listings.ort), '') IS NOT NULL
                   AND replace(replace(replace(replace(LOWER(BTRIM(EXCLUDED.ort)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
                       IS DISTINCT FROM replace(replace(replace(replace(LOWER(BTRIM(real_estate_listings.ort)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
                  THEN NULLIF(BTRIM(EXCLUDED.adresse), '')
                  WHEN NULLIF(BTRIM(EXCLUDED.plz), '') IS NOT NULL
                   AND NULLIF(BTRIM(real_estate_listings.plz), '') IS NOT NULL
                   AND BTRIM(EXCLUDED.plz) IS DISTINCT FROM BTRIM(real_estate_listings.plz)
                   AND NULLIF(BTRIM(EXCLUDED.adresse), '') IS NULL
                  THEN NULL
                  ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.adresse), ''), real_estate_listings.adresse)
                END,
                plz = CASE
                  WHEN NULLIF(BTRIM(EXCLUDED.ort), '') IS NOT NULL
                   AND NULLIF(BTRIM(real_estate_listings.ort), '') IS NOT NULL
                   AND replace(replace(replace(replace(LOWER(BTRIM(EXCLUDED.ort)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
                       IS DISTINCT FROM replace(replace(replace(replace(LOWER(BTRIM(real_estate_listings.ort)), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss')
                  THEN NULLIF(BTRIM(EXCLUDED.plz), '')
                  ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.plz), ''), real_estate_listings.plz)
                END,
                ort = CASE
                  WHEN NULLIF(BTRIM(EXCLUDED.plz), '') IS NOT NULL
                   AND NULLIF(BTRIM(real_estate_listings.plz), '') IS NOT NULL
                   AND BTRIM(EXCLUDED.plz) IS DISTINCT FROM BTRIM(real_estate_listings.plz)
                   AND NULLIF(BTRIM(EXCLUDED.ort), '') IS NULL
                  THEN NULL
                  ELSE COALESCE(NULLIF(BTRIM(EXCLUDED.ort), ''), real_estate_listings.ort)
                END,
                preis = CASE
                  WHEN EXCLUDED.angebotstyp IS NOT NULL
                   AND EXCLUDED.angebotstyp IS DISTINCT FROM real_estate_listings.angebotstyp
                   AND NOT (
                     (EXCLUDED.angebotstyp = 'kauf' AND EXCLUDED.preis IS NOT NULL)
                     OR (EXCLUDED.angebotstyp = 'miete' AND (
                       EXCLUDED.preis IS NOT NULL OR EXCLUDED.kaltmiete_eur IS NOT NULL
                     ))
                   )
                  THEN real_estate_listings.preis
                  WHEN EXCLUDED.angebotstyp IS NOT NULL
                   AND EXCLUDED.angebotstyp IS DISTINCT FROM real_estate_listings.angebotstyp
                   AND EXCLUDED.angebotstyp = 'miete'
                  THEN EXCLUDED.preis
                  ELSE COALESCE(EXCLUDED.preis, real_estate_listings.preis)
                END,
                wohnflaeche_m2 = COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0), real_estate_listings.wohnflaeche_m2),
                grundstuecksflaeche_m2 = COALESCE(NULLIF(EXCLUDED.grundstuecksflaeche_m2, 0), real_estate_listings.grundstuecksflaeche_m2),
                nutzflaeche_m2 = COALESCE(NULLIF(EXCLUDED.nutzflaeche_m2, 0), real_estate_listings.nutzflaeche_m2),
                zimmer = COALESCE(NULLIF(EXCLUDED.zimmer, 0), real_estate_listings.zimmer),
                etage = COALESCE(NULLIF(BTRIM(EXCLUDED.etage), ''), real_estate_listings.etage),
                anzahl_etagen = COALESCE(NULLIF(EXCLUDED.anzahl_etagen, 0), real_estate_listings.anzahl_etagen),
                baujahr = COALESCE(EXCLUDED.baujahr, real_estate_listings.baujahr),
                effizienzklasse = COALESCE(NULLIF(BTRIM(EXCLUDED.effizienzklasse), ''), real_estate_listings.effizienzklasse),
                energieausweis_typ = COALESCE(NULLIF(BTRIM(EXCLUDED.energieausweis_typ), ''), real_estate_listings.energieausweis_typ),
                endenergiebedarf_kwh = COALESCE(NULLIF(EXCLUDED.endenergiebedarf_kwh, 0), real_estate_listings.endenergiebedarf_kwh),
                heizung = COALESCE(NULLIF(BTRIM(EXCLUDED.heizung), ''), real_estate_listings.heizung),
                denkmalschutz = CASE
                  WHEN EXCLUDED.denkmalschutz IS NULL THEN real_estate_listings.denkmalschutz
                  WHEN real_estate_listings.denkmalschutz IS TRUE THEN TRUE
                  ELSE EXCLUDED.denkmalschutz
                END,
                vermietet = CASE
                  WHEN EXCLUDED.vermietet IS NULL THEN real_estate_listings.vermietet
                  WHEN real_estate_listings.vermietet IS TRUE THEN TRUE
                  ELSE EXCLUDED.vermietet
                END,
                hausgeld_eur = COALESCE(NULLIF(EXCLUDED.hausgeld_eur, 0), real_estate_listings.hausgeld_eur),
                kaltmiete_eur = CASE
                  WHEN EXCLUDED.angebotstyp IS NOT NULL
                   AND EXCLUDED.angebotstyp IS DISTINCT FROM real_estate_listings.angebotstyp
                   AND NOT (
                     (EXCLUDED.angebotstyp = 'miete' AND (
                       EXCLUDED.preis IS NOT NULL OR EXCLUDED.kaltmiete_eur IS NOT NULL
                     ))
                     OR (EXCLUDED.angebotstyp = 'kauf' AND EXCLUDED.preis IS NOT NULL)
                   )
                  THEN real_estate_listings.kaltmiete_eur
                  WHEN EXCLUDED.angebotstyp IS NOT NULL
                   AND EXCLUDED.angebotstyp IS DISTINCT FROM real_estate_listings.angebotstyp
                   AND EXCLUDED.angebotstyp = 'miete'
                  THEN COALESCE(NULLIF(EXCLUDED.kaltmiete_eur, 0), EXCLUDED.preis)
                  WHEN EXCLUDED.angebotstyp IS NOT NULL
                   AND EXCLUDED.angebotstyp IS DISTINCT FROM real_estate_listings.angebotstyp
                   AND EXCLUDED.angebotstyp = 'kauf'
                   AND EXCLUDED.preis IS NOT NULL
                  THEN NULLIF(EXCLUDED.kaltmiete_eur, 0)
                  ELSE COALESCE(NULLIF(EXCLUDED.kaltmiete_eur, 0), real_estate_listings.kaltmiete_eur)
                END,
                zustand_kurz = COALESCE(NULLIF(BTRIM(EXCLUDED.zustand_kurz), ''), real_estate_listings.zustand_kurz),
                preis_pro_m2 = CASE
                  WHEN EXCLUDED.angebotstyp IS NOT NULL
                   AND EXCLUDED.angebotstyp IS DISTINCT FROM real_estate_listings.angebotstyp
                   AND NOT (
                     (EXCLUDED.angebotstyp = 'miete' AND (
                       EXCLUDED.preis IS NOT NULL OR EXCLUDED.kaltmiete_eur IS NOT NULL
                     ))
                     OR (EXCLUDED.angebotstyp = 'kauf' AND EXCLUDED.preis IS NOT NULL)
                   )
                  THEN real_estate_listings.preis_pro_m2
                  WHEN EXCLUDED.angebotstyp IS NOT NULL
                   AND EXCLUDED.angebotstyp IS DISTINCT FROM real_estate_listings.angebotstyp
                   AND EXCLUDED.angebotstyp = 'miete'
                   AND EXCLUDED.preis IS NULL
                  THEN EXCLUDED.preis_pro_m2
                  WHEN COALESCE(EXCLUDED.preis, real_estate_listings.preis) IS NOT NULL
                   AND COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0), real_estate_listings.wohnflaeche_m2) > 0
                   AND (
                     EXCLUDED.angebotstyp IS NOT DISTINCT FROM 'kauf'
                     OR EXCLUDED.angebotstyp IS NOT DISTINCT FROM 'miete'
                     OR (
                       EXCLUDED.angebotstyp IS NULL
                       AND real_estate_listings.angebotstyp IS NOT DISTINCT FROM 'kauf'
                     )
                   )
                  THEN ROUND(
                    COALESCE(EXCLUDED.preis, real_estate_listings.preis)::numeric
                    / COALESCE(NULLIF(EXCLUDED.wohnflaeche_m2, 0), real_estate_listings.wohnflaeche_m2),
                    2)
                  ELSE COALESCE(EXCLUDED.preis_pro_m2, real_estate_listings.preis_pro_m2)
                END,
                cover_image_url = COALESCE(EXCLUDED.cover_image_url, real_estate_listings.cover_image_url),
                raw_data = COALESCE(real_estate_listings.raw_data, '{}'::jsonb) || EXCLUDED.raw_data,
                last_seen_at = NOW(),
                ist_aktiv = CASE
                  WHEN COALESCE(EXCLUDED.raw_data#>>'{scrape_metadata,fetch_source}', '')
                         IN ('http', 'scrapling')
                   AND lower(COALESCE(EXCLUDED.raw_data#>>'{scrape_metadata,session_cookie_used}', ''))
                         NOT IN ('true', 't', '1')
                   AND COALESCE(EXCLUDED.source_url, '')
                         NOT LIKE $31
                  THEN TRUE
                  ELSE real_estate_listings.ist_aktiv
                END
            RETURNING id, angebotstyp
            """,
        external_id,
        source,
        source_url,
        typ,
        extraction.angebotstyp,
        titel,
        adresse,
        plz,
        ort,
        preis,
        preis_pro_m2,
        wohnflaeche_m2,
        grundstuecksflaeche_m2,
        nutzflaeche_m2,
        zimmer,
        etage,
        anzahl_etagen,
        baujahr,
        effizienzklasse,
        energieausweis_typ,
        endenergiebedarf_kwh,
        heizung,
        extraction.denkmalschutz,
        extraction.vermietet,
        hausgeld_eur,
        kaltmiete_eur,
        zustand_kurz,
        None,
        json.dumps(raw_data),
        user_id,
        f"%//{MANUAL_UPLOAD_HOST}/%",
    )
    listing_id = str(row["id"])
    await _maybe_canonicalize_listing_identity(
        conn, listing_id, source_url, source, user_id, stored_meta, existing
    )
    previous = None
    if existing and str(existing["id"]) == listing_id:
        previous = (existing["adresse"], existing["plz"], existing["ort"])
    persisted_angebotstyp = row["angebotstyp"]
    return listing_id, previous, persisted_angebotstyp


async def _maybe_canonicalize_listing_identity(
    conn,
    listing_id: str,
    source_url: str,
    source: str,
    user_id: Optional[str],
    stored_meta: dict,
    existing,
) -> None:
    if not existing:
        return
    canonical_id = listing_external_id(source_url, user_id, stored_meta)
    canonical_url = listing_url_identity_base(source_url)
    canonical_source = urlparse(canonical_url).netloc or source
    if (
        str(existing["external_id"]) == canonical_id
        and existing["source"] == canonical_source
        and (existing["source_url"] or "") == canonical_url
    ):
        return
    collision = await conn.fetchval(
        """
        SELECT id FROM real_estate_listings
        WHERE external_id = $1 AND source = $2 AND id <> $3::uuid
        LIMIT 1
        """,
        canonical_id,
        canonical_source,
        listing_id,
    )
    if collision:
        return
    await conn.execute(
        """
        UPDATE real_estate_listings
        SET external_id = $2, source = $3, source_url = $4
        WHERE id = $1::uuid
        """,
        listing_id,
        canonical_id,
        canonical_source,
        canonical_url,
    )


async def upsert_real_estate_listing(
    extraction: CustomListingExtraction,
    source_url: str,
    source: str,
    user_id: Optional[str],
    scrape_metadata: Optional[dict] = None,
) -> tuple[str, tuple[Optional[str], Optional[str], Optional[str]] | None, Optional[str]]:
    conn = await get_connection()
    try:
        async with conn.transaction():
            return await _upsert_real_estate_listing_on_conn(
                conn, extraction, source_url, source, user_id, scrape_metadata
            )
    finally:
        await release_connection(conn)


async def update_listing_geo(listing_id: str, lat: float, lng: float) -> None:
    """Setzt lat/lng nach erfolgreichem Geocoding (Nominatim)."""
    if not is_usable_geo_point(lat, lng):
        return
    conn = await get_connection()
    try:
        await conn.execute(
            """
            UPDATE real_estate_listings
            SET lat = $2, lng = $3
            WHERE id = $1::uuid
            """,
            listing_id,
            lat,
            lng,
        )
    finally:
        await release_connection(conn)


async def clear_listing_geo(listing_id: str) -> None:
    """Löscht gespeicherte Koordinaten, wenn die Adresse gewechselt hat
    und die Neuanalyse keinen belastbaren Punkt liefert."""
    conn = await get_connection()
    try:
        await conn.execute(
            """
            UPDATE real_estate_listings
            SET lat = NULL, lng = NULL
            WHERE id = $1::uuid
            """,
            listing_id,
        )
    finally:
        await release_connection(conn)


async def insert_real_estate_ki_analyse(
    listing_id: str,
    analyse: CustomMarketAnalyse,
    model_used: str,
    tokens_used: int = 0,
    fix_flip_gesamtkosten_min_eur: Optional[int] = None,
    fix_flip_gesamtkosten_max_eur: Optional[int] = None,
    fix_flip_deal: Optional[dict] = None,
    orte_in_der_naehe: Optional[list] = None,
) -> None:
    """Fügt eine neue Markt-Analyse für ein Custom-URL-Listing hinzu (append,
    kein Conflict-Key - jede erneute Einreichung erzeugt einen neuen Eintrag,
    die Verlaufsansicht zeigt die jeweils neueste Analyse pro Listing).

    fix_flip_gesamtkosten_min_eur/_max_eur werden vom Aufrufer (src/api/app.py)
    SERVERSEITIG aus analyse.fix_flip_massnahmen aufsummiert übergeben (nicht
    von der KI selbst addieren lassen, um Rechenfehler auszuschließen).

    fix_flip_deal: optionales dict mit den geschätzten Flip-Fakten (ARV,
    Haltedauer, Konfidenz) aus src/api/app.py::_estimate_and_calc_fix_flip_deal
    - None, wenn fix_flip_massnahmen leer war. Gewinn, ROI und Marge stehen
    hier bewusst nicht mehr: sie kommen aus apps/web/lib/underwriting.

    orte_in_der_naehe: POIs aus Overpass (nach Geocoding), analog ZVG."""
    conn = await get_connection()
    try:
        await _insert_real_estate_ki_analyse_on_conn(
            conn,
            listing_id,
            analyse,
            model_used,
            tokens_used,
            fix_flip_gesamtkosten_min_eur,
            fix_flip_gesamtkosten_max_eur,
            fix_flip_deal,
            orte_in_der_naehe,
        )
    finally:
        await release_connection(conn)


async def _insert_real_estate_ki_analyse_on_conn(
    conn,
    listing_id: str,
    analyse: CustomMarketAnalyse,
    model_used: str,
    tokens_used: int = 0,
    fix_flip_gesamtkosten_min_eur: Optional[int] = None,
    fix_flip_gesamtkosten_max_eur: Optional[int] = None,
    fix_flip_deal: Optional[dict] = None,
    orte_in_der_naehe: Optional[list] = None,
) -> None:
    deal = fix_flip_deal or {}
    model_used = with_schema_version(model_used)
    await conn.execute(
        """
            INSERT INTO real_estate_ki_analyses (
                listing_id, preis_bewertung, preis_abweichung_pct, staerken,
                schwaechen, lage_bewertung, rendite_geschaetzt_pct,
                zusammenfassung, investment_score, investment_score_begruendung,
                risiken_investor, cashflow_einschaetzung,
                fix_flip_massnahmen, fix_flip_werteinschaetzung,
                fix_flip_gesamtkosten_min_eur, fix_flip_gesamtkosten_max_eur,
                arv_min_eur, arv_max_eur, arv_begruendung, arv_konfidenz, holding_monate,
                maengel, modernisierungen,
                energieausweis_vorhanden, effizienzklasse, ausweisjahr,
                energietraeger, endenergieverbrauch_kwh,
                innenbesichtigung, restnutzungsdauer_j, heizung, wohnraeume,
                zustand_aussen, zustand_innen, maengel_kurz,
                baubeschreibung, instandhaltung,
                lage_einwohner, lage_region, lage_verkehr, lage_charakter, lage_umgebung,
                moegliche_kaltmiete, hausgeld, jahresrohertrag,
                liegenschaftszinssatz, ertragswert,
                bodenrichtwert_eur_m2, bodenrichtwert_stichtag, bodenrichtwert_berechnung,
                orte_in_der_naehe,
                model_used, tokens_used
            ) VALUES (
                $1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb, $12,
                $13::jsonb, $14, $15, $16,
                $17, $18, $19, $20, $21,
                $22::jsonb, $23::jsonb,
                $24, $25, $26, $27, $28,
                $29, $30, $31, $32,
                $33, $34, $35,
                $36, $37,
                $38, $39, $40, $41, $42,
                $43, $44, $45, $46, $47,
                $48, $49, $50,
                $51::jsonb,
                $52, $53
            )
            """,
        listing_id,
        analyse.preis_bewertung,
        analyse.preis_abweichung_pct,
        json.dumps(analyse.staerken),
        json.dumps(analyse.schwaechen),
        analyse.lage_bewertung,
        analyse.rendite_geschaetzt_pct,
        analyse.zusammenfassung,
        analyse.investment_score,
        analyse.investment_score_begruendung,
        json.dumps(analyse.risiken_investor),
        analyse.cashflow_einschaetzung,
        json.dumps([m.model_dump() for m in analyse.fix_flip_massnahmen]),
        analyse.fix_flip_werteinschaetzung,
        fix_flip_gesamtkosten_min_eur,
        fix_flip_gesamtkosten_max_eur,
        deal.get("arv_min_eur"),
        deal.get("arv_max_eur"),
        deal.get("arv_begruendung"),
        deal.get("arv_konfidenz"),
        deal.get("holding_monate"),
        json.dumps([m.model_dump() for m in analyse.maengel]),
        json.dumps([m.model_dump() for m in analyse.modernisierungen]),
        analyse.energieausweis_vorhanden,
        analyse.effizienzklasse,
        analyse.ausweisjahr,
        analyse.energietraeger,
        analyse.endenergieverbrauch_kwh,
        analyse.innenbesichtigung,
        analyse.restnutzungsdauer_j,
        analyse.heizung,
        analyse.wohnraeume,
        analyse.zustand_aussen,
        analyse.zustand_innen,
        analyse.maengel_kurz,
        analyse.baubeschreibung,
        analyse.instandhaltung,
        analyse.lage_einwohner,
        analyse.lage_region,
        analyse.lage_verkehr,
        analyse.lage_charakter,
        analyse.lage_umgebung,
        analyse.moegliche_kaltmiete,
        analyse.hausgeld,
        analyse.jahresrohertrag,
        analyse.liegenschaftszinssatz,
        analyse.ertragswert,
        analyse.bodenrichtwert_eur_m2,
        analyse.bodenrichtwert_stichtag,
        analyse.bodenrichtwert_berechnung,
        json.dumps(orte_in_der_naehe or []),
        model_used,
        tokens_used,
    )


async def persist_custom_url_listing_and_ki(
    extraction: CustomListingExtraction,
    source_url: str,
    source: str,
    user_id: Optional[str],
    scrape_metadata: Optional[dict] = None,
    *,
    expected_listing_id: Optional[str] = None,
    analyse: CustomMarketAnalyse,
    model_used: str,
    tokens_used: int = 0,
    fix_flip_gesamtkosten_min_eur: Optional[int] = None,
    fix_flip_gesamtkosten_max_eur: Optional[int] = None,
    fix_flip_deal: Optional[dict] = None,
    orte_in_der_naehe: Optional[list] = None,
    lat_lng: Optional[tuple[float, float]] = None,
    clear_geo: bool = False,
) -> tuple[str, tuple[Optional[str], Optional[str], Optional[str]] | None, Optional[str]]:
    conn = await get_connection()
    try:
        async with conn.transaction():
            listing_id, previous, persisted = await _upsert_real_estate_listing_on_conn(
                conn,
                extraction,
                source_url,
                source,
                user_id,
                scrape_metadata,
                expected_listing_id=expected_listing_id,
            )
            if lat_lng and is_usable_geo_point(lat_lng[0], lat_lng[1]):
                await conn.execute(
                    """
                    UPDATE real_estate_listings
                    SET lat = $2, lng = $3
                    WHERE id = $1::uuid
                    """,
                    listing_id,
                    lat_lng[0],
                    lat_lng[1],
                )
            elif clear_geo:
                await conn.execute(
                    """
                    UPDATE real_estate_listings
                    SET lat = NULL, lng = NULL
                    WHERE id = $1::uuid
                    """,
                    listing_id,
                )
            await _insert_real_estate_ki_analyse_on_conn(
                conn,
                listing_id,
                analyse,
                model_used,
                tokens_used,
                fix_flip_gesamtkosten_min_eur,
                fix_flip_gesamtkosten_max_eur,
                fix_flip_deal,
                orte_in_der_naehe,
            )
            return listing_id, previous, persisted
    finally:
        await release_connection(conn)


async def count_real_estate_images(listing_id: str) -> int:
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            "SELECT count(*)::int AS n FROM real_estate_images WHERE listing_id = $1::uuid",
            listing_id,
        )
        return int(row["n"]) if row and row["n"] is not None else 0
    finally:
        await release_connection(conn)


async def replace_real_estate_images(listing_id: str, images: list[tuple[str, str, int]]) -> None:
    """Ersetzt alle Bilder eines Listings (Refresh derselben URL: alte Bilder
    werden vorher gelöscht, damit keine Duplikate/verwaisten Zeilen entstehen).
    images: Liste von (storage_path, public_url, position).
    Leere Liste: bestehende Galerie behalten — ein Refresh ohne Fotos
    darf keine vorhandene Galerie löschen."""
    if not images:
        return
    from src.storage.minio import BUCKET_NAME, get_minio_client

    conn = await get_connection()
    old_paths: list[str] = []
    try:
        async with conn.transaction():
            rows = await conn.fetch(
                "SELECT storage_path FROM real_estate_images WHERE listing_id = $1::uuid",
                listing_id,
            )
            old_paths = [r["storage_path"] for r in rows if r.get("storage_path")]
            await conn.execute(
                "DELETE FROM real_estate_images WHERE listing_id = $1::uuid", listing_id
            )
            if images:
                await conn.executemany(
                    """
                    INSERT INTO real_estate_images (listing_id, storage_path, public_url, position)
                    VALUES ($1::uuid, $2, $3, $4)
                    """,
                    [(listing_id, path, url, pos) for path, url, pos in images],
                )
                await conn.execute(
                    "UPDATE real_estate_listings SET cover_image_url = $2 WHERE id = $1::uuid",
                    listing_id,
                    images[0][1],
                )
    finally:
        await release_connection(conn)

    keep = {path for path, _url, _pos in images}
    orphans = [
        p for p in old_paths if p not in keep and is_listing_owned_storage_path(listing_id, p)
    ]
    skipped = [p for p in old_paths if p not in keep and p not in orphans]
    if skipped:
        logger.warning(
            f"MinIO-Orphan-Cleanup übersprungen (Pfad nicht listing-gebunden): {skipped}"
        )
    if orphans:
        try:
            client = get_minio_client()
            for path in orphans:
                try:
                    client.remove_object(BUCKET_NAME, path)
                except Exception as e:
                    logger.warning(f"MinIO-Orphan-Cleanup fehlgeschlagen ({path}): {e}")
        except Exception as e:
            logger.warning(f"MinIO-Client für Orphan-Cleanup fehlgeschlagen: {e}")


async def update_cover_image_url(listing_id: str, cover_image_url: str) -> None:
    """Setzt cover_image_url auf die hochgeladene public_url des ersten Bilds
    (nachträglich, da der Upload erst nach upsert_real_estate_listing läuft)."""
    conn = await get_connection()
    try:
        await conn.execute(
            "UPDATE real_estate_listings SET cover_image_url = $2 WHERE id = $1::uuid",
            listing_id,
            cover_image_url,
        )
    finally:
        await release_connection(conn)


async def get_custom_url_listings_for_reanalysis(limit: int = 50, offset: int = 0) -> list[dict]:
    """Aktive Custom-URL-Listings für die erneute Analyse (Teil A Punkt 4).
    Die eigentliche Re-Analyse läuft über run_custom_url_analysis (erneuter
    Live-Fetch + Extraktion + Markt-/Investment-Analyse + Fix&Flip-Deal +
    DB-Upsert), NICHT nur über den gespeicherten DB-Text - submitted_by_user_id
    bleibt dabei erhalten (an run_custom_url_analysis durchgereicht).

    Schließt Listings aus HTML-Einfügung/PDF-Upload und Cookie-Sitzungen aus
    (Phase 3): ohne den ursprünglichen Inhalt/Cookie wäre ein erneuter
    Live-Fetch entweder tot oder würde ein anderes (oft gesperrtes) Ergebnis
    über die bestehende Analyse schreiben."""
    conn = await get_connection()
    try:
        rows = await conn.fetch(
            """
            SELECT id, source_url, submitted_by_user_id
            FROM real_estate_listings
            WHERE ist_aktiv = TRUE
              AND source_url NOT LIKE $3
              AND COALESCE(raw_data#>>'{scrape_metadata,fetch_source}', '')
                    IN ('http', 'scrapling')
              AND lower(COALESCE(raw_data#>>'{scrape_metadata,session_cookie_used}', ''))
                    NOT IN ('true', 't', '1')
            ORDER BY last_seen_at DESC NULLS LAST, id DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
            f"%//{MANUAL_UPLOAD_HOST}/%",
        )
        return [dict(r) for r in rows]
    finally:
        await release_connection(conn)


async def custom_listing_exists(listing_id: str) -> bool:
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            "SELECT 1 FROM real_estate_listings WHERE id = $1::uuid",
            listing_id,
        )
        return row is not None
    finally:
        await release_connection(conn)


async def log_custom_url_request(
    user_id: Optional[str],
    url: str,
    status: str,
    error_message: Optional[str] = None,
    listing_id: Optional[str] = None,
) -> None:
    """
    Protokolliert JEDEN Custom-URL-Analyse-Versuch (Erfolg wie Fehler) -
    Audit-Log ohne Rate-Limit-Enforcement für v1, aber vorbereitet dafür
    (siehe Plan). Wirft absichtlich NIE - ein Logging-Fehler darf den
    eigentlichen Analyse-Flow nicht zum Absturz bringen.
    """
    conn = await get_connection()
    try:
        await conn.execute(
            """
            INSERT INTO custom_url_requests (user_id, url, status, error_message, listing_id, updated_at)
            VALUES ($1::uuid, $2, $3, $4, $5::uuid, NOW())
            """,
            user_id,
            strip_sensitive_query(url),
            status,
            error_message,
            listing_id,
        )
    except Exception as e:
        logger.error(
            f"Fehler beim Protokollieren von custom_url_requests ({log_safe_url(url)}): {e}"
        )
    finally:
        await release_connection(conn)


class AnalyseDailyQuotaExceeded(Exception):
    def __init__(self, limit: int):
        self.limit = limit
        super().__init__(f"Tageslimit von {limit} Analysen erreicht")


async def claim_queued_analyse_job(job_id: str) -> Optional[dict]:
    """Übernimmt genau einmal einen von der Web-App angelegten queued Job."""
    conn = await get_connection()
    try:
        row = await conn.fetchrow(
            """
            UPDATE custom_url_requests
            SET status = 'running',
                step = 'accepted',
                step_detail = 'Analyse übernommen',
                updated_at = NOW()
            WHERE id = $1::uuid
              AND status = 'queued'
              AND user_id IS NOT NULL
              AND COALESCE(step, 'queued') = 'queued'
            RETURNING id, user_id, url, listing_id
            """,
            job_id,
        )
        return dict(row) if row else None
    finally:
        await release_connection(conn)


ANALYSE_HISTORY_KEEP_SUCCESS = 200
ANALYSE_ERROR_RETENTION_DAYS = 90


async def try_create_analyse_job(
    user_id: str,
    url: str,
    *,
    max_active: int = 2,
    max_per_day: int | None = None,
) -> Optional[str]:
    """Atomisches Anlegen unter Advisory-Lock; None wenn Parallel-Limit erreicht."""
    entry = json.dumps(
        [
            {
                "t": datetime.now(timezone.utc).isoformat(),
                "msg": "Analyse vorbereitet",
                "kind": "line",
            }
        ]
    )
    conn = await get_connection()
    try:
        async with conn.transaction():
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtext($1))",
                f"analyse-jobs:{user_id}",
            )
            await conn.execute(
                """
                DELETE FROM custom_url_requests
                WHERE user_id = $1::uuid
                  AND status = 'success'
                  AND id NOT IN (
                    SELECT id FROM (
                      SELECT id FROM custom_url_requests
                      WHERE user_id = $1::uuid
                        AND status = 'success'
                      ORDER BY COALESCE(requested_at, updated_at) DESC NULLS LAST
                      LIMIT $2
                    ) keep_success
                  )
                  AND (
                    listing_id IS NULL
                    OR id NOT IN (
                      SELECT DISTINCT ON (listing_id) id
                      FROM custom_url_requests
                      WHERE user_id = $1::uuid
                        AND status = 'success'
                        AND listing_id IS NOT NULL
                      ORDER BY listing_id, COALESCE(requested_at, updated_at) DESC NULLS LAST, id DESC
                    )
                  )
                """,
                user_id,
                ANALYSE_HISTORY_KEEP_SUCCESS,
            )
            await conn.execute(
                """
                DELETE FROM custom_url_requests
                WHERE user_id = $1::uuid
                  AND status = 'error'
                  AND COALESCE(requested_at, updated_at)
                    < NOW() - ($2::text || ' days')::interval
                """,
                user_id,
                str(ANALYSE_ERROR_RETENTION_DAYS),
            )
            if max_per_day is not None:
                used = await conn.fetchval(
                    """
                    SELECT COUNT(*)::int FROM custom_url_requests
                    WHERE user_id = $1::uuid
                      AND COALESCE(requested_at, updated_at) > NOW() - INTERVAL '24 hours'
                    """,
                    user_id,
                )
                if int(used or 0) >= max_per_day:
                    raise AnalyseDailyQuotaExceeded(max_per_day)
            n = await conn.fetchval(
                """
                SELECT COUNT(*)::int FROM custom_url_requests
                WHERE user_id = $1::uuid AND status IN ('queued', 'running')
                """,
                user_id,
            )
            if int(n or 0) >= max_active:
                return None
            row = await conn.fetchrow(
                """
                INSERT INTO custom_url_requests
                  (user_id, url, status, step, progress_pct, step_detail, step_log, updated_at)
                VALUES ($1::uuid, $2, 'queued', 'queued', 0, 'Analyse vorbereitet', $3::jsonb, NOW())
                RETURNING id
                """,
                user_id,
                strip_sensitive_query(url),
                entry,
            )
            return str(row["id"])
    finally:
        await release_connection(conn)


async def count_analyse_jobs_since(user_id: str, *, hours: int = 24) -> int:
    """Alle Analyseversuche eines Users im Zeitfenster (Erfolg und Fehler)."""
    conn = await get_connection()
    try:
        n = await conn.fetchval(
            """
            SELECT COUNT(*)::int FROM custom_url_requests
            WHERE user_id = $1::uuid
              AND COALESCE(requested_at, updated_at) > NOW() - ($2::text || ' hours')::interval
            """,
            user_id,
            str(hours),
        )
        return int(n or 0)
    finally:
        await release_connection(conn)


async def count_active_analyse_jobs(user_id: str) -> int:
    """Anzahl laufender/queued Jobs eines Users."""
    conn = await get_connection()
    try:
        n = await conn.fetchval(
            """
            SELECT COUNT(*)::int FROM custom_url_requests
            WHERE user_id = $1::uuid AND status IN ('queued', 'running')
            """,
            user_id,
        )
        return int(n or 0)
    finally:
        await release_connection(conn)


STALE_ANALYSE_JOB_MINUTES = 45
ACCEPTED_STALE_ANALYSE_JOB_MINUTES = 15


def analyse_job_updatable_statuses(new_status: Optional[str]) -> tuple[str, ...]:
    if new_status == "success":
        return ("queued", "running", "error")
    return ("queued", "running")


async def reap_stale_analyse_jobs(
    *,
    older_than_minutes: int = STALE_ANALYSE_JOB_MINUTES,
    accepted_after_minutes: int = ACCEPTED_STALE_ANALYSE_JOB_MINUTES,
) -> int:
    """Markiert hängende queued/running Jobs als error (Crash/OOM-Recovery)."""
    conn = await get_connection()
    try:
        rows = await conn.fetch(
            """
            UPDATE custom_url_requests
            SET status = 'error',
                step = 'failed',
                step_detail = 'Analyse abgebrochen (Timeout)',
                error_message = 'Job hing länger als erwartet und wurde automatisch beendet',
                updated_at = NOW()
            WHERE status IN ('queued', 'running')
              AND (
                COALESCE(updated_at, requested_at) < NOW() - ($1::text || ' minutes')::interval
                OR (
                  COALESCE(step, 'queued') = 'accepted'
                  AND listing_id IS NULL
                  AND COALESCE(updated_at, requested_at)
                    < NOW() - ($2::text || ' minutes')::interval
                )
              )
            RETURNING id
            """,
            str(older_than_minutes),
            str(accepted_after_minutes),
        )
        return len(rows)
    except Exception as e:
        logger.error(f"reap_stale_analyse_jobs fehlgeschlagen: {e}")
        return 0
    finally:
        await release_connection(conn)


async def update_analyse_job(
    job_id: str,
    *,
    status: Optional[str] = None,
    step: Optional[str] = None,
    progress_pct: Optional[int] = None,
    step_detail: Optional[str] = None,
    error_message: Optional[str] = None,
    listing_id: Optional[str] = None,
    heartbeat: bool = False,
    phase: Optional[str] = None,
    kind: Optional[str] = None,
    preview: Optional[dict] = None,
) -> None:
    """Aktualisiert Fortschritt eines Async-Jobs. Wirft absichtlich nie.

    step_detail wird überschrieben und an step_log angehängt.
    heartbeat=True: letzter Log-Eintrag derselben phase wird ersetzt.
    preview: flaches Merge in preview-JSONB.
    kind: line|chapter|teaser|verdict (default line).
    """
    sets: list[str] = ["updated_at = NOW()"]
    args: list = []
    idx = 1

    def _add(col: str, val) -> None:
        nonlocal idx
        sets.append(f"{col} = ${idx}")
        args.append(val)
        idx += 1

    if status is not None:
        _add("status", status)
    if step is not None:
        _add("step", step)
    if progress_pct is not None:
        _add("progress_pct", progress_pct)
    if error_message is not None:
        _add("error_message", error_message)
    if listing_id is not None:
        sets.append(f"listing_id = ${idx}::uuid")
        args.append(listing_id)
        idx += 1
    if preview is not None:
        preview_i = idx
        args.append(json.dumps(preview))
        idx += 1
        sets.append(f"preview = COALESCE(preview, '{{}}'::jsonb) || ${preview_i}::jsonb")

    if step_detail is not None:
        detail = step_detail[:120] if len(step_detail) > 120 else step_detail
        entry_kind = kind or "line"
        # Kapitel/Verdict: step_detail nur bei normalen Zeilen/Heartbeats setzen
        if entry_kind in ("line", "teaser", "verdict") or heartbeat:
            _add("step_detail", detail)

        entry: dict = {
            "t": datetime.now(timezone.utc).isoformat(),
            "msg": detail,
            "kind": entry_kind,
        }
        if heartbeat:
            entry["hb"] = True
            entry["phase"] = phase or "hb"
            entry["kind"] = "line"
        entry_arr = json.dumps([entry])

        entry_i = idx
        args.append(entry_arr)
        idx += 1

        if heartbeat:
            phase_i = idx
            args.append(phase or "hb")
            idx += 1
            sets.append(
                f"""step_log = CASE
                  WHEN jsonb_typeof(COALESCE(step_log, '[]'::jsonb)) = 'array'
                       AND jsonb_array_length(COALESCE(step_log, '[]'::jsonb)) > 0
                       AND (step_log->-1->>'hb') = 'true'
                       AND (step_log->-1->>'phase') = ${phase_i}
                  THEN (
                    SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
                    FROM jsonb_array_elements(step_log)
                      WITH ORDINALITY AS t(e, ord)
                    WHERE ord < jsonb_array_length(step_log)
                  ) || ${entry_i}::jsonb
                  ELSE COALESCE(step_log, '[]'::jsonb) || ${entry_i}::jsonb
                END"""
            )
        else:
            sets.append(f"step_log = COALESCE(step_log, '[]'::jsonb) || ${entry_i}::jsonb")

    id_i = idx
    args.append(job_id)
    if len(sets) <= 1:
        return
    conn = await get_connection()
    try:
        await conn.execute(
            f"""
            UPDATE custom_url_requests
            SET {", ".join(sets)}
            WHERE id = ${id_i}::uuid
              AND status IN ({", ".join(f"'{s}'" for s in analyse_job_updatable_statuses(status))})
            """,
            *args,
        )
    except Exception as e:
        logger.error(f"Fehler beim Update von analyse-job {job_id}: {e}")
    finally:
        await release_connection(conn)
