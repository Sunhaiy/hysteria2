import type { ReactNode } from "react";
import { Icon } from "./icon";
import { TableSkeleton } from "./skeleton";

export interface TablePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function DataTable({
  headers,
  rows,
  loading = false,
  emptyText = "暂无数据",
  error,
  onRetry,
  pagination,
  minimumColumnWidth = 120,
}: {
  headers: string[];
  rows: ReactNode[][];
  loading?: boolean;
  emptyText?: string;
  error?: string | null;
  onRetry?: () => void;
  pagination?: TablePagination;
  minimumColumnWidth?: number;
}) {
  const minimumTableWidth = Math.max(360, headers.length * minimumColumnWidth);

  return (
    <div className="table-card">
      {error && rows.length === 0 ? (
        <div className="table-state">
          <span>{error}</span>
          {onRetry ? (
            <button className="ghost-button" type="button" onClick={onRetry}>
              <Icon name="refresh" />
              重试
            </button>
          ) : null}
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="table-loading" aria-label="正在加载">
          <TableSkeleton columns={headers.length} />
        </div>
      ) : rows.length === 0 ? (
        <div className="table-state">{emptyText}</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table" style={{ minWidth: minimumTableWidth }}>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && pagination.totalPages > 1 ? (
        <div className="table-pagination">
          <span>
            第 {pagination.page} / {pagination.totalPages} 页，共{" "}
            {pagination.total} 条
          </span>
          <div className="pagination-actions">
            <button
              className="icon-button"
              type="button"
              title="上一页"
              aria-label="上一页"
              disabled={pagination.page <= 1 || loading}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <Icon name="arrow_back" />
            </button>
            <button
              className="icon-button"
              type="button"
              title="下一页"
              aria-label="下一页"
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <Icon name="arrow_forward" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
