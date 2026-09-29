import base64

import pytest
from fastapi import HTTPException

from src.api.app import (
    AnalyzeUrlRequest,
    app,
    _build_manual_page_result,
    _map_fetch_progress,
    _normalize_source_url,
    _resolve_reference_url,
    _validate_analyze_request,
    public_job_error_message,
    reject_unbound_user_analyse,
)
from fastapi.testclient import TestClient
from src.utils.manual_content import (
    MAX_MANUAL_HTML_CHARS,
    MAX_MANUAL_PDF_BYTES,
    is_manual_reference_url,
)


def test_internal_api_has_no_public_docs():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/docs" not in paths
    assert "/redoc" not in paths
    assert "/openapi.json" not in paths


def test_normalize_source_url_strips_www():
    assert _normalize_source_url("https://www.immobilienscout24.de/expose/123") == (
        "https://immobilienscout24.de/expose/123"
    )
    assert _normalize_source_url("https://immobilienscout24.de/expose/123") == (
        "https://immobilienscout24.de/expose/123"
    )
    assert (
        _normalize_source_url("https://www.kleinanzeigen.de/s-anzeige/wohnung/123?utm_source=share")
        == "https://kleinanzeigen.de/s-anzeige/wohnung/123"
    )
    assert (
        _normalize_source_url("https://www.makler.example/objekt/1#galerie")
        == "https://makler.example/objekt/1"
    )


def test_validate_url_only_request():
    url = _validate_analyze_request(AnalyzeUrlRequest(url="https://www.immowelt.de/expose/123"))
    assert "immowelt.de" in url


def test_validate_rejects_missing_content():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(AnalyzeUrlRequest())
    assert exc.value.status_code == 422


def test_validate_rejects_ssrf_url():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(AnalyzeUrlRequest(url="http://127.0.0.1/x"))
    assert exc.value.status_code == 422


def test_validate_html_only_uses_synthetic_reference():
    url = _validate_analyze_request(AnalyzeUrlRequest(html="<html><body>Wohnung</body></html>"))
    assert is_manual_reference_url(url)


def test_validate_html_with_real_reference_url_keeps_it():
    url = _validate_analyze_request(
        AnalyzeUrlRequest(url="https://example.com/angebot/1", html="<html>x</html>")
    )
    assert url == "https://example.com/angebot/1"
    assert not is_manual_reference_url(url)


def test_validate_rejects_html_and_pdf_together():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(
            AnalyzeUrlRequest(html="<html>x</html>", pdf_base64=base64.b64encode(b"x").decode())
        )
    assert exc.value.status_code == 422


def test_validate_rejects_oversized_html():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(AnalyzeUrlRequest(html="x" * (MAX_MANUAL_HTML_CHARS + 1)))
    assert exc.value.status_code == 422


def test_validate_rejects_oversized_pdf():
    huge = base64.b64encode(b"x" * (MAX_MANUAL_PDF_BYTES + 1)).decode()
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(AnalyzeUrlRequest(pdf_base64=huge))
    assert exc.value.status_code == 422


def test_validate_rejects_invalid_base64_pdf():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(AnalyzeUrlRequest(pdf_base64="not-valid-base64!!"))
    assert exc.value.status_code == 422


def test_validate_rejects_non_pdf_payload():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(
            AnalyzeUrlRequest(pdf_base64=base64.b64encode(b"<html>x</html>").decode())
        )
    assert exc.value.status_code == 422


def test_validate_rejects_private_reference_url_on_html():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(
            AnalyzeUrlRequest(url="https://127.0.0.1/secret", html="<html>Wohnung</html>")
        )
    assert exc.value.status_code == 422


def test_validate_pdf_only_uses_synthetic_reference():
    valid_b64 = base64.b64encode(b"%PDF-1.4 fake").decode()
    url = _validate_analyze_request(AnalyzeUrlRequest(pdf_base64=valid_b64))
    assert is_manual_reference_url(url)


def test_validate_rejects_cookie_with_html():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(
            AnalyzeUrlRequest(html="<html>x</html>", cookie_header="session=abc")
        )
    assert exc.value.status_code == 422


def test_validate_rejects_client_user_id():
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(
            AnalyzeUrlRequest(url="https://www.immowelt.de/expose/1", user_id="not-a-uuid")
        )
    assert exc.value.status_code == 422
    assert "user_id" in str(exc.value.detail)

    raw = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"
    req = AnalyzeUrlRequest(url="https://www.immowelt.de/expose/1", user_id=raw)
    with pytest.raises(HTTPException) as exc:
        _validate_analyze_request(req)
    assert exc.value.status_code == 422
    assert req.user_id is None or req.user_id == raw


def test_reject_unbound_user_analyse_without_job():
    with pytest.raises(HTTPException) as exc:
        reject_unbound_user_analyse(None, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    assert exc.value.status_code == 422


def test_reject_unbound_allows_system_and_bound_jobs():
    reject_unbound_user_analyse(None, None)
    reject_unbound_user_analyse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", None)
    reject_unbound_user_analyse(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    )


def test_resolve_reference_url_accepts_https():
    assert _resolve_reference_url("https://example.com/x") == "https://example.com/x"


def test_resolve_reference_url_rejects_dns_to_private(monkeypatch):
    def fake_getaddrinfo(host, _port, *args, **kwargs):
        return [(None, None, None, None, ("127.0.0.1", 0))]

    monkeypatch.setattr("src.utils.url_safety.socket.getaddrinfo", fake_getaddrinfo)
    assert _resolve_reference_url("https://evil.example/x") is None


def test_resolve_reference_url_rejects_garbage():
    assert _resolve_reference_url("not a url") is None
    assert _resolve_reference_url(None) is None
    assert _resolve_reference_url("") is None


def test_build_manual_page_result_html_success():
    page = _build_manual_page_result(
        "https://manuelle-eingabe.immopulse/html/abc",
        "manuelle-eingabe.immopulse",
        "<html><body>" + ("Wohnung mit Balkon. " * 20) + "</body></html>",
        fetch_source="manual_html",
        is_html=True,
        min_chars=100,
        insufficient_message="zu wenig Inhalt",
    )
    assert page.success is True
    assert page.metadata.fetch_source == "manual_html"
    assert "Wohnung" in page.markdown


def test_build_manual_page_result_pdf_insufficient():
    page = _build_manual_page_result(
        "https://manuelle-eingabe.immopulse/pdf/abc",
        "manuelle-eingabe.immopulse",
        "kurz",
        fetch_source="manual_pdf",
        is_html=False,
        min_chars=200,
        insufficient_message="zu wenig Text",
    )
    assert page.success is False
    assert page.error_code == "SCRAPE_INSUFFICIENT"
    assert page.error == "zu wenig Text"


def test_job_progress_sanitizes_on_write():
    from inspect import getsource

    from src.api.app import _set_job_progress

    source = getsource(_set_job_progress)
    assert "public_job_error_message(step_detail)" in source
    assert "public_job_error_message(error_message)" in source


def test_public_job_error_message_hides_internals():
    assert public_job_error_message("Die Seite konnte nicht geladen werden.") == (
        "Die Seite konnte nicht geladen werden."
    )
    assert public_job_error_message("httpx.ConnectError: [Errno 111]") == (
        "Bei der Analyse ist ein unerwarteter Fehler aufgetreten."
    )
    assert public_job_error_message('Traceback (most recent call last):\n  File "app.py"') == (
        "Bei der Analyse ist ein unerwarteter Fehler aufgetreten."
    )
    assert public_job_error_message("Analyse fehlgeschlagen: ConnectError postgres:5432") == (
        "Bei der Analyse ist ein unerwarteter Fehler aufgetreten."
    )
    assert public_job_error_message("SCRAPER_API_SECRET ist serverseitig nicht konfiguriert") == (
        "Bei der Analyse ist ein unerwarteter Fehler aufgetreten."
    )
    assert public_job_error_message(
        "Seite konnte nicht geladen werden: net::ERR_CONNECTION_REFUSED"
    ) == ("Bei der Analyse ist ein unerwarteter Fehler aufgetreten.")
    assert public_job_error_message("connect to 10.0.0.5:443 failed") == (
        "Bei der Analyse ist ein unerwarteter Fehler aufgetreten."
    )


def test_validation_errors_are_generic():
    client = TestClient(app)
    response = client.post(
        "/internal/analyze-url-async",
        json={"html": ["kein-string"]},
        headers={"Authorization": "Bearer test"},
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Ungültige Anfrage"}


def test_map_fetch_progress_never_echoes_ladder_internals():
    assert (
        _map_fetch_progress("Bot-Wall · http_403") == "Seite schützt sich gegen automatischen Abruf"
    )
    assert _map_fetch_progress("Cookies applied") == "Seite wird geladen…"
    assert _map_fetch_progress("unbekannte interne Leiter-Zeile") == "Seite wird geladen…"
