import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

type PublicArticleBody = {
  article: {
    slug: string;
    title: string;
    author: string;
    contentHtml: string;
  };
};

function responseBody<T>(response: { body: unknown }) {
  return response.body as T;
}

describe('SEO publishing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  async function login(
    agent: ReturnType<typeof request.agent>,
    email: string,
    password: string,
  ) {
    const response = await agent
      .post('/api/auth/login')
      .send({ email, password })
      .expect(201);
    const headers = response.headers as unknown as Record<string, unknown>;
    const values = headers['set-cookie'];
    const cookies = Array.isArray(values)
      ? values.filter((value): value is string => typeof value === 'string')
      : typeof values === 'string'
        ? [values]
        : [];
    const csrf = cookies
      .find((value) => value.startsWith('hysteria2-csrf='))
      ?.split(';')[0]
      ?.split('=')
      .slice(1)
      .join('=');
    if (!csrf) throw new Error('Login did not set a CSRF cookie');
    return decodeURIComponent(csrf);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps revisions private until review and redirects a replaced slug', async () => {
    const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const firstSlug = `seo-e2e-guide-${unique}`;
    const secondSlug = `${firstSlug}-updated`;
    const admin = request.agent(app.getHttpServer());
    const csrf = await login(admin, 'ops@hysteria.local', 'admin123!');
    const longText =
      '依次检查客户端版本、订阅更新时间、本地网络连通性和节点状态，并记录每一步的结果。'.repeat(
        55,
      );
    const contentJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '先确认问题范围' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: `${longText}<script>alert(1)</script>` },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '按顺序完成排查' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: longText },
            { type: 'text', text: '继续查看' },
            {
              type: 'text',
              text: '使用指南',
              marks: [{ type: 'link', attrs: { href: '/blog' } }],
            },
          ],
        },
      ],
    };
    const articleInput = {
      slug: firstSlug,
      category: '故障排查',
      title: '客户端连接失败完整排查指南',
      excerpt:
        '从客户端配置、本地网络和节点状态三个方向逐步定位连接失败的具体原因。',
      contentJson,
      primaryKeyword: '客户端连接失败',
      relatedKeywords: ['连接超时', '订阅更新'],
      tags: ['客户端', '故障排查'],
      seoTitle: '客户端连接失败完整排查指南',
      metaDescription:
        '本指南说明如何检查客户端配置、订阅更新时间、本地网络和服务节点，按顺序定位连接失败或超时的具体原因。',
    };
    let articleId: string | null = null;

    try {
      await request(app.getHttpServer())
        .get('/api/admin/seo/settings')
        .expect(401);

      const created = await admin
        .post('/api/admin/seo/articles')
        .set('X-CSRF-Token', csrf)
        .send(articleInput)
        .expect(201);
      articleId = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({
        status: 'DRAFT',
        currentRevision: {
          slug: firstSlug,
          qualityReport: { passed: true },
        },
      });

      await request(app.getHttpServer())
        .get(`/api/seo/articles/${firstSlug}`)
        .expect(404);

      await admin
        .post(`/api/admin/seo/articles/${articleId}/publish`)
        .set('X-CSRF-Token', csrf)
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/seo/articles/${firstSlug}`)
        .expect(200)
        .expect((response) => {
          const body = responseBody<PublicArticleBody>(response);
          expect(body.article).toMatchObject({
            slug: firstSlug,
            title: articleInput.title,
            author: '素心 Network 编辑部',
          });
          expect(body.article.contentHtml).toContain(
            '&lt;script&gt;alert(1)&lt;/script&gt;',
          );
          expect(body.article.contentHtml).not.toContain('<script>');
        });

      const updatedTitle = '客户端连接失败排查与恢复指南';
      await admin
        .put(`/api/admin/seo/articles/${articleId}`)
        .set('X-CSRF-Token', csrf)
        .send({ ...articleInput, slug: secondSlug, title: updatedTitle })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/seo/articles/${firstSlug}`)
        .expect(200)
        .expect((response) => {
          const body = responseBody<PublicArticleBody>(response);
          expect(body.article.title).toBe(articleInput.title);
        });
      await request(app.getHttpServer())
        .get(`/api/seo/articles/${secondSlug}`)
        .expect(404);

      await admin
        .post(`/api/admin/seo/articles/${articleId}/publish`)
        .set('X-CSRF-Token', csrf)
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/seo/articles/${firstSlug}`)
        .expect(200)
        .expect({ redirectTo: secondSlug });
      await request(app.getHttpServer())
        .get(`/api/seo/redirects/${firstSlug}`)
        .expect(200)
        .expect({ redirectTo: secondSlug });
      await request(app.getHttpServer())
        .get(`/api/seo/redirects/${secondSlug}`)
        .expect(200)
        .expect({ redirectTo: null });
      await request(app.getHttpServer())
        .get(`/api/seo/articles/${secondSlug}`)
        .expect(200)
        .expect((response) => {
          const body = responseBody<PublicArticleBody>(response);
          expect(body.article.title).toBe(updatedTitle);
        });
      await request(app.getHttpServer())
        .get('/api/seo/articles/sitemap')
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ slug: secondSlug }),
            ]),
          );
        });
    } finally {
      if (articleId) {
        await prisma.seoArticle.delete({ where: { id: articleId } });
      }
    }
  });

  it('serves immutable SEO images across origins and honors ETags', async () => {
    const previousDirectory = process.env.SEO_IMAGE_DIR;
    const directory = await mkdtemp(join(tmpdir(), 'seo-images-e2e-'));
    process.env.SEO_IMAGE_DIR = directory;
    const admin = request.agent(app.getHttpServer());
    const csrf = await login(admin, 'ops@hysteria.local', 'admin123!');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    let imageId: string | null = null;

    try {
      const uploaded = await admin
        .post('/api/admin/seo/images')
        .set('X-CSRF-Token', csrf)
        .attach('file', png, 'fixture.png')
        .expect(201);
      imageId = (uploaded.body as { id: string }).id;

      const image = await request(app.getHttpServer())
        .get(`/api/seo/images/${imageId}`)
        .expect(200)
        .expect('Content-Type', 'image/webp')
        .expect('Cross-Origin-Resource-Policy', 'cross-origin')
        .expect('Cache-Control', 'public, max-age=31536000, immutable');
      const etag = image.headers.etag;
      expect(etag).toBeTruthy();

      await request(app.getHttpServer())
        .get(`/api/seo/images/${imageId}`)
        .set('If-None-Match', etag)
        .expect(304);
    } finally {
      if (imageId) await prisma.seoImage.delete({ where: { id: imageId } });
      await rm(directory, { recursive: true, force: true });
      if (previousDirectory === undefined) delete process.env.SEO_IMAGE_DIR;
      else process.env.SEO_IMAGE_DIR = previousDirectory;
    }
  });
});
