const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const decodeCursor = (cursor) => {
  if (!cursor) return 0;

  try {
    const payload = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    return Number.isInteger(payload.offset) && payload.offset >= 0 ? payload.offset : 0;
  } catch {
    const error = new Error("The pagination cursor is invalid or expired.");
    error.statusCode = 400;
    throw error;
  }
};

const encodeCursor = (offset) => Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");

const getPaginationOptions = (query = {}) => {
  const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInteger(query.page_size ?? query.limit, DEFAULT_PAGE_SIZE));
  const offset = decodeCursor(query.cursor);
  return { pageSize, offset };
};

const paginate = (items, query = {}) => {
  const source = Array.isArray(items) ? items : [];
  const { pageSize, offset } = getPaginationOptions(query);
  const pageItems = source.slice(offset, offset + pageSize);
  const nextOffset = offset + pageItems.length;
  const isLast = nextOffset >= source.length;

  return {
    items: pageItems,
    total: source.length,
    next_cursor: isLast ? null : encodeCursor(nextOffset),
    is_last: isLast
  };
};

const shouldPaginate = (query = {}) => {
  const value = query.include_page;
  return value === true || value === "true" || Boolean(query.cursor);
};

module.exports = { paginate, shouldPaginate, getPaginationOptions, encodeCursor };
