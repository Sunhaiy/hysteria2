import { SeoAiAdapter } from './seo-ai.adapter';

function aiResponse(value: Record<string, unknown>, input = 10, output = 20) {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify(value),
      usage: { input_tokens: input, output_tokens: output },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function configuredSettings() {
  return {
    get: jest.fn((key: string) =>
      Promise.resolve(
        {
          'seo.aiBaseUrl': 'https://example.test/v1',
          'seo.textModel': 'text-model',
          'seo.timeoutMs': '30000',
        }[key],
      ),
    ),
    getSecret: jest.fn(() => Promise.resolve('secret')),
  };
}

describe('SeoAiAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('generates evidence, body, metadata, and an independent audit in order', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        aiResponse({
          searchIntent: '用户需要定位 macOS 连接超时的具体环节。',
          readerOutcome: '读者可以判断问题出在客户端、本地网络还是节点。',
          audience: '已经导入订阅但无法连接的 macOS 用户',
          directAnswer: '按客户端、本地网络、节点状态的顺序检查。',
          outline: ['先定位故障层级', '按顺序排查', '判断结果'],
          evidence: [
            {
              claim: '公开教程支持按顺序检查客户端与节点。',
              sourceId: 'tutorial-macos',
              sourceQuote: '按顺序检查客户端与节点',
              applicableVersion: '当前公开教程',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        aiResponse({
          title: 'macOS 连接超时完整排查指南',
          lead: 'macOS 连接超时应先区分客户端、本地网络和节点故障。',
          imagePrompt: 'Editorial network troubleshooting illustration',
          sections: [
            {
              heading: '先定位故障层级',
              blocks: [
                {
                  type: 'paragraph',
                  text: '公开教程支持按顺序检查客户端与节点。',
                },
              ],
            },
            {
              heading: '按顺序检查',
              blocks: [
                {
                  type: 'ordered',
                  items: ['检查客户端状态', '切换网络后复测'],
                },
              ],
            },
            {
              heading: '判断检查结果',
              blocks: [
                {
                  type: 'paragraph',
                  text: '每次只改变一个条件，再根据复测结果继续定位。',
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        aiResponse({
          excerpt: '按顺序检查客户端、本地网络和节点，定位连接失败环节。',
          primaryKeyword: 'macOS 连接超时',
          relatedKeywords: ['Clash 超时', 'macOS 网络检查', '节点连接失败'],
          tags: ['macOS', '连接排查'],
          seoTitle: 'macOS 连接超时排查步骤',
          metaDescription:
            '面向连接失败用户，按客户端、本地网络和节点状态排查 macOS 连接超时。',
          coverAlt: 'macOS 网络连接排查步骤示意图',
        }),
      )
      .mockResolvedValueOnce(
        aiResponse({
          passed: true,
          summary: '事实有来源，步骤与搜索意图一致。',
          issues: [],
          intentCoverage: 94,
          evidenceCoverage: 100,
          actionabilityScore: 90,
          originalityScore: 88,
        }),
      );
    const adapter = new SeoAiAdapter(configuredSettings() as never);

    const result = await adapter.generateArticle({
      keyword: 'macOS 连接超时',
      category: '故障排查',
      searchIntent: '定位连接失败原因',
      sources: [
        {
          id: 'tutorial-macos',
          title: 'macOS 使用教程',
          url: 'https://example.test/api/tutorial-assets#macos',
          content: '公开教程内容：按顺序检查客户端与节点。',
          accessedAt: '2026-09-11T05:00:00.000Z',
          applicableVersion: '当前公开教程',
        },
      ],
      existingArticles: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.article.primaryKeyword).toBe('macOS 连接超时');
    expect(result.article.sourceEvidence[0]).toMatchObject({
      sourceTitle: 'macOS 使用教程',
      sourceQuote: '按顺序检查客户端与节点',
    });
    expect(result.article.audit).toMatchObject({
      passed: true,
      intentCoverage: 94,
    });
    expect(result.usage.inputTokens).toBe(40);
    expect(result.usage.outputTokens).toBe(80);
    expect(Object.keys(result.usage.stages)).toEqual([
      'evidence',
      'draft',
      'metadata',
      'audit',
    ]);
    expect(result.modelSnapshot.version).toBe('seo-zh-evidence-first-v3');
    expect(result.modelSnapshot.evidenceCount).toBe(1);
    expect(result.modelSnapshot.audit.passed).toBe(true);

    const prompts = fetchMock.mock.calls.map((call) => {
      const raw = call[1]?.body;
      if (typeof raw !== 'string') throw new Error('请求体必须为 JSON');
      const request = JSON.parse(raw) as { input: string };
      return request.input;
    });
    expect(prompts[0]).toContain('目标搜索意图：定位连接失败原因');
    expect(prompts[1]).toContain('依据已经核验的计划写正文');
    expect(prompts[2]).toContain('正文已经定稿');
    expect(prompts[3]).toContain('独立于作者的严格技术编辑');
  });

  it('rejects site-specific claims without an exact public source quote', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      aiResponse({
        searchIntent: '定位 macOS 连接超时原因。',
        readerOutcome: '判断连接失败所在环节。',
        audience: 'macOS 用户',
        directAnswer: '先检查客户端。',
        outline: ['检查客户端', '检查网络'],
        evidence: [
          {
            claim: '平台在所有地区都有专属节点。',
            sourceId: 'site-info',
            sourceQuote: '所有地区都有专属节点',
            applicableVersion: '',
          },
        ],
      }),
    );
    const adapter = new SeoAiAdapter(configuredSettings() as never);

    await expect(
      adapter.generateArticle({
        keyword: 'macOS 连接超时',
        category: '故障排查',
        sources: [
          {
            id: 'site-info',
            title: '站点公开信息',
            url: 'https://example.test/api/site',
            content: '公开资料只说明如何更新订阅。',
            accessedAt: '2026-09-11T05:00:00.000Z',
            applicableVersion: null,
          },
        ],
        existingArticles: [],
      }),
    ).rejects.toThrow('公开资料中找不到原文依据');
  });

  it('rejects generation while the provider is not configured', async () => {
    const adapter = new SeoAiAdapter({
      get: jest.fn(() => Promise.resolve(undefined)),
      getSecret: jest.fn(() => Promise.resolve(undefined)),
    } as never);

    await expect(
      adapter.generateArticle({
        keyword: '客户端教程',
        category: '教程',
        sources: [],
        existingArticles: [],
      }),
    ).rejects.toThrow('AI 服务尚未配置');
  });
});
