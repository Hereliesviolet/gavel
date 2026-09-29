from .zvg_portal import scrape_bundesland as scrape_zvg_portal
from .hanmark import scrape_bundesland as scrape_hanmark, scrape_all as scrape_hanmark_all

__all__ = ["scrape_zvg_portal", "scrape_hanmark", "scrape_hanmark_all"]
