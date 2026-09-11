import { SeoAiAdapter } from './seo-ai.adapter';

describe('SeoAiAdapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the Responses interface and returns structured article data', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            title: 'macOS 连接超时完整排查指南',
            excerpt: '按顺序检查客户端与节点。',
            primaryKeyword: 'macOS 连接超时',
            relatedKeywords: ['Clash 超时'],
            seoTitle: 'macOS 连接超时排查指南',
            metaDescription:
              '从客户端、本地网络和节点状态定位 macOS 连接超时。',
            coverAlt: 'macOS 网络连接排查示意图',
            imagePrompt: 'Editorial network troubleshooting illustration',
            sections: [],
          }),
          usage: { input_tokens: 120, output_tokens: 500 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const settings = {
      get: jest.fn((key: string) =>
        Promise.resolve(
          {
            'seo.aiBaseUrl': 'https://example.test/v1',
            'seo.aiApiKey': 'secret',
            'seo.textModel': 'text-model',
            'seo.timeoutMs': '30000',
          }[key],
        ),
      ),
      getSecret: jest.fn(() => Promise.resolve('secret')),
    };
    const adapter = new SeoAiAdapter(settings as never);

    const result = await adapter.generateArticle({
      keyword: 'macOS 连接超时',
      category: '故障排查',
      publicContext: '公开教程内容',
      existingArticles: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.article.primaryKeyword).toBe('macOS 连接超时');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 500 });
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
        publicContext: '',
        existingArticles: [],
      }),
    ).rejects.toThrow('AI 服务尚未配置');
  });
});
