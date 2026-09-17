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
    const paragraphs = [
      '连接超时只说明客户端没有在规定时间内完成连接，不能单凭这一提示认定账户失效。先记录发生时间、客户端版本和节点名称，再判断故障发生在订阅导入、连接建立还是打开网页这一步。不同阶段需要查看不同位置的日志。',
      '关闭代理后打开一个平时可以直接访问的网站，确认当前网络本身可以联网。如果直连也失败，应先处理无线网络登录、路由器或者运营商连接。不要反复购买套餐或重置额度，这些操作不会修复本地断网，也会增加不必要的支出。',
      '在账户页面核对当前生效的套餐、到期时间和剩余额度，特别留意预约切换的套餐是否还没到开始时间。付款记录不等于新套餐已立即生效；发现状态不一致时，把订单编号交给客服核对，切勿在公开讨论区发送完整订阅地址。',
      '检查订阅更新是否成功，再看客户端当前选择的配置文件是不是刚更新的那份。多个同名配置容易造成误选，更新后应核对节点名称与更新时间。若订阅下载本身报错，先处理下载失败，不要把旧配置的连接结果当作新配置测试结果。',
      '保持其他设置不变，换一个节点进行对照测试。如果仅一个节点失败，记录该节点及测试时间；如果所有节点失败，再切换到手机热点测试同一个节点。每次只改变一个条件，这样才能区分节点故障和本地网络对协议的限制。',
      '检查系统日期和时间是否准确，时间偏差可能影响安全连接校验。客户端日志里若出现证书相关错误，应核对系统时间和服务地址，而不是直接关闭证书验证。关闭验证会降低连接安全性，不能作为普通排障的默认处理办法。',
      '连接建立但部分网页打不开时，核对代理模式与规则命中情况，确认请求是否经过预期节点。可以临时用另一个已知正常的网站对照，完成测试后恢复原来的设置。网站自身的故障、账号限制和节点连通问题并不是同一件事。',
      '仍无法定位时，整理客户端名称、系统版本、故障时间、节点名称以及两次对照测试的结果提交工单。截图前隐藏邮箱、订阅令牌和支付信息。客服需要的是可复现的现象，不需要账户密码；处理完成后重新测试原先失败的步骤。',
    ];
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
            { type: 'text', text: `${paragraphs[0]}<script>alert(1)</script>` },
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
            { type: 'text', text: paragraphs[1] },
            { type: 'text', text: '继续查看' },
            {
              type: 'text',
              text: '使用指南',
              marks: [{ type: 'link', attrs: { href: '/blog' } }],
            },
          ],
        },
        ...paragraphs.slice(2).map((text) => ({
          type: 'paragraph',
          content: [{ type: 'text', text }],
        })),
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: '记录错误时间与节点名称，保留脱敏后的错误日志。',
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: '分别更换网络和节点，记录每一次对照测试的结果。',
                    },
                  ],
                },
              ],
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
        '客户端连接失败时，按顺序检查配置、订阅更新时间、本地网络和服务节点，通过对照测试定位超时的具体原因。',
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
      expect(
        responseBody<{
          currentRevision: { qualityReport: { blockers: string[] } };
        }>(created).currentRevision.qualityReport.blockers,
      ).toEqual([]);
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
