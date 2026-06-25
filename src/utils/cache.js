const store = new Map();
const DEFAULT_TTL = 60 * 1000; // 1 minute

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttl = DEFAULT_TTL) {
  store.set(key, { value, expiresAt: Date.now() + ttl });
}

export function cacheDelete(key) {
  store.delete(key);
}

export function cacheDeletePattern(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheKey(...parts) {
  return parts.filter(Boolean).join(':');
}
