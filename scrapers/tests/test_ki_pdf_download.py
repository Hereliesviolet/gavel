from pathlib import Path

import pytest

from src.flows.ki_analysis import _download_pdf_text_pdfplumber
from src.utils.url_safety import UrlSafetyError


@pytest.mark.asyncio
async def test_pdf_download_rejects_unsafe_url(monkeypatch):
    async def boom(*_args, **_kwargs):
        raise UrlSafetyError("privat")

    monkeypatch.setattr("src.flows.ki_analysis.download_gutachten_pdf", boom)
    assert await _download_pdf_text_pdfplumber("http://127.0.0.1/secret.pdf") == ""


@pytest.mark.asyncio
async def test_pdf_download_reads_minio_without_http(monkeypatch):
    async def stored(url: str, referer: str = "https://zvg.com/"):
        assert "/zvg-images/" in url
        return b"%PDF-1.4 stored"

    monkeypatch.setattr("src.flows.ki_analysis.download_gutachten_pdf", stored)
    monkeypatch.setattr(
        "src.flows.ki_analysis.extract_pdf_text",
        lambda data, **_kwargs: "aus-minio" if data.startswith(b"%PDF") else "",
    )
    text = await _download_pdf_text_pdfplumber(
        "https://cdn.example/zvg-images/abc/gutachten.pdf",
    )
    assert text == "aus-minio"


def test_pdf_downloads_require_portal_https():
    root = Path(__file__).resolve().parents[1]
    minio = (root / "src/storage/minio.py").read_text()
    assert "require_https=True" in minio
    assert "allowed_hosts=ZVG_DOCUMENT_HOSTS" in minio
    assert "read_stored_object_bytes" in minio
    assert "storage_path_from_public_url" in minio
    for rel in (
        "src/flows/ki_analysis.py",
        "backfill_wohnflaeche.py",
    ):
        src = (root / rel).read_text()
        assert "download_gutachten_pdf" in src
        assert "AsyncClient(follow_redirects=True" not in src


def test_accepted_expose_url_rejects_foreign_and_private_hosts():
    from backfill_expose import accepted_expose_url

    assert (
        accepted_expose_url("https://www.zvg.com/bilder/Kurzbeschreibung.pdf", resolve_dns=False)
        == "https://www.zvg.com/bilder/Kurzbeschreibung.pdf"
    )
    assert accepted_expose_url("https://evil.example/x.pdf", resolve_dns=False) is None
    assert accepted_expose_url("http://zvg.com/x.pdf", resolve_dns=False) is None
    assert accepted_expose_url("http://127.0.0.1/x.pdf", resolve_dns=False) is None
    assert accepted_expose_url("", resolve_dns=False) is None


def test_zvg_com_media_url_rejects_private_targets():
    from backfill_photos import _zvg_com_media_url

    assert _zvg_com_media_url("http://127.0.0.1/x.jpg") is None
    assert _zvg_com_media_url("https://192.168.1.4/x.jpg") is None
    assert _zvg_com_media_url("") is None


def test_ops_backfills_do_not_follow_redirects_blindly():
    root = Path(__file__).resolve().parents[1]
    photos = (root / "backfill_photos.py").read_text()
    documents = (root / "backfill_zvg_portal_documents.py").read_text()
    expose = (root / "backfill_expose.py").read_text()
    for src in (photos, documents, expose):
        assert "AsyncClient(follow_redirects=True" not in src
        assert "fetch_public_" in src
    assert "allowed_hosts=ZVG_PORTAL_HOSTS" in photos
    assert "allowed_hosts=ZVG_COM_HOSTS" in photos
    assert "assert_image_fetch_url" in photos
    assert "len(image_urls)} Foto(s) gespeichert" not in photos
    assert "min(len(image_urls), 5)} Foto(s)" not in photos
    assert "listing_stored} Foto(s) gespeichert" in photos
    assert "COALESCE(i.n, 0) < 3" in photos
    assert "NOT IN (SELECT DISTINCT listing_id FROM zvg_images" not in photos
    assert "allowed_hosts=ZVG_PORTAL_HOSTS" in documents
    assert "allowed_hosts=ZVG_COM_HOSTS" in expose
    assert "assert_zvg_com_url" in expose


def test_investment_enrichment_keeps_existing_massnahmen():
    src = (Path(__file__).resolve().parents[1] / "src/storage/postgres.py").read_text()
    fn = src[
        src.index("async def update_investment_enrichment") : src.index(
            "async def mark_ki_analysis_schema_current"
        )
    ]
    assert "jsonb_array_length($2::jsonb->'fix_flip_massnahmen') > 0" in fn
    assert "ELSE fix_flip_massnahmen" in fn
    assert "fix_flip_massnahmen = $2::jsonb->'fix_flip_massnahmen'" not in fn
