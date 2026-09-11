import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteHeader } from "@/components/public-site-header";
import { getPublishedArticles, getPublicSiteInfo } from "@/lib/seo";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "使用指南",
  description: "客户端使用教程、连接故障排查与网络服务指南。",
  alternates: { canonical: "/blog" },
  openGraph: { type: "website", url: "/blog", title: "使用指南" },
  twitter: { card: "summary_large_image", title: "使用指南" },
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageHref(
  page: number,
  filters: { category?: string; tag?: string },
) {
  const query = new URLSearchParams({ page: String(page) });
  if (filters.category) query.set("category", filters.category);
  if (filters.tag) query.set("tag", filters.tag);
  return `/blog?${query.toString()}`;
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = positiveInteger(
    typeof params.page === "string" ? params.page : undefined,
    1,
  );
  const category =
    typeof params.category === "string" ? params.category : undefined;
  const tag = typeof params.tag === "string" ? params.tag : undefined;
  const [site, articles] = await Promise.all([
    getPublicSiteInfo(),
    getPublishedArticles({ page, pageSize: 9, category, tag }),
  ]);
  const categories = [
    ...new Set(articles.items.map((article) => article.category)),
  ];

  return (
    <main className="seo-public-page">
      <PublicSiteHeader siteName={site.name} />
      <section className="seo-blog-hero">
        <div className="ppanel-container">
          <span className="seo-eyebrow">素心 Network 编辑部</span>
          <h1>使用指南</h1>
          <p>把连接、客户端与常见故障讲清楚，让每一步都有依据。</p>
        </div>
      </section>
      <div className="ppanel-container seo-blog-content">
        {categories.length > 1 || category || tag ? (
          <nav className="seo-filter-row" aria-label="文章筛选">
            <Link className={!category && !tag ? "active" : ""} href="/blog">
              全部
            </Link>
            {categories.map((item) => (
              <Link
                className={category === item ? "active" : ""}
                href={`/blog?category=${encodeURIComponent(item)}`}
                key={item}
              >
                {item}
              </Link>
            ))}
            {tag ? <span className="seo-active-tag">标签：{tag}</span> : null}
          </nav>
        ) : null}
        {articles.items.length ? (
          <div className="seo-article-grid">
            {articles.items.map((article) => (
              <article className="seo-article-card" key={article.id}>
                <Link href={`/blog/${article.slug}`} className="seo-card-media">
                  {article.coverUrl ? (
                    <Image
                      alt={article.coverAlt || article.title}
                      fill
                      sizes="(max-width: 760px) 100vw, 33vw"
                      src={article.coverUrl}
                      unoptimized
                    />
                  ) : (
                    <span aria-hidden="true" className="seo-card-placeholder" />
                  )}
                </Link>
                <div className="seo-card-body">
                  <div className="seo-card-meta">
                    <span>{article.category}</span>
                    <time dateTime={article.updatedAt}>
                      {new Intl.DateTimeFormat("zh-CN", {
                        dateStyle: "medium",
                      }).format(new Date(article.updatedAt))}
                    </time>
                  </div>
                  <h2>
                    <Link href={`/blog/${article.slug}`}>{article.title}</Link>
                  </h2>
                  <p>{article.excerpt}</p>
                  <Link
                    className="seo-read-link"
                    href={`/blog/${article.slug}`}
                  >
                    阅读全文
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="seo-empty-state">
            <strong>指南正在整理中</strong>
            <span>经过审核的教程会在这里公开。</span>
          </div>
        )}
        {articles.totalPages > 1 ? (
          <nav className="seo-pagination" aria-label="文章分页">
            {articles.page > 1 ? (
              <Link
                href={pageHref(articles.page - 1, { category, tag })}
              >
                上一页
              </Link>
            ) : (
              <span />
            )}
            <span>
              {articles.page} / {articles.totalPages}
            </span>
            {articles.page < articles.totalPages ? (
              <Link
                href={pageHref(articles.page + 1, { category, tag })}
              >
                下一页
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
      <PublicSiteFooter siteName={site.name} />
    </main>
  );
}
