import { asc, desc, sql } from "drizzle-orm";
import { zvgImages } from "@/drizzle/schema";

export const LISTING_COVER_ORDER = [desc(zvgImages.isCover), asc(zvgImages.position)];

export const LISTING_COVER_IMAGE_SQL = sql<string | null>`(
  SELECT public_url FROM zvg_images
  WHERE listing_id = "zvg_listings"."id"
  ORDER BY is_cover DESC NULLS LAST, position ASC NULLS LAST
  LIMIT 1
)`;
