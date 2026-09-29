import pytest

from src.utils.manual_content import (
    ManualContentError,
    build_manual_reference_url,
    is_manual_reference_url,
    parse_cookie_header,
)


def test_build_manual_reference_url_is_deterministic():
    url1 = build_manual_reference_url("html", "<html>Wohnung 100m2</html>")
    url2 = build_manual_reference_url("html", "<html>Wohnung 100m2</html>")
    assert url1 == url2
    assert is_manual_reference_url(url1)


def test_build_manual_reference_url_differs_per_content():
    url1 = build_manual_reference_url("html", "Inhalt A")
    url2 = build_manual_reference_url("html", "Inhalt B")
    assert url1 != url2


def test_is_manual_reference_url_false_for_real_domain():
    assert not is_manual_reference_url("https://www.immowelt.de/expose/123")


def test_parse_cookie_header_basic():
    cookies = parse_cookie_header("session=abc123; theme=dark", "www.example.de")
    assert {
        "name": "session",
        "value": "abc123",
        "domain": "www.example.de",
        "path": "/",
        "secure": True,
    } in cookies
    assert len(cookies) == 2


def test_parse_cookie_header_value_with_equals_sign():
    cookies = parse_cookie_header("token=a=b=c", "example.de")
    assert cookies[0]["value"] == "a=b=c"


def test_parse_cookie_header_rejects_empty():
    with pytest.raises(ManualContentError):
        parse_cookie_header("   ", "example.de")


def test_parse_cookie_header_rejects_too_long():
    with pytest.raises(ManualContentError):
        parse_cookie_header("a=" + ("x" * 9000), "example.de")


def test_parse_cookie_header_rejects_control_chars():
    with pytest.raises(ManualContentError, match="Steuerzeichen"):
        parse_cookie_header("session=abc\r\nHost: evil", "example.de")


def test_parse_cookie_header_strips_cookie_prefix():
    cookies = parse_cookie_header("Cookie: session=abc123; theme=dark", "www.example.de")
    assert cookies[0]["name"] == "session"
    assert cookies[0]["value"] == "abc123"
    assert len(cookies) == 2


def test_parse_cookie_header_rejects_more_than_max_pairs():
    within = "; ".join(f"n{i}=v" for i in range(60))
    assert len(parse_cookie_header(within, "example.de")) == 60
    with pytest.raises(ManualContentError, match="zu viele Einträge"):
        parse_cookie_header(within + "; extra=1", "example.de")


def test_decode_pdf_base64_rejects_non_pdf():
    from src.utils.manual_content import decode_pdf_base64
    import base64

    with pytest.raises(ManualContentError, match="kein gültiges PDF"):
        decode_pdf_base64(base64.b64encode(b"<html>nope</html>").decode())


def test_decode_pdf_base64_accepts_magic():
    from src.utils.manual_content import decode_pdf_base64
    import base64

    raw = b"%PDF-1.4 fake"
    assert decode_pdf_base64(base64.b64encode(raw).decode()) == raw
