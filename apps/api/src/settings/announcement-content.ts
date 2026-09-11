import { BadRequestException } from '@nestjs/common';
import {
  renderTiptapHtml,
  tiptapPlainText,
  type TiptapMark,
  type TiptapNode,
} from '../seo-publishing/seo-content';

const maxJsonBytes = 256 * 1024;
const maxTextLength = 30_000;
const maxNodes = 2_000;
const maxDepth = 20;
const maxImages = 20;
const allowedNodes = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
  'image',
  'text',
]);
const allowedMarks = new Set([
  'bold',
  'italic',
  'strike',
  'code',
  'underline',
  'superscript',
  'subscript',
  'highlight',
  'link',
]);

type DocumentStats = {
  nodes: number;
  textLength: number;
  images: number;
};

function invalidAnnouncement(message = '公告内容格式无效') {
  return new BadRequestException(message);
}

function normalizeMarks(value: unknown): TiptapMark[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalidAnnouncement();
  const marks = value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw invalidAnnouncement();
    const mark = entry as Record<string, unknown>;
    if (typeof mark.type !== 'string' || !allowedMarks.has(mark.type)) {
      throw invalidAnnouncement('公告包含不支持的文字格式');
    }
    if (mark.type === 'link') {
      const href = (mark.attrs as Record<string, unknown> | undefined)?.href;
      if (typeof href !== 'string' || href.length > 2_000) {
        throw invalidAnnouncement('公告链接格式无效');
      }
      return { type: mark.type, attrs: { href } };
    }
    if (mark.type === 'highlight') {
      const color = (mark.attrs as Record<string, unknown> | undefined)?.color;
      return {
        type: mark.type,
        ...(typeof color === 'string' && color.length <= 32
          ? { attrs: { color } }
          : {}),
      };
    }
    return { type: mark.type };
  });
  return marks.length ? marks : undefined;
}

function normalizeAttributes(type: string, value: unknown) {
  const attrs =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  if (type === 'heading') {
    const level = Number(attrs.level);
    return { level: [2, 3, 4].includes(level) ? level : 2 };
  }
  if (type === 'paragraph') {
    const textAlign =
      typeof attrs.textAlign === 'string' ? attrs.textAlign : '';
    return ['left', 'center', 'right', 'justify'].includes(textAlign)
      ? { textAlign }
      : undefined;
  }
  if (type === 'codeBlock') {
    const language = attrs.language;
    return typeof language === 'string' && language.length <= 32
      ? { language }
      : undefined;
  }
  if (type === 'orderedList') {
    const start = Number(attrs.start);
    return Number.isInteger(start) && start > 0 && start <= 10_000
      ? { start }
      : undefined;
  }
  if (type === 'taskItem') return { checked: attrs.checked === true };
  if (type === 'image') {
    const src = attrs.src;
    if (typeof src !== 'string' || !src || src.length > 2_000) {
      throw invalidAnnouncement('公告图片地址无效');
    }
    return {
      src,
      alt: typeof attrs.alt === 'string' ? attrs.alt.slice(0, 300) : '',
      title: typeof attrs.title === 'string' ? attrs.title.slice(0, 300) : null,
    };
  }
  return undefined;
}

function normalizeNode(
  value: unknown,
  depth: number,
  stats: DocumentStats,
): TiptapNode {
  if (!value || typeof value !== 'object' || depth > maxDepth) {
    throw invalidAnnouncement();
  }
  const source = value as Record<string, unknown>;
  if (typeof source.type !== 'string' || !allowedNodes.has(source.type)) {
    throw invalidAnnouncement('公告包含不支持的内容类型');
  }
  stats.nodes += 1;
  if (stats.nodes > maxNodes) throw invalidAnnouncement('公告内容过于复杂');

  if (source.type === 'text') {
    if (typeof source.text !== 'string') throw invalidAnnouncement();
    stats.textLength += source.text.length;
    if (stats.textLength > maxTextLength) {
      throw invalidAnnouncement(`公告文字不能超过 ${maxTextLength} 字`);
    }
    const marks = normalizeMarks(source.marks);
    return {
      type: 'text',
      text: source.text,
      ...(marks ? { marks } : {}),
    };
  }

  if (source.type === 'image') {
    stats.images += 1;
    if (stats.images > maxImages) {
      throw invalidAnnouncement(`公告最多插入 ${maxImages} 张图片`);
    }
  }
  if (source.content !== undefined && !Array.isArray(source.content)) {
    throw invalidAnnouncement();
  }
  const content = Array.isArray(source.content)
    ? source.content.map((node) => normalizeNode(node, depth + 1, stats))
    : undefined;
  const attrs = normalizeAttributes(source.type, source.attrs);
  return {
    type: source.type,
    ...(attrs ? { attrs } : {}),
    ...(content?.length ? { content } : {}),
  };
}

export function normalizeAnnouncementDocument(value: unknown): TiptapNode {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidAnnouncement();
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxJsonBytes) {
    throw invalidAnnouncement('公告内容体积过大');
  }
  const document = normalizeNode(value, 0, {
    nodes: 0,
    textLength: 0,
    images: 0,
  });
  if (document.type !== 'doc') throw invalidAnnouncement();
  return document;
}

export function legacyAnnouncementDocument(
  title: string,
  content: string,
): TiptapNode {
  const blocks: TiptapNode[] = [];
  if (title.trim()) {
    blocks.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: title.trim() }],
    });
  }
  for (const paragraph of content.split(/\n{2,}/)) {
    if (!paragraph.trim()) continue;
    const lines = paragraph.trim().split('\n');
    const inline: TiptapNode[] = [];
    lines.forEach((line, index) => {
      if (index) inline.push({ type: 'hardBreak' });
      if (line) inline.push({ type: 'text', text: line });
    });
    blocks.push({ type: 'paragraph', content: inline });
  }
  return {
    type: 'doc',
    content: blocks.length ? blocks : [{ type: 'paragraph' }],
  };
}

export function announcementDocumentHtml(document: TiptapNode) {
  return renderTiptapHtml(document, { linksOpenInNewTab: true });
}

export function announcementDocumentHasContent(document: TiptapNode) {
  if (tiptapPlainText(document).trim()) return true;
  let hasImage = false;
  const visit = (node: TiptapNode) => {
    if (node.type === 'image') hasImage = true;
    node.content?.forEach(visit);
  };
  visit(document);
  return hasImage;
}

export function announcementDocumentPlainText(document: TiptapNode) {
  return tiptapPlainText(document).trim();
}
