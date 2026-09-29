from src.models.zvg import ZvgListing
from src.storage.minio import BUCKET_NAME, rebind_stored_url_to_listing
from src.storage.postgres import (
    persist_zvg_gallery,
    storage_path_from_public_url,
    update_expose_url,
    update_gutachten_url,
)


def _photo_dest_name(public_url: str, position: int) -> str:
    path = storage_path_from_public_url(public_url, BUCKET_NAME) or ""
    ext = "jpg"
    if path.endswith(".png"):
        ext = "png"
    elif path.endswith(".webp"):
        ext = "webp"
    return f"foto_{position}.{ext}"


async def bind_and_persist_zvg_assets(listing_id: str, listing: ZvgListing) -> int:
    gutachten = rebind_stored_url_to_listing(listing.gutachten_url, listing_id, "gutachten.pdf")
    if gutachten:
        await update_gutachten_url(listing_id, gutachten)

    expose = rebind_stored_url_to_listing(listing.expose_url, listing_id, "expose.pdf")
    if expose:
        await update_expose_url(listing_id, expose)

    intended = listing.image_urls[:10]
    bilder: list[tuple[str, str, int]] = []
    for i, img_url in enumerate(intended):
        bound = rebind_stored_url_to_listing(img_url, listing_id, _photo_dest_name(img_url, i))
        url = bound or img_url
        path = storage_path_from_public_url(url, BUCKET_NAME)
        if path:
            bilder.append((path, url, i))
    return await persist_zvg_gallery(listing_id, bilder, len(intended))
