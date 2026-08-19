/**
 * Cache GET JSON ngắn hạn — tránh gọi trùng tree/categories/settings giữa các panel.
 */
const store = new Map()
const inflight = new Map()

export async function cachedJson(url, { ttlMs = 30_000, force = false } = {}) {
  const key = String(url || '')
  if (!key) throw new Error('cachedJson: thiếu url')

  if (!force) {
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return hit.data
    if (inflight.has(key)) return inflight.get(key)
  }

  const p = fetch(key)
    .then(async (res) => {
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const err = new Error(data.error || data.message || `HTTP ${res.status}`)
        err.status = res.status
        throw err
      }
      store.set(key, { data, at: Date.now() })
      return data
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, p)
  return p
}

export function invalidateApiCache(urlPrefix) {
  const prefix = String(urlPrefix || '')
  for (const key of [...store.keys(), ...inflight.keys()]) {
    if (!prefix || key.includes(prefix)) {
      store.delete(key)
      inflight.delete(key)
    }
  }
}
