import io
import json
import os
import uuid
from urllib.parse import urlparse

from minio import Minio
from loguru import logger

from src.utils.user_agent import user_agent
from src.storage.postgres import storage_path_from_public_url
from src.utils.url_safety import UrlSafetyError, ZVG_DOCUMENT_HOSTS, fetch_public_url

BUCKET_NAME = "zvg-images"
GUTACHTEN_PREFIX = "gutachten"
MAX_IMAGE_BYTES = 8 * 1024 * 1024
_IMAGE_MAGIC = (
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"RIFF", "webp", "image/webp"),
)


def _referer_for_image(image_url: str) -> str | None:
    """Same-site Referer for the auction sources, whose image paths expect a
    navigation from their own pages. No Referer for any other host."""
    host = (urlparse(image_url).hostname or "").lower()
    if "hanmark" in host:
        return "https://www.hanmark.de/"
    if "zvg-portal" in host:
        return "https://www.zvg-portal.de/"
    if host.endswith("zvg.com"):
        return "https://www.zvg.com/"
    return None


def _detect_image(content: bytes, content_type: str) -> tuple[str, str] | None:
    for magic, ext, mime in _IMAGE_MAGIC:
        if content.startswith(magic) or (
            ext == "webp" and content[:4] == b"RIFF" and b"WEBP" in content[8:16]
        ):
            return ext, mime
    ct = (content_type or "").lower()
    if "png" in ct:
        return "png", "image/png"
    if "webp" in ct:
        return "webp", "image/webp"
    if "jpeg" in ct or "jpg" in ct:
        return "jpg", "image/jpeg"
    return None


def get_minio_client() -> Minio:
    return Minio(
        endpoint=f"{os.environ.get('MINIO_ENDPOINT', 'minio')}:{os.environ.get('MINIO_PORT', '9000')}",
        access_key=os.environ["MINIO_ACCESS_KEY"],
        secret_key=os.environ["MINIO_SECRET_KEY"],
        secure=os.environ.get("MINIO_USE_SSL", "false").lower() == "true",
    )


def public_read_bucket_policy(bucket: str = BUCKET_NAME) -> str:
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{bucket}/*"],
                },
                {
                    "Effect": "Deny",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [
                        f"arn:aws:s3:::{bucket}/real-estate/*",
                        f"arn:aws:s3:::{bucket}/real-estate/*/*",
                        f"arn:aws:s3:::{bucket}/*/gutachten.pdf",
                        f"arn:aws:s3:::{bucket}/*/expose.pdf",
                        f"arn:aws:s3:::{bucket}/*/*/gutachten.pdf",
                        f"arn:aws:s3:::{bucket}/*/*/expose.pdf",
                    ],
                },
            ],
        }
    )


def ensure_bucket() -> None:
    client = get_minio_client()
    if not client.bucket_exists(BUCKET_NAME):
        client.make_bucket(BUCKET_NAME)
        logger.info(f"Bucket '{BUCKET_NAME}' erstellt")
    client.set_bucket_policy(BUCKET_NAME, public_read_bucket_policy())


async def upload_image(
    image_url: str,
    bundesland: str,
    slug: str,
    listing_id: str | None = None,
    position: int | None = None,
) -> tuple[str, str] | None:
    """
    Lädt ein Bild herunter und speichert es in MinIO.

    Wenn listing_id angegeben wird, ist der Pfad:
      {listing_id}/foto_{position}.{ext}
    Sonst (Legacy):
      {bundesland}/{slug}/{uuid}.{ext}

    Gibt (storage_path, public_url) zurück.
    """
    try:
        try:
            resp = await fetch_public_url(
                image_url,
                timeout_sec=30,
                headers={
                    "User-Agent": user_agent(),
                    **({"Referer": ref} if (ref := _referer_for_image(image_url)) else {}),
                },
            )
        except UrlSafetyError:
            logger.warning(f"Bild-URL abgelehnt (SSRF): {image_url}")
            return None
        resp.raise_for_status()
        content = resp.content

        if len(content) > MAX_IMAGE_BYTES:
            logger.warning(f"Bild zu groß ({len(content)} B): {image_url}")
            return None

        content_type = resp.headers.get("content-type", "image/jpeg")
        detected = _detect_image(content, content_type)
        if not detected:
            logger.warning(f"Kein Bildinhalt erkannt: {image_url}")
            return None
        ext, content_type = detected

        if listing_id is not None and position is not None:
            storage_path = f"{listing_id}/foto_{position}.{ext}"
        else:
            storage_path = f"{bundesland}/{slug}/{uuid.uuid4()}.{ext}"

        minio_client = get_minio_client()
        ensure_bucket()

        minio_client.put_object(
            BUCKET_NAME,
            storage_path,
            io.BytesIO(content),
            len(content),
            content_type=content_type,
        )

        public_url = (
            f"{os.environ.get('MINIO_PUBLIC_URL', 'http://localhost:9000')}"
            f"/{BUCKET_NAME}/{storage_path}"
        )

        logger.debug(f"Bild hochgeladen: {storage_path}")
        return storage_path, public_url

    except Exception as e:
        logger.warning(f"Bild-Upload fehlgeschlagen ({image_url}): {e}")
        return None


def public_object_url(storage_path: str) -> str:
    return (
        f"{os.environ.get('MINIO_PUBLIC_URL', 'http://localhost:9000')}"
        f"/{BUCKET_NAME}/{storage_path}"
    )


def listing_owned_object_key(listing_id: str, name: str) -> str:
    return f"{listing_id}/{name}"


def rebind_stored_url_to_listing(
    public_url: str | None,
    listing_id: str,
    dest_name: str,
) -> str | None:
    """Kopiert ein MinIO-Objekt auf {listing_id}/{dest_name}.

    Portal/Hanmark laden vor dem Upsert unter {bundesland}/{scrape-slug}/ hoch.
    unique_slug_candidate hängt bei Kollision ein Suffix an, ohne die URL
    umzuschreiben — dann teilen zwei Akten dasselbe Objekt. Nach dem Upsert
    gehört die Datei der Zeile.
    """
    if not public_url or not listing_id or not dest_name:
        return None
    if "/" in dest_name or dest_name in {".", ".."} or "\\" in dest_name:
        return None
    src_path = storage_path_from_public_url(public_url, BUCKET_NAME)
    if src_path is None:
        return None
    dest_path = listing_owned_object_key(listing_id, dest_name)
    if src_path == dest_path:
        return public_url
    payload = read_stored_object_bytes(public_url)
    if not payload:
        return None
    try:
        ensure_bucket()
        content_type = "application/pdf" if dest_name.endswith(".pdf") else "image/jpeg"
        if dest_name.endswith(".png"):
            content_type = "image/png"
        elif dest_name.endswith(".webp"):
            content_type = "image/webp"
        get_minio_client().put_object(
            BUCKET_NAME,
            dest_path,
            io.BytesIO(payload),
            len(payload),
            content_type=content_type,
        )
        return public_object_url(dest_path)
    except Exception as e:
        logger.warning(f"MinIO-Rebind fehlgeschlagen ({src_path} → {dest_path}): {e}")
        return None


def upload_image_bytes_sync(
    image_bytes: bytes,
    content_type: str,
    bundesland: str,
    slug: str,
    position: int = 0,
) -> tuple[str, str] | None:
    """
    Speichert bereits heruntergeladene Bild-Bytes synchron in MinIO.
    Pfad: {bundesland}/{slug}/foto_{position}.{ext}
    Gibt (storage_path, public_url) zurück.
    """
    try:
        ext = "jpg"
        if "png" in content_type:
            ext = "png"
        elif "webp" in content_type:
            ext = "webp"

        storage_path = f"{bundesland}/{slug}/foto_{position}.{ext}"
        ensure_bucket()
        minio_client = get_minio_client()
        minio_client.put_object(
            BUCKET_NAME,
            storage_path,
            io.BytesIO(image_bytes),
            len(image_bytes),
            content_type=content_type,
        )
        public_url = (
            f"{os.environ.get('MINIO_PUBLIC_URL', 'http://localhost:9000')}"
            f"/{BUCKET_NAME}/{storage_path}"
        )
        logger.debug(f"Bild-Bytes hochgeladen: {storage_path}")
        return storage_path, public_url
    except Exception as e:
        logger.warning(
            f"Bild-Bytes-Upload fehlgeschlagen ({bundesland}/{slug} pos={position}): {e}"
        )
        return None


def upload_document_bytes_sync(
    pdf_bytes: bytes,
    doc_type: str,
    bundesland: str,
    slug: str,
) -> tuple[str, str] | None:
    """
    Speichert bereits heruntergeladene PDF-Bytes synchron in MinIO.
    Pfad: {bundesland}/{slug}/{doc_type}.pdf (doc_type z.B. "gutachten", "expose").

    Analog zu upload_image_bytes_sync, aber für PDF-Dokumente – genutzt von
    Quellen, die Anhänge bereits während des Scrapens (vor dem DB-Upsert, also
    ohne bekannte listing_id) mit einem quellenspezifischen Referer-Header
    herunterladen (z.B. zvg-portal.de, dessen showAnhang-Links per Referer-Check
    geschützt sind).
    Gibt (storage_path, public_url) zurück.
    """
    try:
        storage_path = f"{bundesland}/{slug}/{doc_type}.pdf"
        ensure_bucket()
        minio_client = get_minio_client()
        minio_client.put_object(
            BUCKET_NAME,
            storage_path,
            io.BytesIO(pdf_bytes),
            len(pdf_bytes),
            content_type="application/pdf",
        )
        public_url = (
            f"{os.environ.get('MINIO_PUBLIC_URL', 'http://localhost:9000')}"
            f"/{BUCKET_NAME}/{storage_path}"
        )
        logger.debug(f"Dokument hochgeladen: {storage_path}")
        return storage_path, public_url
    except Exception as e:
        logger.warning(f"Dokument-Upload fehlgeschlagen ({bundesland}/{slug}/{doc_type}): {e}")
        return None


async def upload_gutachten(listing_id: str, pdf_bytes: bytes, listing_slug: str = "") -> str | None:
    """
    Lädt ein Gutachten-PDF in MinIO hoch.
    Pfad: {listing_id}/gutachten.pdf
    Gibt den öffentlichen URL zurück.
    """
    try:
        ensure_bucket()
        minio_client = get_minio_client()

        # Neue Struktur: {listing_id}/gutachten.pdf
        storage_key = f"{listing_id}/gutachten.pdf"

        minio_client.put_object(
            BUCKET_NAME,
            storage_key,
            io.BytesIO(pdf_bytes),
            len(pdf_bytes),
            content_type="application/pdf",
        )

        public_url = (
            f"{os.environ.get('MINIO_PUBLIC_URL', 'http://localhost:9000')}"
            f"/{BUCKET_NAME}/{storage_key}"
        )
        logger.debug(f"Gutachten hochgeladen: {storage_key}")
        return public_url

    except Exception as e:
        logger.warning(f"Gutachten-Upload fehlgeschlagen (listing_id={listing_id}): {e}")
        return None


async def upload_expose(listing_id: str, pdf_bytes: bytes, listing_slug: str = "") -> str | None:
    """
    Lädt ein Expose-PDF in MinIO hoch.
    Pfad: {listing_id}/expose.pdf
    Gibt den öffentlichen URL zurück.
    """
    try:
        ensure_bucket()
        minio_client = get_minio_client()
        storage_key = f"{listing_id}/expose.pdf"
        minio_client.put_object(
            BUCKET_NAME,
            storage_key,
            io.BytesIO(pdf_bytes),
            len(pdf_bytes),
            content_type="application/pdf",
        )
        public_url = (
            f"{os.environ.get('MINIO_PUBLIC_URL', 'http://localhost:9000')}"
            f"/{BUCKET_NAME}/{storage_key}"
        )
        logger.debug(f"Expose hochgeladen: {storage_key}")
        return public_url
    except Exception as e:
        logger.warning(f"Expose-Upload fehlgeschlagen (listing_id={listing_id}): {e}")
        return None


def read_stored_object_bytes(public_url: str) -> bytes | None:
    path = storage_path_from_public_url(public_url, BUCKET_NAME)
    if path is None:
        return None
    if ".." in path or path.startswith("/") or "\\" in path or "\x00" in path:
        return None
    client = get_minio_client()
    resp = client.get_object(BUCKET_NAME, path)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


async def download_gutachten_pdf(
    gutachten_url: str,
    referer: str = "https://zvg.com/",
) -> bytes | None:
    """Lädt ein Gutachten-/Exposé-PDF aus MinIO oder von einem Portal-Host."""
    if storage_path_from_public_url(gutachten_url, BUCKET_NAME):
        try:
            return read_stored_object_bytes(gutachten_url)
        except Exception as e:
            logger.warning(f"MinIO-Dokument nicht lesbar ({gutachten_url}): {e}")
            return None
    try:
        resp = await fetch_public_url(
            gutachten_url,
            timeout_sec=60,
            require_https=True,
            allowed_hosts=ZVG_DOCUMENT_HOSTS,
            headers={
                "User-Agent": user_agent(),
                "Referer": referer,
            },
        )
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "pdf" not in content_type and len(resp.content) < 100:
            logger.warning(f"Kein PDF erhalten von {gutachten_url}: {content_type}")
            return None
        return resp.content
    except Exception as e:
        logger.warning(f"Gutachten-Download fehlgeschlagen ({gutachten_url}): {e}")
        return None
