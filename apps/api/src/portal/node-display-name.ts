/** Keep presentation separate from the stored label and machine tier detection. */
export function nodeDisplayName(node: { label: string; icon?: string | null }) {
  const icon = node.icon?.trim();
  return icon ? `${icon} ${node.label}` : node.label;
}
