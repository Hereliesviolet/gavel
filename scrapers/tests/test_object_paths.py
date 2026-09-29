from src.storage.object_paths import (
    is_listing_owned_storage_path,
    is_safe_object_storage_path,
)


def test_safe_object_storage_path():
    assert is_safe_object_storage_path("abc/foto_0.jpg") is True
    assert is_safe_object_storage_path("real-estate/abc/foto_0.jpg") is True
    assert is_safe_object_storage_path("../etc/passwd") is False
    assert is_safe_object_storage_path("/abs/foto.jpg") is False
    assert is_safe_object_storage_path("a\\b") is False
    assert is_safe_object_storage_path("") is False


def test_listing_owned_storage_path():
    listing_id = "11111111-1111-1111-1111-111111111111"
    assert is_listing_owned_storage_path(listing_id, f"{listing_id}/foto_0.jpg") is True
    assert is_listing_owned_storage_path(listing_id, f"real-estate/{listing_id}/foto_0.jpg") is True
    assert is_listing_owned_storage_path(listing_id, "other/foto_0.jpg") is False
    assert (
        is_listing_owned_storage_path(listing_id, f"real-estate/{listing_id}evil/foto.jpg") is False
    )
    assert is_listing_owned_storage_path(listing_id, "../etc/passwd") is False
    assert is_listing_owned_storage_path("", f"{listing_id}/foto_0.jpg") is False
    assert is_listing_owned_storage_path("abc/def", "abc/def/foto.jpg") is False
