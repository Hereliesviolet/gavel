from src.utils.user_agent import default_headers, user_agent


def test_user_agent_is_honest_and_carries_the_contact(monkeypatch):
    monkeypatch.delenv("CONTACT_INFO", raising=False)
    assert user_agent() == "Gavel/1.0"
    monkeypatch.setenv("CONTACT_INFO", "ops@example.com")
    assert user_agent() == "Gavel/1.0 (+ops@example.com)"
    assert "Mozilla" not in user_agent()


def test_default_headers_merge_extra_headers(monkeypatch):
    monkeypatch.delenv("CONTACT_INFO", raising=False)
    headers = default_headers({"Referer": "https://example.com/"})
    assert headers["User-Agent"] == "Gavel/1.0"
    assert headers["Referer"] == "https://example.com/"
