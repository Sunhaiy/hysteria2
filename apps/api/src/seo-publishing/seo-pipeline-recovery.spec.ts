import {
  runSeoGenerationPipeline,
  type SeoPipelineCheckpoint,
} from './seo-generation-pipeline';

describe('SEO stage recovery', () => {
  it('reuses validated stages after invalid metadata and filters invented related URLs', async () => {
    const checkpoints: Record<string, SeoPipelineCheckpoint> = {};
    const evidence = {
      searchIntent: '解决故障',
      readerOutcome: '能够排查',
      audience: '新用户',
      directAnswer: '先检查网络',
      outline: ['检查网络', '检查配置'],
      evidence: [],
    };
    const body = {
      title: '连接超时排查教程',
      lead: '连接超时先检查本地联网状态。',
      imagePrompt: 'network diagram',
      sections: ['网络', '配置', '结果'].map((heading) => ({
        heading,
        blocks: [{ type: 'paragraph', text: '记录异常信息并进行对照检查。' }],
      })),
    };
    const metadata = {
      excerpt: '通过逐步检查定位连接失败的具体原因。',
      primaryKeyword: '连接超时',
      relatedKeywords: ['节点连接'],
      tags: ['排障'],
      seoTitle: '连接超时检查指南',
      metaDescription: '逐步定位连接失败的问题。',
      coverAlt: '网络图',
      suggestedSlug: 'network-timeout',
      relatedArticleSlugs: ['real-guide', 'invented-guide'],
    };
    const audit = {
      passed: true,
      summary: '通过',
      issues: [],
      intentCoverage: 90,
      evidenceCoverage: 90,
      actionabilityScore: 90,
      originalityScore: 79,
    };
    const complete = jest
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({
          text: JSON.stringify(evidence),
          usage: { inputTokens: 1, outputTokens: 2 },
        }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          text: JSON.stringify(body),
          usage: { inputTokens: 1, outputTokens: 2 },
        }),
      )
      .mockResolvedValueOnce({
        text: 'not JSON',
        usage: { inputTokens: 1, outputTokens: 2 },
      });
    const options = {
      checkpoints,
      onStage: (stage: string, checkpoint?: SeoPipelineCheckpoint) => {
        if (checkpoint) checkpoints[stage] = checkpoint;
        return Promise.resolve();
      },
    };
    const input = {
      keyword: '连接超时',
      category: '教程',
      sources: [],
      existingArticles: [{ title: '网络故障说明', slug: 'real-guide' }],
    };
    await expect(
      runSeoGenerationPipeline(input, complete, options),
    ).rejects.toThrow('元信息不是有效 JSON');
    expect(Object.keys(checkpoints)).toEqual(['evidence', 'draft']);
    complete
      .mockResolvedValueOnce({
        text: JSON.stringify(metadata),
        usage: { inputTokens: 1, outputTokens: 2 },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(audit),
        usage: { inputTokens: 1, outputTokens: 2 },
      });
    const result = await runSeoGenerationPipeline(input, complete, options);
    expect(complete).toHaveBeenCalledTimes(5);
    expect(result.article.relatedArticleSlugs).toEqual(['real-guide']);
    expect(result.article.suggestedSlug).toBe('network-timeout');
    expect(result.article.audit.passed).toBe(true);
    for (let index = 1; index <= 5; index += 1) {
      expect(complete).toHaveBeenNthCalledWith(
        index,
        expect.stringContaining('写给真实读者的实用教程'),
      );
      expect(complete).toHaveBeenNthCalledWith(
        index,
        expect.stringContaining('不得虚构来源、实测或事实'),
      );
    }
  });
});
