import type { MetadataRoute } from "next";

// Gavel ist ein komplett privates, login-pflichtiges Tool. Es soll unter
// keinen Umständen von Suchmaschinen erfasst werden.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
