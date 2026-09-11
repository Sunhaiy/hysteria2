import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");

async function source(relativePath) {
  return readFile(path.join(webRoot, relativePath), "utf8");
}

async function scssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? scssFiles(target)
        : Promise.resolve(entry.name.endsWith(".scss") ? [target] : []);
    }),
  );
  return nested.flat();
}

test("public SEO routes provide crawl metadata and server-rendered article content", async () => {
  const [layout, homepage, article, robots, sitemap, socialImage, proxy] =
    await Promise.all([
      source("src/app/layout.tsx"),
      source("src/app/page.tsx"),
      source("src/app/blog/[slug]/page.tsx"),
      source("src/app/robots.ts"),
      source("src/app/sitemap.ts"),
      source("src/app/opengraph-image.tsx"),
      source("src/proxy.ts"),
    ]);
  assert.match(layout, /Organization/);
  assert.match(layout, /WebSite/);
  assert.match(layout, /publicSiteDescription\(site\)/);
  assert.match(layout, /<SiteProvider initialSite=\{site\}>/);
  assert.match(homepage, /getPublicCatalog\(\)/);
  assert.match(homepage, /alternates:\s*\{ canonical: "\/" \}/);
  assert.match(article, /dangerouslySetInnerHTML/);
  assert.match(article, /BreadcrumbList/);
  assert.match(article, /permanentRedirect/);
  assert.match(article, /href="\/\#plans"/);
  assert.match(article, /资料依据/);
  assert.match(article, /内容核验于/);
  assert.match(robots, /"\/admin"/);
  assert.match(robots, /"\/portal"/);
  assert.match(robots, /"\/api"/);
  assert.match(sitemap, /getSitemapArticles/);
  assert.doesNotMatch(sitemap, /lastModified:\s*new Date\(\)/);
  assert.match(socialImage, /new ImageResponse/);
  assert.match(socialImage, /1200/);
  assert.match(socialImage, /630/);
  assert.match(proxy, /NextResponse\.redirect\(destination, 301\)/);
  assert.match(proxy, /api\/seo\/redirects/);
  const helpers = await source("src/lib/seo.ts");
  assert.match(helpers, /稳定、安全、简单的网络服务/);
  assert.match(helpers, /cache: "no-store" as const/);
  assert.match(
    helpers,
    /articles\/\$\{encodeURIComponent\(slug\)\}`,[\s\S]*\{ fresh: true \}/,
  );
});

test("private route groups all publish noindex and nofollow metadata", async () => {
  const groups = [
    "admin",
    "portal",
    "login",
    "register",
    "forgot-password",
    "reset-password",
    "oauth",
  ];
  for (const group of groups) {
    const layout = await source(`src/app/${group}/layout.tsx`);
    assert.match(
      layout,
      /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/,
    );
  }
});

test("Tiptap variables are scoped to the SEO editor", async () => {
  const roots = [
    path.join(webRoot, "src/components/tiptap-node"),
    path.join(webRoot, "src/components/tiptap-ui"),
    path.join(webRoot, "src/components/tiptap-ui-primitive"),
    path.join(webRoot, "src/components/tiptap-templates"),
  ];
  const files = (await Promise.all(roots.map(scssFiles))).flat();
  for (const file of files) {
    const contents = await readFile(file, "utf8");
    assert.doesNotMatch(contents, /(^|\n)\s*:root(?:\.|\s*\{)/);
    assert.doesNotMatch(contents, /(^|\n)\s*\.dark(?:\s|\{|&)/);
  }
});

test("published articles initialize preview and quality state without creating a draft", async () => {
  const editor = await source("src/app/admin/seo/page.tsx");
  assert.match(
    editor,
    /selected\?\.draftRevision \?\? selected\?\.publishedRevision \?\? null/,
  );
  assert.match(editor, /__html: currentRevision\.contentHtml/);
  assert.match(editor, /!selected\.draftRevision \|\| !quality\?\.passed/);
  assert.match(editor, /onClick=\{\(\) => setView\(item\.value\)\}/);
  assert.match(editor, /独立审校/);
  assert.match(editor, /事实依据/);
});
