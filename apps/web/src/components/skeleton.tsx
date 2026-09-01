import type { CSSProperties } from "react";

type PageSkeletonVariant = "dashboard" | "table" | "cards" | "detail" | "settings";

export function CardGridSkeleton({
  count = 3,
  compact = false,
}: {
  count?: number;
  compact?: boolean;
}) {
  return (
    <div
      className={`page-skeleton-card-grid${compact ? " compact" : ""}`}
      role="status"
      aria-label="卡片内容加载中"
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <span className="skeleton" aria-hidden="true" key={index} />
      ))}
    </div>
  );
}

export function TableSkeleton({
  columns = 5,
  rows = 5,
}: {
  columns?: number;
  rows?: number;
}) {
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(88px, 1fr))`,
  };

  return (
    <div className="structured-table-skeleton" aria-hidden="true">
      <div className="structured-table-skeleton-row header" style={gridStyle}>
        {Array.from({ length: columns }, (_, index) => (
          <span className="skeleton" key={index} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div className="structured-table-skeleton-row" style={gridStyle} key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <span
              className={`skeleton skeleton-cell skeleton-cell-${columnIndex % 3}`}
              key={columnIndex}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({
  variant = "dashboard",
}: {
  variant?: PageSkeletonVariant;
}) {
  return (
    <div
      className={`page-skeleton page-skeleton-${variant}`}
      role="status"
      aria-label="页面内容加载中"
      aria-busy="true"
    >
      <div className="page-skeleton-heading" aria-hidden="true">
        <span className="skeleton" />
        <span className="skeleton" />
      </div>

      {variant === "dashboard" ? (
        <>
          <div className="page-skeleton-metrics" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <span className="skeleton" key={index} />
            ))}
          </div>
          <div className="page-skeleton-panels" aria-hidden="true">
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
          <TableSkeleton columns={6} rows={4} />
        </>
      ) : null}

      {variant === "table" ? (
        <>
          <div className="page-skeleton-filters" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <span className="skeleton" key={index} />
            ))}
          </div>
          <TableSkeleton columns={6} rows={6} />
        </>
      ) : null}

      {variant === "cards" ? (
        <>
          <CardGridSkeleton />
          <CardGridSkeleton compact />
        </>
      ) : null}

      {variant === "detail" ? (
        <>
          <div className="page-skeleton-detail-hero skeleton" aria-hidden="true" />
          <div className="page-skeleton-detail-grid" aria-hidden="true">
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        </>
      ) : null}

      {variant === "settings" ? (
        <div className="page-skeleton-settings" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <section key={index}>
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" />
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ConsoleSkeleton() {
  return (
    <div className="console-skeleton" role="status" aria-label="控制台加载中" aria-busy="true">
      <aside className="console-skeleton-sidebar" aria-hidden="true">
        <span className="skeleton console-skeleton-brand" />
        <span className="skeleton console-skeleton-user" />
        <div className="console-skeleton-nav">
          {Array.from({ length: 7 }, (_, index) => (
            <span className="skeleton" key={index} />
          ))}
        </div>
      </aside>
      <main className="console-skeleton-workspace">
        <PageSkeleton variant="dashboard" />
      </main>
    </div>
  );
}
