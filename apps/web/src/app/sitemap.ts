import type { MetadataRoute } from "next";
import { getSitemapArticles, publicSiteUrl } from "@/lib/seo";

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = publicSiteUrl();
  const articles = await getSitemapArticles();
  const latestArticleUpdate = articles.reduce<Date | null>(
    (latest, article) => {
      const updatedAt = new Date(article.updatedAt);
      return !latest || updatedAt > latest ? updatedAt : latest;
    },
    null,
  );
  return [
    {
      url: origin,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${origin}/blog`,
      ...(latestArticleUpdate ? { lastModified: latestArticleUpdate } : {}),
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
