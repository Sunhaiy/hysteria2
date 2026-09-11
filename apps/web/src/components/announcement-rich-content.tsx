type AnnouncementRichContentProps = {
  html?: string;
  fallback?: string;
  className?: string;
  id?: string;
};

export function AnnouncementRichContent({
  html,
  fallback = "",
  className = "",
  id,
}: AnnouncementRichContentProps) {
  if (!html) {
    return (
      <div id={id} className={`announcement-rich-content ${className}`.trim()}>
        {fallback}
      </div>
    );
  }
  return (
    <div
      id={id}
      className={`announcement-rich-content ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
