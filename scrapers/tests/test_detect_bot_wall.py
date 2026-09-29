from src.utils.scrape_ladder import (
    body_has_expose,
    detect_bot_wall,
    login_wall_without_expose,
)


def test_short_login_wall_is_blocked_above_min_markdown():
    markdown = "Bitte anmelden, um fortzufahren. " * 4
    assert len(markdown.strip()) >= 100
    assert len(markdown.strip()) < 200
    blocked, confidence, reason = detect_bot_wall(markdown, "<html>Anmelden</html>", 200)
    assert blocked is True
    assert confidence == "high"
    assert reason.startswith("login_wall:")


def test_long_expose_with_header_login_stays_open():
    markdown = (
        "Kaufpreis 198.000 € Heller Altbau in Köln mit Balkon. " * 20
        + "Kontakt: Anmelden um die Telefonnummer zu sehen."
    )
    assert len(markdown.strip()) > 200
    blocked, _confidence, reason = detect_bot_wall(
        markdown,
        "<nav>Anmelden</nav><h1>Wohnung</h1><p>Kaufpreis 198.000 €</p>",
        200,
    )
    assert blocked is False
    assert reason == ""


def test_short_captcha_still_blocks():
    blocked, _confidence, reason = detect_bot_wall(
        "Bitte warten.",
        "<div>recaptcha</div>",
        200,
    )
    assert blocked is True
    assert reason.startswith("short_content:")


def test_body_has_expose_needs_labeled_price():
    login = "Bitte anmelden, um das Inserat zu sehen. " * 20
    assert body_has_expose(login, "<html>Anmelden Einloggen</html>") is False
    assert (
        body_has_expose(
            "Kaufpreis 198.000 € Heller Altbau in Köln.",
            "<p>Kaufpreis 198.000 €</p>",
        )
        is True
    )


def test_login_wall_without_expose_blocks_long_login_only():
    login = "Bitte anmelden oder einloggen, um fortzufahren. " * 20
    assert len(login.strip()) > 200
    assert detect_bot_wall(login, f"<html>{login}</html>", 200)[0] is False
    assert login_wall_without_expose(login, f"<html>{login}</html>") is True


def test_login_wall_without_expose_keeps_long_expose_with_header_login():
    markdown = (
        "Kaufpreis 198.000 € Heller Altbau in Köln mit Balkon. " * 20
        + "Kontakt: Anmelden um die Telefonnummer zu sehen."
    )
    html = "<nav>Anmelden</nav><h1>Wohnung</h1><p>Kaufpreis 198.000 €</p>"
    assert login_wall_without_expose(markdown, html) is False
