import { PrismaClient } from '@prisma/client';
import { SeoPublishingService } from '../src/seo-publishing/seo-publishing.service';
import type { GeneratedArticleDraft } from '../src/seo-publishing/seo-ai.adapter';
import { readSeoSource } from '../src/seo-publishing/seo-source-reader';

jest.mock('../src/seo-publishing/seo-source-reader', () => ({
  ...jest.requireActual<Record<string, unknown>>(
    '../src/seo-publishing/seo-source-reader',
  ),
  readSeoSource: jest.fn(),
}));

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
function draft(keyword: string): GeneratedArticleDraft {
  return {
    title: `${keyword}：逐步定位与处理方法`,
    excerpt:
      '通过客户端、网络、账户状态的逐项核对定位连接失败，并整理可复现的信息进行下一步排查。',
    primaryKeyword: keyword,
    suggestedSlug: 'connection-troubleshooting',
    relatedKeywords: ['客户端网络排查', '节点超时处理'],
    tags: ['排障', '客户端'],
    seoTitle: `${keyword}排障指南与检查步骤`,
    metaDescription: `${keyword}应先定位连接失败环节。本指南面向已导入订阅的用户，介绍客户端、网络和节点检查顺序、正常结果和异常时的处理方式，帮助整理有效排查信息。`,
    coverAlt: '客户端与网络检查流程示意',
    imagePrompt: 'Network troubleshooting illustration',
    searchIntent: '定位连接失败',
    readerOutcome: '找到失败环节',
    lead: `${keyword}应先从本地联网状态检查，再逐项核对客户端配置和节点。`,
    sourceEvidence: [],
    audit: {
      passed: true,
      summary: '步骤清楚，信息有依据',
      issues: [],
      intentCoverage: 95,
      evidenceCoverage: 95,
      actionabilityScore: 95,
      originalityScore: 95,
      checkedAt: new Date().toISOString(),
    },
    sections: [
      '检查本地环境',
      '核对账户与订阅',
      '用对照测试定位',
      '整理后续处理资料',
    ].map((heading, i) => ({
      heading,
      blocks: [
        { type: 'paragraph' as const, text: paragraphs[i * 2] },
        { type: 'paragraph' as const, text: paragraphs[i * 2 + 1] },
        ...(i === 0
          ? [
              {
                type: 'ordered' as const,
                items: [
                  '记录故障时间及客户端版本',
                  '关闭代理后检查本地连接',
                  '恢复原配置并记录对照结果',
                ],
              },
            ]
          : []),
      ],
    })),
  };
}

describe('material generation with real PostgreSQL', () => {
  let prisma: PrismaClient;
  let service: SeoPublishingService;
  let actorId: string;
  let keyword: string;
  const ai = {
    analyzeBrief: jest.fn(),
    research: jest.fn(),
    generateArticle: jest.fn(),
    generateCover: jest.fn(),
  };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/seo_brief_test')
      throw new Error(
        'This suite requires the isolated local seo_brief_test database',
      );
    prisma = new PrismaClient();
    // Clean only fixtures from interrupted runs in this dedicated database.
    const interrupted = await prisma.seoGenerationJob.findMany({
      where: { requestedBy: { email: { startsWith: 'seo-test-' } } },
      select: { id: true, articleId: true, keywordId: true },
    });
    await prisma.seoGenerationJob.deleteMany({
      where: { id: { in: interrupted.map((job) => job.id) } },
    });
    await prisma.seoArticle.deleteMany({
      where: {
        id: {
          in: interrupted.flatMap((job) =>
            job.articleId ? [job.articleId] : [],
          ),
        },
      },
    });
    await prisma.seoKeyword.deleteMany({
      where: {
        id: {
          in: interrupted.flatMap((job) =>
            job.keywordId ? [job.keywordId] : [],
          ),
        },
      },
    });
    actorId = (
      await prisma.user.create({
        data: {
          email: `seo-test-${Date.now()}@example.test`,
          displayName: 'SEO integration fixture',
          passwordHash: 'not-a-login-hash',
          role: 'ADMIN',
        },
      })
    ).id;
    service = new SeoPublishingService(
      prisma as never,
      {
        get: () => Promise.resolve('false'),
        getTutorialConfig: () => Promise.resolve({}),
        getSiteInfo: () => Promise.resolve({ name: '测试站' }),
      } as never,
      { del: jest.fn().mockResolvedValue(undefined) } as never,
      ai as never,
      {} as never,
    );
  });
  beforeEach(async () => {
    // This database is dedicated to this suite; scope cleanup to this actor.
    const jobs = await prisma.seoGenerationJob.findMany({
      where: { requestedById: actorId },
      select: { articleId: true, keywordId: true },
    });
    await prisma.seoGenerationJob.deleteMany({
      where: { requestedById: actorId },
    });
    await prisma.seoArticle.deleteMany({
      where: {
        id: {
          in: jobs.flatMap((job) => (job.articleId ? [job.articleId] : [])),
        },
      },
    });
    await prisma.seoKeyword.deleteMany({
      where: {
        id: {
          in: jobs.flatMap((job) => (job.keywordId ? [job.keywordId] : [])),
        },
      },
    });
    jest.clearAllMocks();
    keyword = `连接超时${Date.now().toString().slice(-6)}`;
    ai.analyzeBrief.mockResolvedValue({
      keyword,
      category: '故障排查',
      searchIntent: '检查连接失败原因',
      missingInformation: [],
      usage: { inputTokens: 12, outputTokens: 15 },
      model: 'test',
    });
    ai.research.mockResolvedValue({
      status: 'unsupported',
      model: 'test',
      baseUrl: 'https://example.test',
      checkedAt: new Date().toISOString(),
      warnings: ['上游不支持联网'],
      sources: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    ai.generateArticle.mockImplementation(() =>
      Promise.resolve({
        article: draft(keyword),
        usage: { inputTokens: 30, outputTokens: 40 },
        modelSnapshot: { textModel: 'test' },
      }),
    );
    ai.generateCover.mockRejectedValue(new Error('图片模型未配置'));
    jest.mocked(readSeoSource).mockResolvedValue({
      id: 'reference',
      title: '官方操作文档',
      url: 'https://example.com/docs',
      content: paragraphs.join('\n'),
      accessedAt: new Date().toISOString(),
      applicableVersion: null,
    });
  });
  afterAll(async () => {
    if (actorId) {
      const jobs = await prisma.seoGenerationJob.findMany({
        where: { requestedById: actorId },
        select: { articleId: true, keywordId: true },
      });
      await prisma.seoGenerationJob.deleteMany({
        where: { requestedById: actorId },
      });
      await prisma.seoArticle.deleteMany({
        where: {
          id: {
            in: jobs.flatMap((job) => (job.articleId ? [job.articleId] : [])),
          },
        },
      });
      await prisma.seoKeyword.deleteMany({
        where: {
          id: {
            in: jobs.flatMap((job) => (job.keywordId ? [job.keywordId] : [])),
          },
        },
      });
      await prisma.user.delete({ where: { id: actorId } });
    }
    await prisma.$disconnect();
  });
  const run = () => service.workerTick(new Date(Date.now() + 1000));

  it.each([
    { material: paragraphs.join('\n') },
    { referenceUrls: ['https://example.com/docs'] },
    {
      material: paragraphs[0],
      referenceUrls: ['https://example.com/docs'],
      audience: '新用户',
      problem: '连接超时',
      mustInclude: '异常分支',
    },
  ])(
    'generates all draft fields without a pre-existing keyword from %j',
    async (input) => {
      const job = await service.queueGenerationRequest(
        { ...input, idempotencyKey: `test-${Date.now()}` },
        actorId,
      );
      expect(job.keywordId).toBeNull();
      await run();
      const result = await service.getGenerationJob(job.id);
      expect(result.lastError).toBeNull();
      expect(ai.generateCover).not.toHaveBeenCalled();
      expect(result.status).toBe('SUCCEEDED');
      expect(result.articleId).toBeTruthy();
      const article = await service.getAdminArticle(result.articleId!);
      expect(article.publishedRevisionId).toBeTruthy();
      expect(article.publishedRevision).toMatchObject({
        primaryKeyword: keyword,
        tags: ['排障', '客户端'],
        slug: 'connection-troubleshooting',
        coverImageId: null,
      });
      expect(article.publishedRevision?.contentHtml).toContain('<h2');
      expect(article.publishedRevision?.seoTitle).toContain(keyword);
      await expect(service.retryGeneration(job.id)).rejects.toThrow();
      await expect(
        service.getPublishedArticle(article.slug),
      ).resolves.toBeTruthy();
    },
  );
  it('replays concurrent clicks once and rejects changed input under the same key', async () => {
    const input = { material: '资料内容', idempotencyKey: 'stable-request' };
    const jobs = await Promise.all([
      service.queueGenerationRequest(input, actorId),
      service.queueGenerationRequest(input, actorId),
    ]);
    expect(jobs[0].id).toBe(jobs[1].id);
    await expect(
      service.queueGenerationRequest(
        { ...input, material: '另一份资料' },
        actorId,
      ),
    ).rejects.toThrow('同一请求');
  });
  it('rechecks initial gaps using newly fetched evidence and publishes', async () => {
    ai.analyzeBrief.mockResolvedValueOnce({
      keyword,
      category: '教程',
      searchIntent: '排障',
      missingInformation: ['客户端版本'],
      usage: {},
      model: 'test',
    });
    ai.research.mockResolvedValue({
      status: 'supported',
      sources: [await readSeoSource('https://example.com/docs')],
      warnings: [],
      usage: {},
    });
    const job = await service.queueGenerationRequest(
      { material: paragraphs.join('\n'), idempotencyKey: 'repair-evidence' },
      actorId,
    );
    await run();
    const result = await service.getGenerationJob(job.id);
    expect(result.status).toBe('SUCCEEDED');
    expect(ai.analyzeBrief).toHaveBeenCalledTimes(2);
    expect(ai.generateArticle).toHaveBeenCalledTimes(2);
    expect(
      (await service.getAdminArticle(result.articleId!)).publishedRevisionId,
    ).toBeTruthy();
  });
  it('keeps historical manual jobs as drafts and refuses to auto-publish a changed revision', async () => {
    const job = await service.queueGenerationRequest(
      { material: paragraphs.join('\n'), idempotencyKey: 'historical' },
      actorId,
    );
    await prisma.seoGenerationJob.update({
      where: { id: job.id },
      data: { inputSnapshot: { material: paragraphs.join('\n') } },
    });
    await run();
    const result = await service.getGenerationJob(job.id);
    const article = await service.getAdminArticle(result.articleId!);
    expect(article.publishedRevisionId).toBeNull();
    await expect(
      service.publishArticle(
        article.id,
        undefined,
        new Date(),
        'stale-revision',
      ),
    ).rejects.toThrow('草稿已被编辑');
    expect(
      (await service.getAdminArticle(article.id)).publishedRevisionId,
    ).toBeNull();
  });
  it('recovers after publishing without generating duplicate revisions', async () => {
    const job = await service.queueGenerationRequest(
      { material: paragraphs.join('\n'), idempotencyKey: 'publish-recovery' },
      actorId,
    );
    await run();
    const original = await service.getGenerationJob(job.id);
    await prisma.seoGenerationJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED' },
    });
    await run();
    const recovered = await service.getGenerationJob(job.id);
    expect(recovered.status).toBe('SUCCEEDED');
    expect(recovered.progress).toContain('自动发布');
    expect(ai.generateArticle).toHaveBeenCalledTimes(1);
    expect(
      await prisma.seoArticleRevision.count({
        where: { articleId: original.articleId! },
      }),
    ).toBe(1);
  });
  it('retains a blocked draft after exactly one unsuccessful automatic revision', async () => {
    const article = draft(keyword);
    article.sections = [];
    ai.generateArticle.mockResolvedValue({
      article,
      usage: { inputTokens: 1, outputTokens: 2 },
      modelSnapshot: {},
    });
    const job = await service.queueGenerationRequest(
      { material: paragraphs.join('\n'), idempotencyKey: 'bad-quality' },
      actorId,
    );
    await run();
    const result = await service.getGenerationJob(job.id);
    expect(result.status).toBe('FAILED');
    expect(result.articleId).toBeTruthy();
    expect(ai.generateArticle).toHaveBeenCalledTimes(2);
    await expect(
      service.publishArticle(result.articleId!, actorId),
    ).rejects.toThrow();
    ai.generateArticle.mockResolvedValue({
      article: draft(keyword),
      usage: {},
      modelSnapshot: {},
    });
    await service.retryGeneration(job.id);
    await run();
    expect((await service.getGenerationJob(job.id)).status).toBe('SUCCEEDED');
    expect(
      (await service.getAdminArticle(result.articleId!)).publishedRevisionId,
    ).toBeTruthy();
  });
  it('reuses completed research after an upstream writing failure', async () => {
    ai.generateArticle.mockRejectedValueOnce(new Error('timeout'));
    const job = await service.queueGenerationRequest(
      { material: paragraphs.join('\n'), idempotencyKey: 'retry-test' },
      actorId,
    );
    await run();
    expect((await service.getGenerationJob(job.id)).status).toBe('FAILED');
    const retries = await Promise.allSettled([
      service.retryGeneration(job.id),
      service.retryGeneration(job.id),
    ]);
    expect(
      retries.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    await run();
    expect(ai.analyzeBrief).toHaveBeenCalledTimes(1);
    expect(ai.research).toHaveBeenCalledTimes(1);
    expect((await service.getGenerationJob(job.id)).status).toBe('SUCCEEDED');
  });
  it('rejects a second job for an already generated topic without modifying the original', async () => {
    const first = await service.queueGenerationRequest(
      { material: paragraphs.join('\n'), idempotencyKey: 'topic-one' },
      actorId,
    );
    await run();
    const original = await service.getGenerationJob(first.id);
    const second = await service.queueGenerationRequest(
      { material: paragraphs.join('\n'), idempotencyKey: 'topic-two' },
      actorId,
    );
    await run();
    const result = await service.getGenerationJob(second.id);
    expect(result.status).toBe('FAILED');
    expect(result.lastError).toContain('相同主题');
    expect(result.articleId).toBeNull();
    expect(
      await prisma.seoArticleRevision.count({
        where: { articleId: original.articleId! },
      }),
    ).toBe(1);
  });
  it('resolves slug collisions without overwriting another article', async () => {
    const other = await prisma.seoArticle.create({
      data: { slug: 'connection-troubleshooting', category: '教程' },
    });
    try {
      const job = await service.queueGenerationRequest(
        { material: paragraphs.join('\n'), idempotencyKey: 'slug-test' },
        actorId,
      );
      await run();
      const result = await service.getGenerationJob(job.id);
      expect(result.article?.slug).toBe('connection-troubleshooting-2');
      expect(
        (await prisma.seoArticle.findUniqueOrThrow({ where: { id: other.id } }))
          .draftRevisionId,
      ).toBeNull();
    } finally {
      await prisma.seoArticle.delete({ where: { id: other.id } });
    }
  });
  it('retains a draft with explicit missing-information blockers if links cannot be read', async () => {
    ai.generateArticle.mockImplementation(() => {
      const article = draft(keyword);
      article.audit.passed = false;
      article.audit.issues = [
        {
          severity: 'BLOCKER',
          category: 'MISSING_SOURCE',
          message: '资料待补充：正文声称的客户端版本和下载来源无法核实',
        },
      ];
      return Promise.resolve({ article, usage: {}, modelSnapshot: {} });
    });
    jest
      .mocked(readSeoSource)
      .mockRejectedValue(new Error('private network blocked'));
    ai.analyzeBrief.mockResolvedValue({
      keyword,
      category: '教程',
      searchIntent: '排障',
      missingInformation: ['请提供适用客户端版本和实际操作步骤'],
      usage: {},
      model: 'test',
    });
    const job = await service.queueGenerationRequest(
      {
        referenceUrls: ['https://example.com/unreadable'],
        idempotencyKey: 'missing-source',
      },
      actorId,
    );
    await run();
    const result = await service.getGenerationJob(job.id);
    expect(result.status).toBe('FAILED');
    expect(result.lastError).toContain('资料待补充');
    expect(JSON.stringify(result.research)).toContain('读取失败');
    const existing = await service.getAdminArticle(result.articleId!);
    const revision = existing.draftRevision!;
    const saved = await service.saveArticle(
      existing.id,
      {
        slug: revision.slug,
        category: existing.category,
        title: revision.title,
        excerpt: revision.excerpt,
        contentJson: revision.contentJson as Record<string, unknown>,
        primaryKeyword: revision.primaryKeyword,
        relatedKeywords: revision.relatedKeywords,
        tags: revision.tags,
        seoTitle: revision.seoTitle,
        metaDescription: revision.metaDescription,
        coverAlt: revision.coverAlt ?? undefined,
      },
      actorId,
    );
    expect(saved.draftRevision?.qualityReport).toMatchObject({ passed: false });
    await expect(
      service.publishArticle(result.articleId!, actorId),
    ).rejects.toThrow();
  });
  it('reframes a failed internal-audit topic without replacing the article or requiring unrelated evidence', async () => {
    const bad = draft(keyword);
    bad.audit.passed = false;
    bad.audit.issues = [
      {
        severity: 'BLOCKER',
        category: 'INTENT',
        message: '仅内部核验清单，未解决读者问题',
      },
    ];
    ai.generateArticle.mockResolvedValue({
      article: bad,
      usage: {},
      modelSnapshot: {},
    });
    const job = await service.queueGenerationRequest(
      { material: paragraphs.join('\n'), idempotencyKey: 'reframe-retry' },
      actorId,
    );
    await run();
    const failed = await service.getGenerationJob(job.id);
    expect(failed.status).toBe('FAILED');
    const oldKeyword = failed.keywordId;
    keyword = `Windows使用指南${Date.now().toString().slice(-6)}`;
    ai.analyzeBrief.mockResolvedValue({
      keyword,
      category: '教程',
      searchIntent: '通用客户端使用指南',
      missingInformation: ['站内附件哈希未确认，但通用正文不涉及该附件'],
      usage: {},
      model: 'test',
    });
    ai.generateArticle.mockImplementation(() =>
      Promise.resolve({
        article: draft(keyword),
        usage: {},
        modelSnapshot: {},
      }),
    );
    await service.retryGeneration(job.id);
    await run();
    const result = await service.getGenerationJob(job.id);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.articleId).toBe(failed.articleId);
    expect(result.keywordId).not.toBe(oldKeyword);
    const article = await service.getAdminArticle(result.articleId!);
    expect(article.publishedRevision?.primaryKeyword).toBe(keyword);
    expect(
      await prisma.seoArticleRevision.count({
        where: { articleId: article.id },
      }),
    ).toBe(2);
    expect(
      (
        await prisma.seoKeyword.findUniqueOrThrow({
          where: { id: oldKeyword! },
        })
      ).articleId,
    ).toBeNull();
    await prisma.seoKeyword.delete({ where: { id: oldKeyword! } });
  });
});
