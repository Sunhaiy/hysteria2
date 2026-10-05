/** Describe assigned access, not a product's price or its position in the list. */
export function catalogLineTags(
  kind: string,
  nodes: ReadonlyArray<{ label: string; tags?: readonly string[] }>,
): string[] {
  if (kind !== 'PLAN') return [];
  const residential = nodes.some(
    (node) =>
      /住宅|家宽/.test(node.label) ||
      node.tags?.some((tag) => /^(residential|home)$/i.test(tag)),
  );
  return residential ? ['家宽', '住宅', '专线'] : [];
}
