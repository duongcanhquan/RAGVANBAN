/**
 * PostgREST PGRST204 — cột chưa migrate / schema cache chưa có.
 * Bỏ cột khỏi payload, giữ giá trị trong metadata JSONB, nhớ để lần ghi sau không gửi lại.
 */

const missingDocumentColumns = new Set();

function pgErrorText(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return [err.message, err.details, err.hint, err.code].filter(Boolean).join(' | ');
}

function missingColumnFromPgError(err) {
  const t = pgErrorText(err);
  const m =
    t.match(/Could not find the ['"]([^'"]+)['"] column/i) ||
    t.match(/column ['"]([^'"]+)['"] of ['"]?[\w.]+['"]? in the schema cache/i) ||
    t.match(/column "([^"]+)" (?:of relation .* )?does not exist/i);
  return m ? m[1] : null;
}

function rememberMissingDocumentColumn(col) {
  const name = String(col || '').trim();
  if (name) missingDocumentColumns.add(name);
  return name;
}

function omitKnownMissingColumns(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!missingDocumentColumns.has(k)) out[k] = v;
  }
  return out;
}

function foldColumnIntoMetadata(payload, col) {
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, col)) return payload;
  const val = payload[col];
  const next = { ...payload };
  delete next[col];
  if (col === 'metadata' || col === 'file_name' || col === 'id') return next;
  next.metadata = { ...(payload.metadata || {}), [col]: val };
  return next;
}

function isSchemaCacheError(err) {
  return /schema cache|does not exist|PGRST204/i.test(pgErrorText(err));
}

const CORE_DOCUMENT_KEYS = new Set(['id', 'file_name', 'metadata']);

function nextOptionalKey(body) {
  const keys = Object.keys(body || {}).filter((k) => !CORE_DOCUMENT_KEYS.has(k));
  if (keys.includes('byte_size')) return 'byte_size';
  if (keys.includes('content_sha256')) return 'content_sha256';
  return keys[0] || '';
}

/**
 * insert/update documents: nếu PostgREST báo thiếu cột thì bỏ cột đó rồi thử lại.
 * @param {(body: object) => Promise<{ data: any, error: any }>} write
 * @param {object} payload
 * @param {{ maxTries?: number, loadMetadata?: () => Promise<object> }} [opts]
 */
async function writeWithColumnFallback(write, payload, { maxTries = 16, loadMetadata } = {}) {
  let body = omitKnownMissingColumns(payload);
  let lastError = null;
  let extraMeta = null;
  for (let i = 0; i < maxTries; i += 1) {
    const { data, error } = await write(body);
    if (!error) return { data, error: null, body };
    lastError = error;
    let col = missingColumnFromPgError(error);
    if (!col || !Object.prototype.hasOwnProperty.call(body, col)) {
      if (!isSchemaCacheError(error)) return { data, error, body };
      col = nextOptionalKey(body);
      if (!col) return { data, error, body };
    }
    rememberMissingDocumentColumn(col);
    if (typeof loadMetadata === 'function' && extraMeta == null) {
      extraMeta = (await loadMetadata()) || {};
    }
    body = foldColumnIntoMetadata(body, col);
    if (extraMeta) {
      body.metadata = { ...extraMeta, ...(body.metadata || {}) };
    }
  }
  return { data: null, error: lastError, body };
}

/**
 * SELECT documents: bỏ lần lượt cột chưa có trong schema cache.
 * @param {(select: string) => Promise<{ data: any, error: any }>} run
 * @param {string[]} columns
 */
async function selectColumnsWithFallback(run, columns, { maxTries = 20 } = {}) {
  let cols = (columns || []).filter((c) => c && !missingDocumentColumns.has(c));
  if (!cols.includes('id')) cols = ['id', ...cols];
  let lastError = null;
  for (let i = 0; i < maxTries; i += 1) {
    const { data, error } = await run(cols.join(','));
    if (!error) return { data, error: null, columns: cols };
    lastError = error;
    let col = missingColumnFromPgError(error);
    if (!col || !cols.includes(col)) {
      if (!isSchemaCacheError(error)) return { data, error, columns: cols };
      col = cols.find((c) => c !== 'id' && c !== 'file_name' && c !== 'metadata') || '';
      if (!col) return { data, error, columns: cols };
    }
    rememberMissingDocumentColumn(col);
    cols = cols.filter((c) => c !== col);
    if (!cols.length) break;
  }
  return { data: null, error: lastError, columns: cols };
}

function resetMissingDocumentColumns() {
  missingDocumentColumns.clear();
}

module.exports = {
  pgErrorText,
  missingColumnFromPgError,
  rememberMissingDocumentColumn,
  omitKnownMissingColumns,
  foldColumnIntoMetadata,
  writeWithColumnFallback,
  selectColumnsWithFallback,
  isSchemaCacheError,
  resetMissingDocumentColumns,
  missingDocumentColumns,
};
