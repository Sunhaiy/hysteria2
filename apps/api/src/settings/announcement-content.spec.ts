import { BadRequestException } from '@nestjs/common';
import {
  announcementDocumentHasContent,
  announcementDocumentHtml,
  legacyAnnouncementDocument,
  normalizeAnnouncementDocument,
} from './announcement-content';

describe('announcement rich content', () => {
  it('converts legacy title and body into one document', () => {
    const document = legacyAnnouncementDocument(
      '线路维护',
      '今晚 23:00 开始。\n预计持续 10 分钟。',
    );
    const html = announcementDocumentHtml(document);

    expect(html).toContain('<h2');
    expect(html).toContain('线路维护');
    expect(html).toContain('今晚 23:00 开始。<br />预计持续 10 分钟。');
  });

  it('opens every valid link in a new page and removes executable URLs', () => {
    const document = normalizeAnnouncementDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '查看套餐',
              marks: [{ type: 'link', attrs: { href: '/portal/plans' } }],
            },
            {
              type: 'text',
              text: '危险链接',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    });

    const html = announcementDocumentHtml(document);
    expect(html).toContain(
      '<a href="/portal/plans" target="_blank" rel="noopener noreferrer">查看套餐</a>',
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('危险链接');
  });

  it('supports image-only announcements', () => {
    const document = normalizeAnnouncementDocument({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'https://api.example.com/api/announcement-images/image',
            alt: '维护通知',
          },
        },
      ],
    });

    expect(announcementDocumentHasContent(document)).toBe(true);
    expect(announcementDocumentHtml(document)).toContain('alt="维护通知"');
  });

  it('rejects unsupported nodes and text over the announcement limit', () => {
    expect(() =>
      normalizeAnnouncementDocument({
        type: 'doc',
        content: [{ type: 'iframe', attrs: { src: 'https://example.com' } }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeAnnouncementDocument({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '长'.repeat(30_001) }],
          },
        ],
      }),
    ).toThrow('公告文字不能超过 30000 字');
  });
});
