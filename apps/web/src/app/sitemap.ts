import type { MetadataRoute } from "next";
import { getSitemapArticles, publicSiteUrl } from "@/lib/seo";

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = publicSiteUrl();
  const articles = await getSitemapArticles();
  return [
    {
      url: origin,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${origin}/blog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...articles.map((article) => ({
      url: `${origin}/blog/${article.slug}`,
      lastModified: new Date(article.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
