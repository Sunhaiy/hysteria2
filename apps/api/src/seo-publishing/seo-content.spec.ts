import {
  applyEditorialAudit,
  buildGeneratedDocument,
  evaluateSeoDraft,
  extractTiptapHeadings,
  renderTiptapHtml,
  slugifyArticleTitle,
} from './seo-content';

describe('SEO content boundary', () => {
  it('renders supported Tiptap JSON and strips executable URLs', () => {
    const html = renderTiptapHtml({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '连接排障' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<script>alert(1)</script>' },
            {
              type: 'text',
              text: '危险链接',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            {
              type: 'text',
              text: '站内帮助',
              marks: [{ type: 'link', attrs: { href: '/blog' } }],
            },
          ],
        },
      ],
    });

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="/blog"');
    expect(html).toContain('<h2 id="lian-jie-pai-zhang">连接排障</h2>');
  });

  it('builds an editable document from structured generated sections', () => {
    const document = buildGeneratedDocument({
      sections: [
        {
          heading: '为什么会超时',
          blocks: [
            { type: 'paragraph', text: '先判断本地网络与远端节点。' },
            { type: 'bullets', items: ['检查系统时间', '更新订阅'] },
          ],
        },
      ],
    });

    expect(document).toMatchObject({ type: 'doc' });
    expect(renderTiptapHtml(document)).toContain('<ul>');
    expect(renderTiptapHtml(document)).toContain('查看更多使用指南');
  });

  it('blocks short, unstructured drafts and passes useful long-form drafts', () => {
    const short = evaluateSeoDraft({
      title: '超时排查',
      excerpt: '快速定位连接超时问题。',
      primaryKeyword: '连接超时',
      relatedKeywords: ['客户端超时', '网络检查'],
      tags: ['连接', '排障'],
      seoTitle: '连接超时排查指南',
      metaDescription: '从本地网络、客户端设置和节点状态逐步定位连接超时问题。',
      coverImageId: null,
      coverAlt: null,
      contentJson: { type: 'doc', content: [] },
      existingPlainTexts: [],
    });
    expect(short.passed).toBe(false);
    expect(short.blockers).toContain('正文过短，尚不足以完整回答搜索问题');

    const detailedParagraphs = Array.from({ length: 45 }, (_, index) => ({
      type: 'paragraph' as const,
      content: [
        {
          type: 'text',
          text: `第 ${index + 1} 项检查用于区分客户端、订阅、本地网络和节点状态，并根据检查结果决定下一步。`,
        },
      ],
    }));
    const long = evaluateSeoDraft({
      title: 'macOS 连接超时完整排查指南',
      excerpt: '按顺序检查客户端、订阅、本地网络和节点状态。',
      primaryKeyword: 'macOS 连接超时',
      relatedKeywords: ['Clash 超时', 'macOS 网络检查', '订阅连接失败'],
      tags: ['macOS', '连接排查'],
      seoTitle: 'macOS 连接超时排查：客户端与节点检查步骤',
      metaDescription:
        '本指南说明如何按顺序定位 macOS 连接超时，并检查客户端配置、订阅状态、本地网络和服务节点。',
      coverImageId: null,
      coverAlt: null,
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'macOS 连接超时需要先区分客户端、本地网络与远端节点。',
              },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查客户端' }],
          },
          ...detailedParagraphs,
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '先确认系统时间。' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查节点' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '查看' },
              {
                type: 'text',
                text: '使用指南',
                marks: [{ type: 'link', attrs: { href: '/blog' } }],
              },
            ],
          },
        ],
      },
      existingPlainTexts: [],
    });
    expect(long.blockers).toEqual([]);
    expect(long.passed).toBe(true);
    expect(long.score).toBeGreaterThanOrEqual(80);
  });

  it('creates stable readable slugs', () => {
    expect(slugifyArticleTitle('macOS 连接超时完整排查指南')).toBe(
      'macos-lian-jie-chao-shi-wan-zheng-pai-cha-zhi-nan',
    );
  });

  it('gives repeated headings stable unique anchors that match the table of contents', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '检查连接' }],
        },
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: '检查连接' }],
        },
      ],
    };

    expect(renderTiptapHtml(document)).toContain(
      '<h3 id="jian-cha-lian-jie-2">检查连接</h3>',
    );
    expect(extractTiptapHeadings(document).map((item) => item.id)).toEqual([
      'jian-cha-lian-jie',
      'jian-cha-lian-jie-2',
    ]);
  });

  it('blocks body images without meaningful alternative text', () => {
    const repeated = '这是用于说明连接排查步骤的有效正文内容。'.repeat(90);
    const report = evaluateSeoDraft({
      title: 'Windows 客户端连接失败完整排查指南',
      excerpt: '从客户端配置、订阅状态与本地网络逐步定位连接失败原因。',
      primaryKeyword: 'Windows 客户端连接失败',
      relatedKeywords: ['Windows 网络检查', '客户端超时'],
      tags: ['Windows', '连接排查'],
      seoTitle: 'Windows 客户端连接失败排查指南',
      metaDescription:
        '本指南介绍如何检查 Windows 客户端配置、订阅状态与本地网络，逐步定位连接失败的具体原因。',
      coverImageId: null,
      coverAlt: null,
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查客户端' }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: repeated }] },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查网络' }],
          },
          { type: 'image', attrs: { src: '/api/seo/images/image-1', alt: '' } },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '继续查看' },
              {
                type: 'text',
                text: '使用指南',
                marks: [{ type: 'link', attrs: { href: '/blog' } }],
              },
            ],
          },
        ],
      },
      existingPlainTexts: [],
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('正文图片必须填写替代文本');
  });

  it('blocks unverifiable absolute service promises', () => {
    const repeated = '按照客户端、订阅状态与本地网络顺序完成排查。'.repeat(90);
    const report = evaluateSeoDraft({
      title: '客户端连接失败完整排查指南',
      excerpt: '从客户端配置、订阅状态与本地网络逐步定位连接失败原因。',
      primaryKeyword: '客户端连接失败',
      relatedKeywords: ['客户端超时', '网络检查'],
      tags: ['客户端', '连接排查'],
      seoTitle: '客户端连接失败完整排查指南',
      metaDescription:
        '本指南介绍如何检查客户端配置、订阅状态与本地网络，逐步定位连接失败的具体原因。',
      coverImageId: null,
      coverAlt: null,
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查客户端' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: `${repeated}我们承诺 100% 稳定。` },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查网络' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '使用指南',
                marks: [{ type: 'link', attrs: { href: '/blog' } }],
              },
            ],
          },
        ],
      },
      existingPlainTexts: [],
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('正文包含无法核实的绝对化承诺');
  });

  it('blocks skipped or unsupported heading levels', () => {
    const repeated = '按照客户端、订阅状态与本地网络顺序完成排查。'.repeat(90);
    const report = evaluateSeoDraft({
      title: '客户端连接失败完整排查指南',
      excerpt: '从客户端配置、订阅状态与本地网络逐步定位连接失败原因。',
      primaryKeyword: '客户端连接失败',
      relatedKeywords: ['客户端超时', '网络检查'],
      tags: ['客户端', '连接排查'],
      seoTitle: '客户端连接失败完整排查指南',
      metaDescription:
        '本指南介绍如何检查客户端配置、订阅状态与本地网络，逐步定位连接失败的具体原因。',
      coverImageId: null,
      coverAlt: null,
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: '错误的起始层级' }],
          },
          { type: 'paragraph', content: [{ type: 'text', text: repeated }] },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查客户端' }],
          },
          {
            type: 'heading',
            attrs: { level: 4 },
            content: [{ type: 'text', text: '跳过三级标题' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查网络' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '使用指南',
                marks: [{ type: 'link', attrs: { href: '/blog' } }],
              },
            ],
          },
        ],
      },
      existingPlainTexts: [],
    });

    expect(report.passed).toBe(false);
    expect(report.blockers).toContain(
      '正文标题必须从二级标题开始，并按 H2 到 H4 逐级排列',
    );
  });

  it('blocks repeated filler and duplicate per-article search metadata', () => {
    const repeated = '连接失败时需要检查网络。'.repeat(120);
    const report = evaluateSeoDraft({
      title: '客户端连接失败排查步骤',
      excerpt: '按照客户端、本地网络和节点状态逐步检查连接失败原因。',
      primaryKeyword: '客户端连接失败',
      relatedKeywords: ['客户端超时', '网络检查'],
      tags: ['客户端', '排障'],
      seoTitle: '客户端连接失败排查步骤',
      metaDescription:
        '客户端连接失败时，可以依次检查客户端配置、本地网络和节点状态，并根据结果继续定位。',
      coverImageId: null,
      coverAlt: null,
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `客户端连接失败。${repeated}` }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '检查客户端' }],
          },
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '检查订阅更新时间。' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '查看结果' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '继续阅读',
                marks: [{ type: 'link', attrs: { href: '/blog' } }],
              },
            ],
          },
        ],
      },
      existingPlainTexts: [],
      existingSeoTitles: ['客户端连接失败排查步骤'],
      existingMetaDescriptions: [
        '客户端连接失败时，可以依次检查客户端配置、本地网络和节点状态，并根据结果继续定位。',
      ],
    });

    expect(report.blockers).toContain(
      '正文存在大量重复句子，不能通过重复表达凑字数',
    );
    expect(report.blockers).toContain('SEO 标题与现有文章重复');
    expect(report.blockers).toContain('SEO 描述与现有文章重复');
  });

  it('merges independent editorial audit findings into the publish gate', () => {
    const report = applyEditorialAudit(
      {
        passed: true,
        score: 95,
        blockers: [],
        warnings: [],
        metrics: {
          plainTextLength: 1_200,
          headingCount: 3,
          internalLinkCount: 1,
          paragraphCount: 6,
          actionListCount: 1,
          sentenceDiversity: 1,
          maximumSimilarity: 0.1,
        },
      },
      {
        passed: false,
        summary: '正文包含无法由来源支持的站点事实。',
        issues: [
          {
            severity: 'BLOCKER',
            category: 'FACTUAL',
            message: '节点数量没有公开来源支持',
          },
        ],
        intentCoverage: 90,
        evidenceCoverage: 40,
        actionabilityScore: 85,
        originalityScore: 90,
        checkedAt: '2026-09-11T05:00:00.000Z',
      },
    );

    expect(report.passed).toBe(false);
    expect(report.blockers).toContain('AI 独立审校：节点数量没有公开来源支持');
    expect(report.editorialAudit?.summary).toContain('无法由来源支持');
  });
});
