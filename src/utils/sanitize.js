export function sanitizeString(str, maxLength = 10000) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, maxLength);
}

export function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, '')
    .trim();
}

export function sanitizeObject(obj, allowedFields) {
  const sanitized = {};
  for (const field of allowedFields) {
    if (obj[field] !== undefined) {
      sanitized[field] =
        typeof obj[field] === 'string' ? sanitizeString(obj[field]) : obj[field];
    }
  }
  return sanitized;
}

export function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function buildPaginationMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}
