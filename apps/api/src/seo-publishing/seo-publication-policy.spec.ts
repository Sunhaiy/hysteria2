/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any. */
import { evaluateSeoDraft } from './seo-content';
import { SeoPublishingService } from './seo-publishing.service';

const draft = {
  id: 'revision-1',
  slug: 'network-check',
  category: '教程',
  title: '网络排查',
  excerpt: '定位连接失败的原因。',
  primaryKeyword: '客户端连接超时排查',
  relatedKeywords: [],
  tags: [],
  seoTitle: '连接故障排查',
  metaDescription: '先检查网络与订阅，再对照节点状态。',
  coverImageId: null,
  coverAlt: null,
  contentJson: {
    type: 'doc',
    content: Array.from({ length: 12 }, (_, index) => ({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `检查项目${index + 1}：先保存当前客户端配置，再检查系统时间和网络是否正常，若仍然无法连接，记录错误消息并在相同配置下更换网络对照结果，避免一次修改多个设置导致无法判断问题原因。`,
        },
      ],
    })),
  },
  qualityReport: {
    passed: false,
    blockers: ['AI 独立审校：资料待补充'],
    warnings: [],
  },
};

function setup(overrides: Partial<typeof draft> = {}) {
  const article = {
    id: 'article-1',
    category: '教程',
    status: 'DRAFT',
    draftRevisionId: draft.id,
    draftRevision: { ...draft, ...overrides },
    publishedRevision: null,
  };
  const tx = {
    seoArticle: {
      update: jest.fn().mockResolvedValue({ status: 'PUBLISHED' }),
    },
    seoArticleRevision: { update: jest.fn().mockResolvedValue({}) },
    seoIndexSubmission: { createMany: jest.fn() },
  };
  const prisma = {
    seoArticle: {
      findUnique: jest.fn().mockResolvedValue(article),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const service = new SeoPublishingService(
    prisma as never,
    { get: jest.fn().mockResolvedValue('false') } as never,
    { del: jest.fn() } as never,
    {} as never,
    {} as never,
  );
  const publish = (actor: string | undefined, confirmation: object) =>
    service.publishArticle(
      'article-1',
      actor,
      new Date(),
      undefined,
      confirmation,
    );
  return { service, publish, prisma, tx };
}

describe('SEO publication policy', () => {
  it('treats editorial formatting as recommendations, not publishing blockers', () => {
    const report = evaluateSeoDraft({ ...draft, existingPlainTexts: [] });
    expect(report.blockers).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(4);
    expect(report.passed).toBe(true);
  });
  it('allows an authenticated editor to confirm a specific reviewed draft despite stale AI findings', async () => {
    const { publish, tx } = setup();
    await expect(
      publish('admin', { confirmed: true, revisionId: draft.id }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(tx.seoArticleRevision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewedById: 'admin' }),
      }),
    );
  });
  it('does not let automatic publishing bypass an unsuccessful review', async () => {
    const { service, prisma } = setup();
    await expect(service.publishArticle('article-1')).rejects.toThrow(
      '质量检查',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('still rejects an empty article even after manual confirmation', async () => {
    const { publish, prisma } = setup({
      contentJson: { type: 'doc', content: [] },
    });
    await expect(
      publish('admin', { confirmed: true, revisionId: draft.id }),
    ).rejects.toThrow('正文过短');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('still rejects absolute service promises after manual confirmation', async () => {
    const { publish, prisma } = setup({
      contentJson: {
        ...draft.contentJson,
        content: [
          ...draft.contentJson.content,
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '本站保证永不掉线。' }],
          },
        ],
      },
    });
    await expect(
      publish('admin', { confirmed: true, revisionId: draft.id }),
    ).rejects.toThrow('绝对化承诺');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, { confirmed: true, revisionId: draft.id }],
    ['admin', { confirmed: true, revisionId: 'old-revision' }],
  ])(
    'rejects anonymous or stale manual confirmation',
    async (actor, confirmation) => {
      const { publish, prisma } = setup();
      await expect(publish(actor, confirmation as object)).rejects.toThrow();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
