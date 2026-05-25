export function MetricCard({
  label,
  value,
  footnote,
}: {
  label: string;
  value: string;
  footnote: string;
}) {
  return (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-footnote">{footnote}</span>
    </article>
  );
}
