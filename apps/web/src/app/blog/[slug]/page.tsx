import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteHeader } from "@/components/public-site-header";
import {
  absolutePublicUrl,
  getPublishedArticle,
  getPublicSiteInfo,
  jsonLd,
  publicSiteUrl,
} from "@/lib/seo";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublishedArticle(slug);
  if (!result) return { title: "文章不存在" };
  if ("redirectTo" in result) permanentRedirect(`/blog/${result.redirectTo}`);
  const article = result.article;
  const image = absolutePublicUrl(article.coverUrl);
  return {
    title: article.seoTitle,
    description: article.metaDescription,
    alternates: { canonical: `/blog/${article.slug}` },
    openGraph: {
      type: "article",
      url: `/blog/${article.slug}`,
      title: article.seoTitle,
      description: article.metaDescription,
      publishedTime: article.publishedAt ?? undefined,
      modifiedTime: article.updatedAt,
      authors: [article.author],
      images: image
        ? [
            {
              url: image,
              width: 1600,
              height: 900,
              alt: article.coverAlt || article.title,
            },
          ]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title: article.seoTitle,
      description: article.metaDescription,
      images: image ? [image] : [],
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getPublishedArticle(slug);
  if (!result) notFound();
  if ("redirectTo" in result) permanentRedirect(`/blog/${result.redirectTo}`);
  const site = await getPublicSiteInfo();
  const { article, related } = result;
  const canonical = `${publicSiteUrl()}/blog/${article.slug}`;
  const image = absolutePublicUrl(article.coverUrl);
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.metaDescription,
    image: image ? [image] : undefined,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: { "@type": "Organization", name: article.author },
    publisher: {
      "@type": "Organization",
      name: site.name,
      url: publicSiteUrl(),
    },
    mainEntityOfPage: canonical,
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首页", item: publicSiteUrl() },
      {
        "@type": "ListItem",
        position: 2,
        name: "使用指南",
        item: `${publicSiteUrl()}/blog`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: article.title,
        item: canonical,
      },
    ],
  };

  return (
    <main className="seo-public-page">
      <PublicSiteHeader siteName={site.name} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }}
      />
      <article className="ppanel-container seo-article-layout">
        <header className="seo-article-header">
          <nav className="seo-breadcrumb" aria-label="面包屑">
            <Link href="/">首页</Link>
            <span>/</span>
            <Link href="/blog">使用指南</Link>
          </nav>
          <span className="seo-eyebrow">{article.category}</span>
          <h1>{article.title}</h1>
          <p>{article.excerpt}</p>
          <div className="seo-article-byline">
            <span>{article.author}</span>
            <time dateTime={article.updatedAt}>
              更新于{" "}
              {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(
                new Date(article.updatedAt),
              )}
            </time>
          </div>
          {article.coverUrl ? (
            <div className="seo-article-cover">
              <Image
                alt={article.coverAlt || article.title}
                fill
                priority
                sizes="(max-width: 900px) 100vw, 960px"
                src={article.coverUrl}
                unoptimized
              />
            </div>
          ) : null}
        </header>
        <div className="seo-article-main">
          <aside className="seo-toc">
            <strong>本文目录</strong>
            {(article.tableOfContents ?? []).map((heading) => (
              <a
                className={`level-${heading.level}`}
                href={`#${heading.id}`}
                key={`${heading.id}-${heading.text}`}
              >
                {heading.text}
              </a>
            ))}
          </aside>
          <div>
            <div
              className="seo-prose"
              dangerouslySetInnerHTML={{ __html: article.contentHtml ?? "" }}
            />
            <section className="seo-article-cta">
              <div>
                <span>准备开始使用？</span>
                <strong>先查看适合自己的套餐，再完成注册。</strong>
              </div>
              <div>
                <Link className="ghost-button" href="/portal/plans">
                  查看套餐
                </Link>
                <Link className="action-button" href="/register">
                  注册账户
                </Link>
              </div>
            </section>
          </div>
        </div>
        {related.length ? (
          <section className="seo-related">
            <h2>继续阅读</h2>
            <div>
              {related.map((item) => (
                <Link href={`/blog/${item.slug}`} key={item.id}>
                  <span>{item.category}</span>
                  <strong>{item.title}</strong>
                  <small>{item.excerpt}</small>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </article>
      <PublicSiteFooter siteName={site.name} />
    </main>
  );
}
