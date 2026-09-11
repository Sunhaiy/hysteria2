import { pinyin } from 'pinyin-pro';

export type TiptapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
};

export type TiptapRenderOptions = {
  linksOpenInNewTab?: boolean;
};

export type GeneratedBlock =
  | { type: 'paragraph' | 'blockquote'; text: string }
  | { type: 'bullets' | 'ordered'; items: string[] }
  | { type: 'code'; code: string; language?: string };

export type GeneratedSection = {
  heading: string;
  blocks: GeneratedBlock[];
};

export type SeoQualityReport = {
  passed: boolean;
  score: number;
  blockers: string[];
  warnings: string[];
  metrics: {
    plainTextLength: number;
    headingCount: number;
    internalLinkCount: number;
    paragraphCount: number;
    actionListCount: number;
    sentenceDiversity: number;
    maximumSimilarity: number;
  };
  editorialAudit?: SeoEditorialAudit;
};

export type SeoEditorialAudit = {
  passed: boolean;
  summary: string;
  issues: Array<{
    severity: 'BLOCKER' | 'WARNING';
    category: string;
    message: string;
  }>;
  intentCoverage: number;
  evidenceCoverage: number;
  actionabilityScore: number;
  originalityScore: number;
  checkedAt: string;
};

const allowedProtocols = new Set(['http:', 'https:', 'mailto:']);

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    return allowedProtocols.has(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function stringAttribute(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function renderMarks(
  value: string,
  marks: TiptapMark[] = [],
  options: TiptapRenderOptions = {},
) {
  return marks.reduce((rendered, mark) => {
    if (mark.type === 'bold') return `<strong>${rendered}</strong>`;
    if (mark.type === 'italic') return `<em>${rendered}</em>`;
    if (mark.type === 'strike') return `<s>${rendered}</s>`;
    if (mark.type === 'underline') return `<u>${rendered}</u>`;
    if (mark.type === 'code') return `<code>${rendered}</code>`;
    if (mark.type === 'superscript') return `<sup>${rendered}</sup>`;
    if (mark.type === 'subscript') return `<sub>${rendered}</sub>`;
    if (mark.type === 'highlight') return `<mark>${rendered}</mark>`;
    if (mark.type === 'link') {
      const href = safeUrl(mark.attrs?.href);
      if (!href) return rendered;
      const external = !href.startsWith('/');
      const target = options.linksOpenInNewTab ? ' target="_blank"' : '';
      const relation =
        external || options.linksOpenInNewTab
          ? ' rel="noopener noreferrer"'
          : '';
      return `<a href="${escapeHtml(href)}"${target}${relation}>${rendered}</a>`;
    }
    return rendered;
  }, value);
}

function uniqueHeadingId(text: string, counts: Map<string, number>) {
  const base = slugifyArticleTitle(text) || 'section';
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

function renderTiptapNode(
  node: TiptapNode,
  headingCounts: Map<string, number>,
  options: TiptapRenderOptions,
): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') {
    return renderMarks(escapeHtml(node.text ?? ''), node.marks, options);
  }
  const children = (node.content ?? [])
    .map((child) => renderTiptapNode(child, headingCounts, options))
    .join('');
  if (node.type === 'doc') return children;
  if (node.type === 'paragraph') {
    const alignment = ['left', 'center', 'right', 'justify'].includes(
      String(node.attrs?.textAlign),
    )
      ? ` class="text-align-${String(node.attrs?.textAlign)}"`
      : '';
    return `<p${alignment}>${children || '<br />'}</p>`;
  }
  if (node.type === 'heading') {
    const level = Math.min(4, Math.max(2, Number(node.attrs?.level) || 2));
    const id = uniqueHeadingId(tiptapPlainText(node), headingCounts);
    return `<h${level} id="${escapeHtml(id)}">${children}</h${level}>`;
  }
  if (node.type === 'bulletList' || node.type === 'taskList') {
    return `<ul>${children}</ul>`;
  }
  if (node.type === 'orderedList') return `<ol>${children}</ol>`;
  if (node.type === 'listItem' || node.type === 'taskItem') {
    return `<li>${children}</li>`;
  }
  if (node.type === 'blockquote') return `<blockquote>${children}</blockquote>`;
  if (node.type === 'codeBlock') {
    const language = stringAttribute(node.attrs?.language).replace(
      /[^a-z0-9_+-]/gi,
      '',
    );
    return `<pre${language ? ` data-language="${language}"` : ''}><code>${children}</code></pre>`;
  }
  if (node.type === 'hardBreak') return '<br />';
  if (node.type === 'horizontalRule') return '<hr />';
  if (node.type === 'image') {
    const src = safeUrl(node.attrs?.src);
    if (!src) return '';
    const alt = escapeHtml(stringAttribute(node.attrs?.alt));
    return `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />`;
  }
  return children;
}

export function renderTiptapHtml(
  node: TiptapNode,
  options: TiptapRenderOptions = {},
): string {
  return renderTiptapNode(node, new Map(), options);
}

export function tiptapPlainText(node: TiptapNode): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text ?? '';
  const separator = ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(
    node.type,
  )
    ? '\n'
    : '';
  return `${(node.content ?? []).map(tiptapPlainText).join('')}${separator}`;
}

function textNode(text: string, marks?: TiptapMark[]): TiptapNode {
  return { type: 'text', text, ...(marks?.length ? { marks } : {}) };
}

export function buildGeneratedDocument(input: {
  lead?: string;
  sections: GeneratedSection[];
}): TiptapNode {
  const content: TiptapNode[] = [];
  if (input.lead?.trim()) {
    content.push({
      type: 'paragraph',
      content: [textNode(input.lead.trim())],
    });
  }
  for (const section of input.sections) {
    content.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [textNode(section.heading.trim())],
    });
    for (const block of section.blocks) {
      if (block.type === 'paragraph' || block.type === 'blockquote') {
        content.push(
          block.type === 'paragraph'
            ? { type: 'paragraph', content: [textNode(block.text.trim())] }
            : {
                type: 'blockquote',
                content: [
                  {
                    type: 'paragraph',
                    content: [textNode(block.text.trim())],
                  },
                ],
              },
        );
      } else if (block.type === 'bullets' || block.type === 'ordered') {
        content.push({
          type: block.type === 'bullets' ? 'bulletList' : 'orderedList',
          content: block.items.map((item) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: [textNode(item.trim())] }],
          })),
        });
      } else if (block.type === 'code') {
        content.push({
          type: 'codeBlock',
          attrs: { language: block.language ?? null },
          content: [textNode(block.code)],
        });
      }
    }
  }
  content.push(
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [textNode('继续阅读')],
    },
    {
      type: 'paragraph',
      content: [
        textNode('需要更多帮助时，可以'),
        textNode('查看更多使用指南', [
          { type: 'link', attrs: { href: '/blog' } },
        ]),
        textNode('，或前往注册页面开始使用。'),
      ],
    },
  );
  return { type: 'doc', content };
}

function walk(node: TiptapNode, visit: (node: TiptapNode) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

export function extractTiptapHeadings(node: TiptapNode) {
  const headings: Array<{ id: string; level: number; text: string }> = [];
  const headingCounts = new Map<string, number>();
  walk(node, (current) => {
    if (current.type !== 'heading') return;
    const text = tiptapPlainText(current).trim();
    if (!text) return;
    headings.push({
      id: uniqueHeadingId(text, headingCounts),
      level: Math.min(4, Math.max(2, Number(current.attrs?.level) || 2)),
      text,
    });
  });
  return headings;
}

function similarity(left: string, right: string) {
  const shingles = (value: string) => {
    const normalized = value.replace(/\s+/g, '').toLowerCase();
    const values = new Set<string>();
    for (let index = 0; index < normalized.length - 2; index += 1) {
      values.add(normalized.slice(index, index + 3));
    }
    return values;
  };
  const a = shingles(left);
  const b = shingles(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function evaluateSeoDraft(input: {
  title: string;
  excerpt: string;
  primaryKeyword: string;
  relatedKeywords: string[];
  tags: string[];
  seoTitle: string;
  metaDescription: string;
  coverImageId: string | null;
  coverAlt: string | null;
  contentJson: TiptapNode;
  existingPlainTexts: string[];
  existingSeoTitles?: string[];
  existingMetaDescriptions?: string[];
}): SeoQualityReport {
  const plainText = tiptapPlainText(input.contentJson).trim();
  let headingCount = 0;
  let internalLinkCount = 0;
  let paragraphCount = 0;
  let actionListCount = 0;
  let bodyImageWithoutAlt = false;
  let invalidHeading = false;
  const headingLevels: number[] = [];
  walk(input.contentJson, (node) => {
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level);
      headingLevels.push(level);
      if (level === 2) headingCount += 1;
      if (
        !Number.isInteger(level) ||
        level < 2 ||
        level > 4 ||
        !tiptapPlainText(node).trim()
      ) {
        invalidHeading = true;
      }
    }
    if (node.type === 'image' && !stringAttribute(node.attrs?.alt).trim()) {
      bodyImageWithoutAlt = true;
    }
    if (node.type === 'paragraph' && tiptapPlainText(node).trim()) {
      paragraphCount += 1;
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      actionListCount += 1;
    }
    for (const mark of node.marks ?? []) {
      if (
        mark.type === 'link' &&
        typeof mark.attrs?.href === 'string' &&
        mark.attrs.href.startsWith('/') &&
        !mark.attrs.href.startsWith('//')
      ) {
        internalLinkCount += 1;
      }
    }
  });
  const maximumSimilarity = input.existingPlainTexts.reduce(
    (highest, existing) => Math.max(highest, similarity(plainText, existing)),
    0,
  );
  const blockers: string[] = [];
  const warnings: string[] = [];
  const normalize = (value: string) =>
    value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const keyword = normalize(input.primaryKeyword);
  const firstAnswer = normalize(plainText.slice(0, 260));
  const uniqueRelatedKeywords = new Set(
    input.relatedKeywords.map(normalize).filter(Boolean),
  );
  const uniqueTags = new Set(input.tags.map(normalize).filter(Boolean));
  const sentences = plainText
    .split(/[。！？!?；;\n]+/)
    .map((sentence) => normalize(sentence))
    .filter((sentence) => sentence.length >= 8);
  const sentenceDiversity = sentences.length
    ? new Set(sentences).size / sentences.length
    : 0;
  const unverifiablePromise = [
    /(?:100%|百分之百).{0,12}(?:稳定|可用|成功|安全|匿名)/i,
    /(?:永久免费|永久不限速|永不掉线|绝不断线|零故障|全网最快)/i,
  ].some((pattern) => pattern.test(plainText));
  const emptyBoilerplate = [
    /在当今(?:这个)?(?:数字化|互联网|信息化)时代/i,
    /随着(?:互联网|科技|时代)的(?:快速|不断)?发展/i,
    /众所周知/i,
    /本文将(?:带你|为你|深入)(?:了解|介绍|解析)/i,
    /(?:保姆级|全网最全|秒懂|必看)(?:教程|指南)?/i,
  ].some((pattern) => pattern.test(plainText));
  const compactLength = plainText.replace(/\s+/g, '').length;
  if (compactLength < 600) {
    blockers.push('正文过短，尚不足以完整回答搜索问题');
  } else if (compactLength < 1_000) {
    warnings.push('正文较短，请确认已覆盖必要步骤、结果判断和适用限制');
  }
  if (headingCount < 2) blockers.push('正文至少需要两个二级标题');
  if (paragraphCount < 4) blockers.push('正文至少需要四个有效段落');
  if (actionListCount < 1) {
    blockers.push('正文至少需要一个可执行的步骤或检查清单');
  }
  if (
    invalidHeading ||
    headingLevels[0] !== 2 ||
    headingLevels.some(
      (level, index) => index > 0 && level > headingLevels[index - 1] + 1,
    )
  ) {
    blockers.push('正文标题必须从二级标题开始，并按 H2 到 H4 逐级排列');
  }
  if (internalLinkCount < 1) blockers.push('正文至少需要一个自然的站内链接');
  if (input.title.trim().length < 8 || input.title.trim().length > 80) {
    blockers.push('标题长度需要保持在 8 到 80 个字符之间');
  }
  if (input.excerpt.trim().length < 20 || input.excerpt.trim().length > 300) {
    blockers.push('摘要长度需要保持在 20 到 300 个字符之间');
  }
  if (input.seoTitle.trim().length < 8 || input.seoTitle.trim().length > 70) {
    blockers.push('SEO 标题长度需要保持在 8 到 70 个字符之间');
  }
  if (
    input.metaDescription.trim().length < 40 ||
    input.metaDescription.trim().length > 180
  ) {
    blockers.push('SEO 描述长度需要保持在 40 到 180 个字符之间');
  }
  if (keyword.length < 2) {
    blockers.push('主关键词至少需要两个字符');
  } else {
    if (
      !normalize(input.title).includes(keyword) ||
      !normalize(input.seoTitle).includes(keyword)
    ) {
      blockers.push('文章标题和 SEO 标题都需要自然包含主关键词');
    }
    if (!normalize(input.metaDescription).includes(keyword)) {
      blockers.push('SEO 描述需要自然包含主关键词');
    }
    if (!firstAnswer.includes(keyword)) {
      warnings.push('建议在正文开头自然回答并出现主关键词');
    }
  }
  if (uniqueRelatedKeywords.size < 2) {
    blockers.push('至少需要两个不重复的相关关键词');
  }
  if (uniqueTags.size < 2) warnings.push('建议填写至少两个不重复标签');
  if (
    input.existingSeoTitles?.some(
      (existing) => normalize(existing) === normalize(input.seoTitle),
    )
  ) {
    blockers.push('SEO 标题与现有文章重复');
  }
  if (
    input.existingMetaDescriptions?.some(
      (existing) => normalize(existing) === normalize(input.metaDescription),
    )
  ) {
    blockers.push('SEO 描述与现有文章重复');
  }
  if (input.coverImageId && !input.coverAlt?.trim()) {
    blockers.push('封面图片必须填写替代文本');
  }
  if (bodyImageWithoutAlt) blockers.push('正文图片必须填写替代文本');
  if (maximumSimilarity >= 0.72) {
    blockers.push('正文与现有文章过于相似，请改为更新原文章');
  }
  if (unverifiablePromise) {
    blockers.push('正文包含无法核实的绝对化承诺');
  }
  if (sentences.length >= 8 && sentenceDiversity < 0.55) {
    blockers.push('正文存在大量重复句子，不能通过重复表达凑字数');
  }
  if (emptyBoilerplate) blockers.push('正文包含空泛或标题党式套话');
  if (!input.coverImageId) warnings.push('建议补充 1600×900 的文章封面');
  const score = Math.max(0, 100 - blockers.length * 20 - warnings.length * 5);
  return {
    passed: blockers.length === 0 && score >= 80,
    score,
    blockers,
    warnings,
    metrics: {
      plainTextLength: plainText.replace(/\s+/g, '').length,
      headingCount,
      internalLinkCount,
      paragraphCount,
      actionListCount,
      sentenceDiversity: Number(sentenceDiversity.toFixed(4)),
      maximumSimilarity: Number(maximumSimilarity.toFixed(4)),
    },
  };
}

export function applyEditorialAudit(
  report: SeoQualityReport,
  audit: SeoEditorialAudit,
): SeoQualityReport {
  const auditBlockers = audit.issues
    .filter((issue) => issue.severity === 'BLOCKER')
    .map((issue) => `AI 独立审校：${issue.message}`);
  const auditWarnings = audit.issues
    .filter((issue) => issue.severity === 'WARNING')
    .map((issue) => `AI 独立审校：${issue.message}`);
  if (!audit.passed && !auditBlockers.length) {
    auditBlockers.push('AI 独立审校未通过，请人工核对事实与操作步骤');
  }
  const blockers = [...new Set([...report.blockers, ...auditBlockers])];
  const warnings = [...new Set([...report.warnings, ...auditWarnings])];
  const auditScore = Math.round(
    (audit.intentCoverage +
      audit.evidenceCoverage +
      audit.actionabilityScore +
      audit.originalityScore) /
      4,
  );
  return {
    ...report,
    passed: report.passed && audit.passed && blockers.length === 0,
    score: Math.max(
      0,
      Math.min(report.score, auditScore) - auditBlockers.length * 5,
    ),
    blockers,
    warnings,
    editorialAudit: audit,
  };
}

export function slugifyArticleTitle(title: string) {
  const romanized = pinyin(title, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  }).join(' ');
  return romanized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}
