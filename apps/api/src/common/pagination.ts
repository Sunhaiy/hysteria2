export interface PageQuery {
  page?: string;
  pageSize?: string;
  // Kept for one compatibility release while older clients send limit.
  limit?: string;
}

export interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function parsePage(
  query: PageQuery,
  options: { defaultPageSize?: number; maxPageSize?: number } = {},
) {
  const defaultPageSize = options.defaultPageSize ?? 20;
  const maxPageSize = options.maxPageSize ?? 100;
  const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
  const requested = query.pageSize ?? query.limit ?? String(defaultPageSize);
  const pageSize = Math.min(
    Math.max(Number.parseInt(requested, 10) || defaultPageSize, 1),
    maxPageSize,
  );
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function pageResponse<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PageResponse<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}
