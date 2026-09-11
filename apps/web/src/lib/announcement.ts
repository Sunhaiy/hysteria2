import type { JSONContent } from "@tiptap/react";

export const EMPTY_ANNOUNCEMENT_DOCUMENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export type Announcement = {
  title: string;
  content: string;
  contentHtml?: string;
  contentJson?: JSONContent;
  version: string;
};

export function legacyAnnouncementDocument(
  title: string,
  content: string,
): JSONContent {
  const blocks: JSONContent[] = [];
  if (title.trim()) {
    blocks.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: title.trim() }],
    });
  }
  for (const paragraph of content.split(/\n{2,}/)) {
    if (!paragraph.trim()) continue;
    const inline: JSONContent[] = [];
    paragraph
      .trim()
      .split("\n")
      .forEach((line, index) => {
        if (index) inline.push({ type: "hardBreak" });
        if (line) inline.push({ type: "text", text: line });
      });
    blocks.push({ type: "paragraph", content: inline });
  }
  return {
    type: "doc",
    content: blocks.length ? blocks : [{ type: "paragraph" }],
  };
}

function visitDocument(
  node: JSONContent,
  visitor: (node: JSONContent) => void,
) {
  visitor(node);
  node.content?.forEach((child) => visitDocument(child, visitor));
}

export function announcementDocumentStats(document: JSONContent) {
  let textLength = 0;
  let images = 0;
  let hasText = false;
  visitDocument(document, (node) => {
    textLength += node.text?.length ?? 0;
    if (node.text?.trim()) hasText = true;
    if (node.type === "image") images += 1;
  });
  return { textLength, images, hasContent: hasText || images > 0 };
}
