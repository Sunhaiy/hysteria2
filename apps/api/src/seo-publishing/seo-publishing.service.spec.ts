/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any. */
import { Prisma } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeoPublishingService } from './seo-publishing.service';

describe('SeoPublishingService publication boundary', () => {
  it('publishes one reviewed revision and queues idempotent engine submissions', async () => {
    const now = new Date('2026-09-10T02:00:00.000Z');
    const article = {
      id: 'article-1',
      slug: 'old-guide',
      status: 'PUBLISHED',
      draftRevisionId: 'revision-2',
      publishedRevisionId: 'revision-1',
      draftRevision: {
        id: 'revision-2',
        slug: 'new-guide',
        qualityReport: { passed: true, blockers: [] },
      },
      publishedRevision: { id: 'revision-1' },
    };
    const tx = {
      seoRedirect: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      seoArticleRevision: { update: jest.fn().mockResolvedValue(undefined) },
      seoArticle: {
        update: jest.fn().mockResolvedValue({ ...article, slug: 'new-guide' }),
      },
      seoIndexSubmission: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      seoArticle: { findUnique: jest.fn().mockResolvedValue(article) },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const settings = {
      get: jest.fn((key: string) =>
        Promise.resolve(
          ['seo.indexNowEnabled', 'seo.googleEnabled'].includes(key)
            ? 'true'
            : undefined,
        ),
      ),
    };
    const service = new SeoPublishingService(
      prisma as never,
      settings as never,
      { get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await service.publishArticle('article-1', 'admin-1', now);

    expect(tx.seoRedirect.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fromSlug: 'old-guide' },
        create: expect.objectContaining({ toSlug: 'new-guide' }),
      }),
    );
    expect(tx.seoRedirect.deleteMany).toHaveBeenCalledWith({
      where: { articleId: 'article-1', fromSlug: 'new-guide' },
    });
    expect(tx.seoRedirect.updateMany).toHaveBeenCalledWith({
      where: { articleId: 'article-1' },
      data: { toSlug: 'new-guide' },
    });
    expect(tx.seoArticle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PUBLISHED',
          slug: 'new-guide',
          publishedRevisionId: 'revision-2',
          draftRevisionId: null,
        }),
      }),
    );
    expect(tx.seoIndexSubmission.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          engine: 'BING_INDEXNOW',
          idempotencyKey: 'BING_INDEXNOW:revision-2:UPDATE',
        }),
        expect.objectContaining({
          engine: 'GOOGLE_SITEMAP',
          idempotencyKey: 'GOOGLE_SITEMAP:revision-2:UPDATE',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('refuses to publish a revision that has blocking quality failures', async () => {
    const prisma = {
      seoArticle: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'article-1',
          draftRevisionId: 'revision-1',
          draftRevision: {
            id: 'revision-1',
            qualityReport: { passed: false, blockers: ['正文过短'] },
          },
          publishedRevision: null,
        }),
      },
    };
    const service = new SeoPublishingService(
      prisma as never,
      { get: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.publishArticle('article-1', 'admin-1'),
    ).rejects.toThrow('文章尚未通过质量检查');
  });

  it('preserves the recorded reviewer when a scheduled article is published', async () => {
    const revisionUpdate = jest.fn().mockResolvedValue(undefined);
    const article = {
      id: 'article-1',
      slug: 'scheduled-guide',
      status: 'SCHEDULED',
      draftRevisionId: 'revision-2',
      publishedRevisionId: null,
      publishedAt: null,
      draftRevision: {
        id: 'revision-2',
        slug: 'scheduled-guide',
        reviewedById: 'admin-1',
        reviewedAt: new Date('2026-09-09T02:00:00.000Z'),
        qualityReport: { passed: true, blockers: [] },
      },
      publishedRevision: null,
    };
    const tx = {
      seoRedirect: { upsert: jest.fn() },
      seoArticleRevision: { update: revisionUpdate },
      seoArticle: {
        update: jest
          .fn()
          .mockResolvedValue({ ...article, status: 'PUBLISHED' }),
      },
      seoIndexSubmission: { createMany: jest.fn() },
    };
    const service = new SeoPublishingService(
      {
        seoArticle: { findUnique: jest.fn().mockResolvedValue(article) },
        $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
          work(tx),
        ),
      } as never,
      { get: jest.fn().mockResolvedValue('false') } as never,
      { del: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await service.publishArticle('article-1', undefined, new Date());

    expect(revisionUpdate).not.toHaveBeenCalled();
  });

  it('only permits failed generation and indexing tasks to be retried', async () => {
    const generationUpdate = jest.fn();
    const indexUpdate = jest.fn();
    const prisma = {
      seoGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'generation-1',
          status: 'SUCCEEDED',
        }),
        update: generationUpdate,
      },
      seoIndexSubmission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'index-1',
          status: 'SUCCEEDED',
        }),
        update: indexUpdate,
      },
    };
    const service = new SeoPublishingService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.retryGeneration('generation-1')).rejects.toThrow(
      '只有失败的生成任务可以重试',
    );
    await expect(service.retryIndexSubmission('index-1')).rejects.toThrow(
      '只有失败的索引任务可以重试',
    );
    expect(generationUpdate).not.toHaveBeenCalled();
    expect(indexUpdate).not.toHaveBeenCalled();
  });

  it('resets a failed index submission before a manual retry', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'index-1' });
    const service = new SeoPublishingService(
      {
        seoIndexSubmission: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'index-1',
            status: 'FAILED',
            attempts: 6,
          }),
          update,
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.retryIndexSubmission('index-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'index-1' },
      data: expect.objectContaining({
        status: 'PENDING',
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
      }),
    });
  });

  it('creates one idempotent draft job on each configured weekday', async () => {
    const keys = new Set<string>();
    const generationJobs = {
      findUnique: jest.fn(({ where }: { where: { idempotencyKey: string } }) =>
        Promise.resolve(
          keys.has(where.idempotencyKey)
            ? { idempotencyKey: where.idempotencyKey }
            : null,
        ),
      ),
      create: jest.fn(({ data }: { data: { idempotencyKey: string } }) => {
        keys.add(data.idempotencyKey);
        return Promise.resolve(data);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = {
      seoGenerationJob: generationJobs,
      seoKeyword: {
        findFirst: jest.fn().mockResolvedValue({ id: 'keyword-1' }),
      },
      seoArticle: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      seoIndexSubmission: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const settings = {
      get: jest.fn((key: string) =>
        Promise.resolve(
          {
            'seo.enabled': 'true',
            'seo.scheduleDays': '1,3,5',
            'seo.scheduleHour': '10',
            'seo.googleEnabled': 'false',
          }[key],
        ),
      ),
    };
    const service = new SeoPublishingService(
      prisma as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const monday = new Date('2026-09-07T02:00:00.000Z');
    const tuesday = new Date('2026-09-08T02:00:00.000Z');
    const wednesday = new Date('2026-09-09T02:00:00.000Z');
    const friday = new Date('2026-09-11T02:00:00.000Z');
    await expect(service.workerTick(monday)).resolves.toMatchObject({
      scheduledJobs: 1,
    });
    await expect(service.workerTick(monday)).resolves.toMatchObject({
      scheduledJobs: 0,
    });
    await expect(service.workerTick(tuesday)).resolves.toMatchObject({
      scheduledJobs: 0,
    });
    await expect(service.workerTick(wednesday)).resolves.toMatchObject({
      scheduledJobs: 1,
    });
    await expect(service.workerTick(friday)).resolves.toMatchObject({
      scheduledJobs: 1,
    });
    expect([...keys]).toEqual([
      'schedule:2026-09-07',
      'schedule:2026-09-09',
      'schedule:2026-09-11',
    ]);
  });

  it('treats a concurrent scheduled-job unique-key race as an idempotent replay', async () => {
    const uniqueConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    const service = new SeoPublishingService(
      {
        seoGenerationJob: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockRejectedValue(uniqueConflict),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        seoKeyword: {
          findFirst: jest.fn().mockResolvedValue({ id: 'keyword-1' }),
        },
        seoArticle: { findMany: jest.fn().mockResolvedValue([]) },
        seoIndexSubmission: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([]),
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          Promise.resolve(
            {
              'seo.enabled': 'true',
              'seo.scheduleDays': '1,3,5',
              'seo.scheduleHour': '10',
              'seo.googleEnabled': 'false',
            }[key],
          ),
        ),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.workerTick(new Date('2026-09-07T02:00:00.000Z')),
    ).resolves.toMatchObject({ scheduledJobs: 0 });
  });

  it('creates a new checked revision when an administrator regenerates a cover', async () => {
    const previousDirectory = process.env.SEO_IMAGE_DIR;
    const directory = await mkdtemp(join(tmpdir(), 'seo-cover-test-'));
    process.env.SEO_IMAGE_DIR = directory;
    const source = {
      id: 'revision-2',
      articleId: 'article-1',
      version: 2,
      source: 'MANUAL',
      slug: 'client-guide',
      title: '客户端连接排查指南',
      excerpt: '逐项检查客户端连接问题。',
      contentJson: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
        ],
      },
      contentHtml: '<p>正文</p>',
      primaryKeyword: '客户端连接排查',
      relatedKeywords: ['连接超时'],
      tags: ['客户端'],
      seoTitle: '客户端连接排查指南',
      metaDescription: '逐项检查客户端、本地网络和节点状态，定位连接问题。',
      coverImageId: null,
      coverAlt: '客户端连接排查步骤示意图',
      qualityScore: 70,
      qualityReport: { passed: false, blockers: ['缺少封面'] },
      modelSnapshot: null,
      promptVersion: null,
      createdById: 'admin-1',
      reviewedById: null,
      reviewedAt: null,
      createdAt: new Date(),
    };
    const createdRevision = { ...source, id: 'revision-3', version: 3 };
    const revisionCreate = jest.fn().mockResolvedValue(createdRevision);
    const revisionUpdate = jest.fn();
    const articleUpdate = jest.fn().mockResolvedValue(undefined);
    const tx = {
      seoArticleRevision: { create: revisionCreate },
      seoArticle: { update: articleUpdate },
    };
    const prisma = {
      seoArticle: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'article-1',
          publishedRevisionId: null,
          draftRevision: source,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      seoArticleRevision: {
        findFirst: jest.fn().mockResolvedValue({ version: 2 }),
        update: revisionUpdate,
      },
      seoImage: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'image-new', ...data }),
          ),
        findUnique: jest.fn().mockResolvedValue({ id: 'image-new' }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const service = new SeoPublishingService(
      prisma as never,
      {} as never,
      {} as never,
      { generateCover: jest.fn().mockResolvedValue(png) } as never,
      {} as never,
    );

    try {
      await expect(
        service.regenerateCover('article-1', 'admin-2'),
      ).resolves.toMatchObject({
        url: 'http://localhost:4000/api/seo/images/image-new',
      });
    } finally {
      if (previousDirectory === undefined) delete process.env.SEO_IMAGE_DIR;
      else process.env.SEO_IMAGE_DIR = previousDirectory;
      await rm(directory, { recursive: true, force: true });
    }

    expect(revisionUpdate).not.toHaveBeenCalled();
    expect(revisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        articleId: 'article-1',
        version: 3,
        source: 'MANUAL',
        coverImageId: 'image-new',
        coverAlt: '客户端连接排查步骤示意图',
        createdById: 'admin-2',
      }),
    });
    expect(articleUpdate).toHaveBeenCalledWith({
      where: { id: 'article-1' },
      data: expect.objectContaining({ draftRevisionId: 'revision-3' }),
    });
  });

  it('returns stale worker tasks to their retry queues', async () => {
    const generationUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValue({ count: 0 });
    const indexUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });
    const prisma = {
      seoGenerationJob: {
        updateMany: generationUpdateMany,
        findMany: jest.fn().mockResolvedValue([]),
      },
      seoIndexSubmission: {
        updateMany: indexUpdateMany,
        findMany: jest.fn().mockResolvedValue([]),
      },
      seoArticle: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new SeoPublishingService(
      prisma as never,
      { get: jest.fn().mockResolvedValue('false') } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.workerTick(new Date('2026-09-10T02:00:00.000Z')),
    ).resolves.toMatchObject({ recovered: 3 });
    expect(generationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'RUNNING' }),
        data: expect.objectContaining({ status: 'QUEUED' }),
      }),
    );
    expect(indexUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'RUNNING' }),
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('reports high-impression keywords and low-CTR pages separately', async () => {
    const rows = [
      {
        date: new Date(),
        query: 'macOS 客户端教程',
        page: 'https://example.com/blog/macos',
        clicks: 3,
        impressions: 500,
        ctr: 0.006,
        position: 4,
      },
      {
        date: new Date(),
        query: '节点状态',
        page: 'https://example.com/blog/status',
        clicks: 30,
        impressions: 200,
        ctr: 0.15,
        position: 2,
      },
    ];
    const service = new SeoPublishingService(
      {
        seoSearchMetric: { findMany: jest.fn().mockResolvedValue(rows) },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.analytics();

    expect(result.highImpressionQueries[0]).toMatchObject({
      value: 'macOS 客户端教程',
      impressions: 500,
    });
    expect(result.lowCtrPages).toEqual([
      expect.objectContaining({
        value: 'https://example.com/blog/macos',
        impressions: 500,
        ctr: 0.006,
      }),
    ]);
  });

  it('upserts repeated Search Console rows by a stable fingerprint', async () => {
    const settingsValues = new Map<string, string>([
      ['seo.enabled', 'false'],
      ['seo.googleEnabled', 'true'],
    ]);
    const metrics = new Map<string, Record<string, unknown>>();
    const metricUpsert = jest.fn(
      (input: {
        where: { fingerprint: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const current = metrics.get(input.where.fingerprint);
        metrics.set(input.where.fingerprint, {
          ...(current ?? input.create),
          ...(current ? input.update : {}),
        });
        return Promise.resolve(metrics.get(input.where.fingerprint));
      },
    );
    const prisma = {
      seoGenerationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      seoIndexSubmission: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      seoArticle: {
        findMany: jest.fn((input: { select?: Record<string, boolean> }) =>
          Promise.resolve(
            input.select ? [{ id: 'article-1', slug: 'guide' }] : [],
          ),
        ),
      },
      seoSearchMetric: { upsert: metricUpsert },
    };
    const settings = {
      get: jest.fn((key: string) => Promise.resolve(settingsValues.get(key))),
      setMany: jest.fn((values: Record<string, string>) => {
        for (const [key, value] of Object.entries(values)) {
          settingsValues.set(key, value);
        }
        return Promise.resolve(undefined);
      }),
    };
    const row = {
      date: '2026-09-09',
      page: 'https://example.com/blog/guide',
      query: '客户端教程',
      clicks: 4,
      impressions: 100,
      ctr: 0.04,
      position: 3.2,
    };
    const service = new SeoPublishingService(
      prisma as never,
      settings as never,
      {} as never,
      {} as never,
      { fetchGoogleMetrics: jest.fn().mockResolvedValue([row]) } as never,
    );

    await expect(
      service.workerTick(new Date('2026-09-10T20:00:00.000Z')),
    ).resolves.toMatchObject({ metrics: 1 });
    await expect(
      service.workerTick(new Date('2026-09-11T20:00:00.000Z')),
    ).resolves.toMatchObject({ metrics: 1 });

    expect(metricUpsert).toHaveBeenCalledTimes(2);
    expect(metrics).toHaveProperty('size', 1);
    expect([...metrics.values()][0]).toMatchObject({
      articleId: 'article-1',
      clicks: 4,
      impressions: 100,
    });
  });

  it('adds a revision instead of duplicating an article when AI generation is retried', async () => {
    const keyword = {
      id: 'keyword-1',
      keyword: 'macOS 客户端教程',
      category: '客户端教程',
      articleId: 'article-existing',
    };
    const generationUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const generationUpdate = jest.fn().mockResolvedValue(undefined);
    const articleCreate = jest.fn();
    const revisionCreate = jest.fn().mockResolvedValue({
      id: 'revision-3',
      qualityReport: { passed: true, blockers: [] },
    });
    const articleUpdate = jest.fn().mockResolvedValue({
      id: 'article-existing',
      slug: 'macos-client-guide',
    });
    const tx = {
      seoArticle: { create: articleCreate, update: articleUpdate },
      seoArticleRevision: { create: revisionCreate },
      seoKeyword: { update: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      seoGenerationJob: {
        updateMany: generationUpdateMany,
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'generation-1',
            articleId: 'article-existing',
            attempts: 1,
            keyword,
          },
        ]),
        update: generationUpdate,
      },
      seoIndexSubmission: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      seoArticle: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'article-existing',
          publishedRevisionId: null,
        }),
      },
      seoArticleRevision: {
        findFirst: jest.fn().mockResolvedValue({ version: 2 }),
      },
      seoRedirect: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const service = new SeoPublishingService(
      prisma as never,
      {
        get: jest.fn().mockResolvedValue('false'),
        getTutorialConfig: jest.fn().mockResolvedValue({}),
        getSiteInfo: jest.fn().mockResolvedValue({ name: '素心 Network' }),
      } as never,
      {} as never,
      {
        generateArticle: jest.fn().mockResolvedValue({
          article: {
            title: 'macOS 客户端连接教程',
            excerpt: '从安装到连接逐步完成配置。',
            primaryKeyword: 'macOS 客户端教程',
            relatedKeywords: ['客户端安装'],
            tags: ['macOS'],
            seoTitle: 'macOS 客户端连接教程',
            metaDescription: '介绍 macOS 客户端安装、订阅导入和连接排查。',
            coverAlt: 'macOS 客户端连接步骤示意图',
            imagePrompt: 'macOS client setup',
            searchIntent: '完成 macOS 客户端连接',
            readerOutcome: '可以导入订阅并检查连接状态',
            lead: 'macOS 客户端教程应从安装和订阅导入开始。',
            sourceEvidence: [
              {
                claim: '公开教程提供 macOS 客户端安装步骤。',
                sourceId: 'tutorial-macos',
                sourceTitle: 'macOS 使用教程',
                sourceUrl: 'https://example.test/api/tutorial-assets#macos',
                sourceQuote: 'macOS 客户端安装步骤',
                accessedAt: '2026-09-11T05:00:00.000Z',
                applicableVersion: '当前公开教程',
              },
            ],
            audit: {
              passed: true,
              summary: '检查通过',
              issues: [],
              intentCoverage: 95,
              evidenceCoverage: 100,
              actionabilityScore: 90,
              originalityScore: 90,
              checkedAt: '2026-09-11T05:00:00.000Z',
            },
            sections: [],
          },
          usage: { inputTokens: 10, outputTokens: 20 },
          modelSnapshot: { textModel: 'test-model' },
        }),
        generateCover: jest.fn().mockRejectedValue(new Error('no image model')),
      } as never,
      {} as never,
    );

    await expect(
      service.workerTick(new Date('2026-09-10T02:00:00.000Z')),
    ).resolves.toMatchObject({ generated: 1 });

    expect(articleCreate).not.toHaveBeenCalled();
    expect(revisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        articleId: 'article-existing',
        version: 3,
        source: 'AI',
        sourceEvidence: expect.any(Array),
        aiAudit: expect.objectContaining({ passed: true }),
        lastVerifiedAt: new Date('2026-09-11T05:00:00.000Z'),
      }),
    });
    expect(articleUpdate).toHaveBeenCalledWith({
      where: { id: 'article-existing' },
      data: expect.objectContaining({ draftRevisionId: 'revision-3' }),
    });
    expect(generationUpdate).toHaveBeenCalledWith({
      where: { id: 'generation-1' },
      data: expect.objectContaining({
        articleId: 'article-existing',
        status: 'SUCCEEDED',
        usage: expect.objectContaining({
          inputTokens: 10,
          outputTokens: 20,
          image: expect.objectContaining({
            status: 'failed',
            error: 'no image model',
          }),
        }),
      }),
    });
  });

  it('backs off a failed IndexNow submission and caps automatic attempts at six', async () => {
    const now = new Date('2026-09-10T02:00:00.000Z');
    const indexFindMany = jest.fn().mockResolvedValue([
      {
        id: 'index-1',
        engine: 'BING_INDEXNOW',
        url: 'https://example.com/blog/guide',
        attempts: 0,
      },
    ]);
    const indexUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const indexUpdate = jest.fn().mockResolvedValue(undefined);
    const service = new SeoPublishingService(
      {
        seoGenerationJob: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        seoArticle: { findMany: jest.fn().mockResolvedValue([]) },
        seoIndexSubmission: {
          updateMany: indexUpdateMany,
          findMany: indexFindMany,
          update: indexUpdate,
        },
      } as never,
      { get: jest.fn().mockResolvedValue('false') } as never,
      {} as never,
      {} as never,
      {
        submitIndexNow: jest.fn().mockRejectedValue(new Error('gateway down')),
      } as never,
    );

    await expect(service.workerTick(now)).resolves.toMatchObject({
      indexed: 0,
    });

    expect(indexFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attempts: { lt: 6 } }),
      }),
    );
    expect(indexUpdate).toHaveBeenCalledWith({
      where: { id: 'index-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        lastError: 'gateway down',
        nextRetryAt: new Date('2026-09-10T02:02:00.000Z'),
      }),
    });
  });
});
