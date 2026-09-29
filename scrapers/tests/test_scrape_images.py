from src.utils.scrape_images import _normalize_image_url, extract_listing_images


def test_normalize_keeps_signed_query():
    url = "https://img.example/a.jpg?rule=$_59.AUTO&token=abc"
    assert _normalize_image_url(url, "https://www.kleinanzeigen.de/s-anzeige/x") == url


def test_extract_dedups_same_path_with_different_query():
    html = """
    <img src="https://img.example/foto.jpg?w=100">
    <img src="https://img.example/foto.jpg?w=800">
    <img src="https://img.example/andere.jpg">
    """
    urls = extract_listing_images(html, "https://www.kleinanzeigen.de/x")
    assert urls == [
        "https://img.example/foto.jpg?w=100",
        "https://img.example/andere.jpg",
    ]
