export type PublicSiteInfo = {
  name: string;
  description: string;
  browserTitle: string;
  iconUrl: string;
};

export type PublicSeoArticle = {
  id: string;
  slug: string;
  category: string;
  title: string;
  excerpt: string;
  tags: string[];
  seoTitle: string;
  metaDescription: string;
  coverUrl: string | null;
  coverAlt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  author: string;
  contentHtml?: string;
  tableOfContents?: Array<{ id: string; level: number; text: string }>;
};

export type PublicSeoList = {
  items: PublicSeoArticle[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PublicSeoArticleResponse =
  | { redirectTo: string }
  | { article: PublicSeoArticle; related: PublicSeoArticle[] };

export const DEFAULT_PUBLIC_SITE_DESCRIPTION =
  "稳定、安全、简单的网络服务，让每一次连接都清晰、顺畅。";

function normalizedHttpUrl(value: string | undefined, fallback: string) {
  try {
    const url = new URL(value?.trim() || fallback);
    if (!["http:", "https:"].includes(url.protocol)) return fallback;
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

export function publicSiteUrl() {
  return normalizedHttpUrl(process.env.WEB_PUBLIC_URL, "http://localhost:3001");
}

export function publicSiteDescription(
  site: Pick<PublicSiteInfo, "description">,
) {
  return site.description.trim() || DEFAULT_PUBLIC_SITE_DESCRIPTION;
}

function serverApiUrl() {
  return normalizedHttpUrl(
    process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL,
    "http://localhost:4000",
  );
}

async function publicApi<T>(
  path: string,
  options: { fresh?: boolean } = {},
): Promise<T | null> {
  try {
    const response = await fetch(`${serverApiUrl()}${path}`, {
      headers: { Accept: "application/json" },
      ...(options.fresh
        ? { cache: "no-store" as const }
        : { next: { revalidate: 300 } }),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getPublicSiteInfo(): Promise<PublicSiteInfo> {
  return (
    (await publicApi<PublicSiteInfo>("/api/site")) ?? {
      name: "素心 Network",
      description: "稳定、简单的网络服务。",
      browserTitle: "素心 Network",
      iconUrl: "/brand-icon.svg",
    }
  );
}

export async function getPublishedArticles(
  input: {
    page?: number;
    pageSize?: number;
    category?: string;
    tag?: string;
  } = {},
): Promise<PublicSeoList> {
  const query = new URLSearchParams();
  if (input.page) query.set("page", String(input.page));
  if (input.pageSize) query.set("pageSize", String(input.pageSize));
  if (input.category) query.set("category", input.category);
  if (input.tag) query.set("tag", input.tag);
  return (
    (await publicApi<PublicSeoList>(
      `/api/seo/articles${query.size ? `?${query.toString()}` : ""}`,
      { fresh: true },
    )) ?? {
      items: [],
      page: 1,
      pageSize: input.pageSize ?? 9,
      total: 0,
      totalPages: 1,
    }
  );
}

export function getPublishedArticle(slug: string) {
  return publicApi<PublicSeoArticleResponse>(
    `/api/seo/articles/${encodeURIComponent(slug)}`,
    { fresh: true },
  );
}

export async function getSitemapArticles() {
  return (
    (await publicApi<
      Array<{ slug: string; updatedAt: string; publishedAt: string | null }>
    >("/api/seo/articles/sitemap", { fresh: true })) ?? []
  );
}

export function absolutePublicUrl(path: string | null | undefined) {
  if (!path) return null;
  try {
    return new URL(path, publicSiteUrl()).toString();
  } catch {
    return null;
  }
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
