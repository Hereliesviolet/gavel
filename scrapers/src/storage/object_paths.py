"""Pfad-Filter für MinIO-Objekte, analog zu apps/web/lib/object-stream.ts."""


def is_safe_object_storage_path(path: str | None) -> bool:
    if not path:
        return False
    value = path.strip()
    return (
        0 < len(value) <= 512
        and ".." not in value
        and "\\" not in value
        and "\0" not in value
        and not value.startswith("/")
    )


def is_listing_owned_storage_path(listing_id: str, path: str | None) -> bool:
    if not listing_id or "/" in listing_id or ".." in listing_id:
        return False
    if not is_safe_object_storage_path(path):
        return False
    if path == listing_id or path.startswith(f"{listing_id}/"):
        return True
    prefixed = f"real-estate/{listing_id}"
    return path == prefixed or path.startswith(f"{prefixed}/")
