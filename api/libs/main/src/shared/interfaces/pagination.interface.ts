/**
 * Generic paginated response interface.
 *
 * Use this for consistent pagination across all services.
 * The `items` field name varies by service for backwards compatibility,
 * but the structure is standardized.
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Generic paginated response with items.
 * Can be extended or used with type intersection for specific item names.
 */
export interface PaginatedResponse<T> extends PaginationMeta {
  items: T[];
}

/**
 * Create pagination metadata from query parameters and total count.
 *
 * @param total - Total number of items matching the query
 * @param page - Current page number (1-indexed)
 * @param limit - Items per page
 * @returns Pagination metadata
 */
export function createPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Create a paginated response with items and metadata.
 *
 * @param items - Array of items for this page
 * @param total - Total number of items matching the query
 * @param page - Current page number (1-indexed)
 * @param limit - Items per page
 * @returns Complete paginated response
 */
export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  return {
    items,
    ...createPaginationMeta(total, page, limit),
  };
}
