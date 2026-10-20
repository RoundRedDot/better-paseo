/**
 * Remembers a pure lookup by its string key. A timeline asks for the same
 * call's icon on every render (streaming, hover, a theme flip), so each key
 * is worked out once. The cache empties when it reaches `limit`, which keeps
 * a long session's memory flat without tracking use.
 */
export function cachedLookup<T>(compute: (key: string) => T, limit = 500): (key: string) => T {
  const cache = new Map<string, T>();
  return (key) => {
    if (cache.has(key)) return cache.get(key) as T;
    if (cache.size >= limit) cache.clear();
    const value = compute(key);
    cache.set(key, value);
    return value;
  };
}
