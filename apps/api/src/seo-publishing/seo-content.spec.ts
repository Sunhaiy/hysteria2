import {
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
      seoTitle: '连接超时排查指南',
      metaDescription: '从本地网络、客户端设置和节点状态逐步定位连接超时问题。',
      coverImageId: null,
      coverAlt: null,
      contentJson: { type: 'doc', content: [] },
      existingPlainTexts: [],
    });
    expect(short.passed).toBe(false);
    expect(short.blockers).toContain('正文至少需要 1200 个中文字符');

    const repeated = '这是用于说明连接排查步骤的有效正文内容。'.repeat(90);
    const long = evaluateSeoDraft({
      title: 'macOS 连接超时完整排查指南',
      excerpt: '按顺序检查客户端、订阅、本地网络和节点状态。',
      seoTitle: 'macOS 连接超时排查：客户端与节点检查步骤',
      metaDescription:
        '本指南说明如何按顺序检查 macOS 客户端配置、订阅状态、本地网络和服务节点，快速定位连接超时。',
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
});
