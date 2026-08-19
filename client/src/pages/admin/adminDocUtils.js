export const ALLOWED_RE =
  /\.(pdf|docx?|docm|pptx?|pptm|xlsx?|xlsm|rtf|od[tsp]|png|jpe?g|webp|gif|bmp|tiff?|txt|md|csv)$/i

export function errorFromResponseBody(text, status) {
  const raw = String(text || '').trim()
  if (!raw) return `HTTP ${status}`
  try {
    const j = JSON.parse(raw)
    return j.error || j.message || raw
  } catch {
    return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw
  }
}

export function slugSegment(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'muc'
  )
}

export function r2PrefixFromLabel(label) {
  const parts = String(label || '')
    .split('/')
    .map((s) => slugSegment(s.trim()))
    .filter(Boolean)
  return ['van-ban', ...(parts.length ? parts : ['chua-gan'])].join('/')
}

export function docSort(a, b) {
  const sa = a.sort_order ?? a.metadata?.sort_order
  const sb = b.sort_order ?? b.metadata?.sort_order
  const hasA = sa != null && Number.isFinite(Number(sa))
  const hasB = sb != null && Number.isFinite(Number(sb))
  if (hasA && hasB && Number(sa) !== Number(sb)) return Number(sa) - Number(sb)
  if (hasA !== hasB) return hasA ? -1 : 1
  return new Date(b.created_at || 0) - new Date(a.created_at || 0)
}

export function sourceLabel(doc) {
  const s = doc.source || doc.metadata?.source || ''
  if (s === 'google_drive' || s === 'drive') return 'Google Drive'
  if (s === 'r2' || s === 'upload') return 'Upload / R2'
  if (s === 'paste' || s === 'text') return 'Dán text'
  if (s === 'web' || s === 'web_official') return 'Website'
  return s || '—'
}

export function buildGroups(docs, categoryOptions) {
  const by = new Map()
  for (const o of categoryOptions) by.set(o.id, [])
  const extras = new Map()
  const uncat = []
  for (const d of docs) {
    const cid = d.category_id || d.metadata?.category_id || ''
    if (!cid) uncat.push(d)
    else if (by.has(cid)) by.get(cid).push(d)
    else {
      if (!extras.has(cid)) extras.set(cid, [])
      extras.get(cid).push(d)
    }
  }
  const groups = [
    {
      id: '',
      label: 'Không phân loại',
      r2: 'van-ban/chua-gan',
      items: uncat.sort(docSort),
    },
  ]
  for (const o of categoryOptions) {
    groups.push({
      id: o.id,
      label: o.label,
      r2: r2PrefixFromLabel(o.label),
      items: (by.get(o.id) || []).sort(docSort),
    })
  }
  for (const [id, items] of extras) {
    groups.push({
      id,
      label: items[0]?.folder_path || items[0]?.chuyen_mon || 'Chuyên mục khác',
      r2: r2PrefixFromLabel(items[0]?.folder_path || ''),
      items: items.sort(docSort),
    })
  }
  return groups
}

export function itemsPayload(docs, categoryId) {
  return docs
    .filter((d) => (d.category_id || '') === (categoryId || ''))
    .sort(docSort)
    .map((d, i) => ({ id: d.id, categoryId: categoryId || null, sortOrder: i }))
}

export async function readSse(res, { onProgress, onDone }) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      const lines = part.split('\n')
      let event = 'message'
      const dataLines = []
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue
      let data
      try {
        data = JSON.parse(dataLines.join('\n'))
      } catch {
        continue
      }
      if (event === 'progress') onProgress?.(data)
      else if (event === 'done') {
        onDone?.(data)
      } else if (event === 'error') throw new Error(data.message || 'Lỗi SSE')
    }
  }
}

export function catalogItemFromResult(result, categoryId = '') {
  if (!result?.id) return null
  return {
    id: result.id,
    file_name: result.fileName,
    display_name: result.displayName || result.fileName,
    mo_ta: result.moTa || result.metadata?.mo_ta || '',
    so_hieu: result.metadata?.so_hieu || '',
    loai_van_ban: result.metadata?.loai_van_ban || '',
    trang_thai: result.metadata?.trang_thai || '',
    chunk_count: result.chunks || 0,
    storage_url: result.storageUrl || result.publicUrl || result.driveWebViewLink || result.downloadUrl || '',
    storage_path: result.storagePath || '',
    drive_web_view_link: result.driveWebViewLink || result.downloadUrl || '',
    category_id: result.categoryId || categoryId || '',
    folder_path: result.folderPath || '',
    source: result.source || result.kind || 'upload',
    created_at: new Date().toISOString(),
  }
}
