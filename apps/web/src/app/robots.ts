import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/blog", "/blog/"],
      disallow: [
        "/admin",
        "/portal",
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/oauth",
        "/api",
        "/__gift-preview",
        "/__layout-preview",
      ],
    },
    sitemap: `${publicSiteUrl()}/sitemap.xml`,
  };
}
