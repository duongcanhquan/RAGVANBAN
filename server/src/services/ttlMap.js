/**
 * Map có TTL — cache ngắn cho auth / settings trên serverless.
 */

function createTtlMap({ ttlMs = 15_000, max = 200 } = {}) {
  const map = new Map();

  function expired(hit) {
    return !hit || Date.now() - hit.at > ttlMs;
  }

  return {
    get(key) {
      const hit = map.get(key);
      if (expired(hit)) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      if (map.size >= max && !map.has(key)) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      map.set(key, { at: Date.now(), value });
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    invalidateWhere(pred) {
      for (const [key, hit] of map) {
        if (expired(hit) || pred(hit.value, key)) map.delete(key);
      }
    },
    get size() {
      return map.size;
    },
  };
}

module.exports = { createTtlMap };
