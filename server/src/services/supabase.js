/**
 * Supabase client — SERVICE_ROLE trên server (Database + Storage).
 * Alias: server/services/supabase.js
 */

const { createClient } = require('@supabase/supabase-js');
const {
  upsertLocalDocument,
  listLocalDocuments,
  countLocalDocuments,
  updateLocalDocumentCategory,
  deleteLocalDocument,
  getLocalDocument,
  updateLocalDocument,
} = require('./localDocuments');
const { hydrateDocument, catalogFieldsFromIngest } = require('./documentCatalog');
const {
  pgErrorText,
  writeWithColumnFallback,
  selectColumnsWithFallback,
  missingColumnFromPgError,
  rememberMissingDocumentColumn,
  missingDocumentColumns,
} = require('./pgSchemaFallback');

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'documents';

let cached = null;

function isConfigured() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  if (String(url).includes('your-project')) return false;
  if (String(key).includes('your-')) return false;
  return true;
}

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
function getSupabase() {
  if (!isConfigured()) return null;
  if (cached) return cached;

  cached = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * Upload file lên Supabase Storage bucket `documents`.
 * @returns {Promise<{ ok: boolean, path?: string, publicUrl?: string, error?: string, skipped?: boolean }>}
 */
async function uploadPdfToStorage(buffer, originalName, contentType = 'application/pdf') {
  const sb = getSupabase();
  if (!sb) {
    return { ok: false, skipped: true, reason: 'Supabase chưa cấu hình SERVICE_ROLE' };
  }

  const safe = String(originalName || 'document.bin').replace(/[^a-zA-Z0-9._\-\u00C0-\u024F]/g, '_');
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safe}`;

  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(objectPath, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    console.warn('[supabase] storage upload:', error.message);
    return { ok: false, error: error.message };
  }

  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  return {
    ok: true,
    path: objectPath,
    publicUrl: data?.publicUrl || '',
    bucket: STORAGE_BUCKET,
  };
}

const uploadFileToStorage = uploadPdfToStorage;

async function insertChatLog({ userSession, question, citationsUsed = [], answer = '', markedKnowledge = false }) {
  const sb = getSupabase();
  if (!sb) {
    return { ok: false, skipped: true, reason: 'Supabase chưa cấu hình' };
  }

  const payload = {
    user_session: userSession || 'anonymous',
    question: String(question || '').slice(0, 8000),
    citations_used: citationsUsed || [],
    answer: String(answer || '').slice(0, 20000),
  };

  let { data, error } = await sb
    .from('chat_logs')
    .insert({ ...payload, marked_knowledge: Boolean(markedKnowledge) })
    .select('id')
    .single();

  if (error && /marked_knowledge/i.test(error.message || '')) {
    ({ data, error } = await sb.from('chat_logs').insert(payload).select('id').single());
  }

  if (error) {
    console.warn('[supabase] insertChatLog:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data?.id };
}

async function listChatLogs({ sessionId, limit = 40, knowledgeOnly = false } = {}) {
  const sb = getSupabase();
  if (!sb) return { ok: true, source: 'none', items: [] };

  let query = sb
    .from('chat_logs')
    .select('id,user_session,question,answer,citations_used,created_at,marked_knowledge')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (sessionId) query = query.eq('user_session', sessionId);
  if (knowledgeOnly) query = query.eq('marked_knowledge', true);

  const { data, error } = await query;
  if (error) {
    // cột marked_knowledge chưa có
    if (/marked_knowledge/i.test(error.message || '')) {
      let q2 = sb
        .from('chat_logs')
        .select('id,user_session,question,answer,citations_used,created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (sessionId) q2 = q2.eq('user_session', sessionId);
      const retry = await q2;
      if (retry.error) {
        console.warn('[supabase] listChatLogs:', retry.error.message);
        return { ok: false, items: [], error: retry.error.message };
      }
      return { ok: true, source: 'supabase', items: retry.data || [] };
    }
    console.warn('[supabase] listChatLogs:', error.message);
    return { ok: false, items: [], error: error.message };
  }
  return { ok: true, source: 'supabase', items: data || [] };
}

async function getChatLog(id) {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'Supabase chưa cấu hình' };
  const { data, error } = await sb.from('chat_logs').select('*').eq('id', id).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message || 'Not found' };
  return { ok: true, item: data };
}

async function markChatKnowledge(id, marked = true) {
  const sb = getSupabase();
  if (!sb) return { ok: false, skipped: true };
  const { data, error } = await sb
    .from('chat_logs')
    .update({ marked_knowledge: Boolean(marked) })
    .eq('id', id)
    .select('id,marked_knowledge')
    .maybeSingle();
  if (error) {
    console.warn('[supabase] markChatKnowledge:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, item: data };
}

async function listDocuments({ limit = 500 } = {}) {
  const sb = getSupabase();
  if (!sb) {
    const local = listLocalDocuments({ limit });
    return { ...local, items: (local.items || []).map(hydrateDocument) };
  }

  const columns = [
    'id',
    'file_name',
    'display_name',
    'mo_ta',
    'so_hieu',
    'loai_van_ban',
    'trang_thai',
    'chunk_count',
    'storage_path',
    'storage_url',
    'drive_web_view_link',
    'drive_file_id',
    'source',
    'metadata',
    'created_at',
    'category_id',
    'chuyen_mon',
    'folder_path',
    'sort_order',
    'content_sha256',
    'byte_size',
  ];
  const listed = await selectColumnsWithFallback(async (select) => {
    const res = await sb
      .from('documents')
      .select(select)
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data: res.data, error: res.error };
  }, columns);
  if (listed.error) {
    console.warn('[supabase] listDocuments:', pgErrorText(listed.error));
    return { ok: false, source: 'supabase', items: [], error: pgErrorText(listed.error) };
  }
  return { ok: true, source: 'supabase', items: (listed.data || []).map(hydrateDocument) };
}

async function countChatLogs() {
  const sb = getSupabase();
  if (!sb) return { ok: false, count: 0 };

  const { count, error } = await sb
    .from('chat_logs')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.warn('[supabase] countChatLogs:', error.message);
    return { ok: false, count: 0, error: error.message };
  }
  return { ok: true, count: count || 0 };
}

async function countDocuments() {
  const sb = getSupabase();
  if (!sb) return countLocalDocuments();

  const { count, error } = await sb
    .from('documents')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.warn('[supabase] countDocuments:', error.message);
    return { ok: false, count: 0, error: error.message };
  }
  return { ok: true, count: count || 0 };
}

async function insertDocument(row) {
  const sb = getSupabase();
  const names = catalogFieldsFromIngest({
    fileName: row.fileName,
    displayName: row.displayName || row.display_name,
    description: row.description || row.mo_ta,
  });
  if (!sb) {
    return upsertLocalDocument({ ...row, displayName: names.display_name, description: names.mo_ta });
  }

  const base = {
    file_name: row.fileName,
    display_name: names.display_name,
    mo_ta: names.mo_ta || null,
    so_hieu: row.soHieu || null,
    loai_van_ban: row.loaiVanBan || null,
    trang_thai: row.trangThai || null,
    chunk_count: row.chunkCount || 0,
    storage_path: row.storagePath || null,
    storage_url: row.storageUrl || row.linkGoc || null,
    metadata: {
      ...(row.metadata || {}),
      ...names.metadata,
      ...(row.driveFileId
        ? { drive_file_id: row.driveFileId, drive_web_view_link: row.driveWebViewLink }
        : {}),
      source: row.source || (row.driveFileId ? 'google_drive' : 'upload'),
      category_id: row.categoryId || null,
      folder_path: row.folderPath || null,
      chuyen_mon: row.chuyenMon || null,
      content_sha256: row.contentSha256 || null,
      byte_size: row.byteSize != null ? Number(row.byteSize) : null,
    },
  };

  const withCats = {
    ...(row.id ? { id: row.id } : {}),
    ...base,
    drive_file_id: row.driveFileId || null,
    drive_web_view_link: row.driveWebViewLink || null,
    source: row.source || (row.driveFileId ? 'google_drive' : 'upload'),
    category_id: row.categoryId || null,
    chuyen_mon: row.chuyenMon || null,
    folder_path: row.folderPath || null,
    ...(row.contentSha256 || row.metadata?.content_sha256
      ? { content_sha256: row.contentSha256 || row.metadata.content_sha256 }
      : {}),
    ...(row.byteSize != null ? { byte_size: Number(row.byteSize) } : {}),
  };

  const written = await writeWithColumnFallback(async (body) => {
    const res = await sb.from('documents').insert(body).select('id').single();
    return { data: res.data, error: res.error };
  }, withCats);
  let { data, error } = written;

  if (error) {
    console.warn('[supabase] insertDocument:', pgErrorText(error));
    return { ok: false, error: pgErrorText(error), source: 'supabase' };
  }
  return { ok: true, id: data?.id, source: 'supabase' };
}

async function updateDocumentCategory(id, { categoryId, folderPath, chuyenMon }) {
  const sb = getSupabase();
  if (!sb) return updateLocalDocumentCategory(id, { categoryId, folderPath, chuyenMon });

  const payload = {
    category_id: categoryId,
    folder_path: folderPath || null,
    chuyen_mon: chuyenMon || null,
  };

  const loadMetadata = async () => {
    const cur = await sb.from('documents').select('metadata').eq('id', id).maybeSingle();
    return cur.data?.metadata || {};
  };

  const written = await writeWithColumnFallback(
    async (body) => {
      const res = await sb.from('documents').update(body).eq('id', id).select('id').maybeSingle();
      return { data: res.data, error: res.error };
    },
    payload,
    { loadMetadata }
  );
  const { data, error } = written;

  if (error) {
    console.warn('[supabase] updateDocumentCategory:', pgErrorText(error));
    return { ok: false, error: pgErrorText(error) };
  }

  return { ok: true, id: data?.id || id };
}

async function listIngestedDriveFileIds() {
  const ids = new Set();
  const sb = getSupabase();
  if (!sb) {
    const { listLocalDocuments } = require('./localDocuments');
    for (const d of listLocalDocuments({ limit: 5000 }).items || []) {
      const id = d.drive_file_id || d.metadata?.drive_file_id;
      if (id) ids.add(String(id));
    }
    return [...ids];
  }
  let from = 0;
  const page = 1000;
  for (;;) {
    let data;
    let error;
    ({ data, error } = await sb
      .from('documents')
      .select('drive_file_id, metadata')
      .range(from, from + page - 1));
    if (error && /drive_file_id/i.test(error.message || '')) {
      rememberMissingDocumentColumn('drive_file_id');
      ({ data, error } = await sb.from('documents').select('metadata').range(from, from + page - 1));
    }
    if (error) {
      console.warn('[supabase] listIngestedDriveFileIds:', error.message);
      break;
    }
    const rows = data || [];
    for (const row of rows) {
      const id = row.drive_file_id || row.metadata?.drive_file_id;
      if (id) ids.add(String(id));
    }
    if (rows.length < page) break;
    from += page;
  }
  return [...ids];
}

async function getDocumentByContentHash(hash) {
  const sha = String(hash || '')
    .replace(/[^a-f0-9]/gi, '')
    .toLowerCase();
  if (!sha) return { ok: false };
  const sb = getSupabase();
  if (sb) {
    let data;
    let error;
    if (!missingDocumentColumns.has('content_sha256')) {
      ({ data, error } = await sb.from('documents').select('*').eq('content_sha256', sha).limit(1).maybeSingle());
      if (error) {
        const col = missingColumnFromPgError(error);
        if (col === 'content_sha256' || /content_sha256|schema cache/i.test(pgErrorText(error))) {
          rememberMissingDocumentColumn('content_sha256');
          data = null;
          error = null;
        }
      }
    }
    if (!data) {
      ({ data, error } = await sb
        .from('documents')
        .select('*')
        .filter('metadata->>content_sha256', 'eq', sha)
        .limit(1)
        .maybeSingle());
    }
    if (!error && data) return { ok: true, source: 'supabase', id: data.id, item: hydrateDocument(data) };
  }
  const local = require('./localDocuments').getLocalDocumentByContentHash(sha);
  if (local) return { ok: true, source: 'local', id: local.id, item: local };
  return { ok: false };
}

async function getDocumentByFileName(fileName) {
  const name = String(fileName || '').trim();
  if (!name) return { ok: false };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('documents').select('*').eq('file_name', name).limit(1).maybeSingle();
    if (!error && data) return { ok: true, source: 'supabase', id: data.id, item: hydrateDocument(data) };
  }
  const local = require('./localDocuments').getLocalDocumentByFileName(name);
  if (local) return { ok: true, source: 'local', id: local.id, item: local };
  return { ok: false };
}

async function getDocument(id) {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('documents').select('*').eq('id', id).maybeSingle();
    if (!error && data) return { ok: true, source: 'supabase', item: hydrateDocument(data) };
  }
  const local = getLocalDocument(id);
  if (local) return { ok: true, source: 'local', item: hydrateDocument(local) };
  return { ok: false, error: 'Không tìm thấy tài liệu' };
}

async function updateDocument(id, patch) {
  const sb = getSupabase();
  const payload = {};
  if (patch.file_name != null) payload.file_name = String(patch.file_name).trim();
  if (patch.display_name !== undefined) payload.display_name = String(patch.display_name || '').trim() || null;
  if (patch.mo_ta !== undefined) payload.mo_ta = String(patch.mo_ta || '').trim() || null;
  if (patch.so_hieu !== undefined) payload.so_hieu = patch.so_hieu || null;
  if (patch.loai_van_ban !== undefined) payload.loai_van_ban = patch.loai_van_ban || null;
  if (patch.trang_thai !== undefined) payload.trang_thai = patch.trang_thai || null;
  if (patch.category_id !== undefined) payload.category_id = patch.category_id || null;
  if (patch.folder_path !== undefined) payload.folder_path = patch.folder_path || null;
  if (patch.chuyen_mon !== undefined) payload.chuyen_mon = patch.chuyen_mon || null;
  if (patch.storage_path !== undefined) payload.storage_path = patch.storage_path || null;
  if (patch.storage_url !== undefined) payload.storage_url = patch.storage_url || null;
  if (patch.content_sha256 !== undefined) payload.content_sha256 = patch.content_sha256 || null;
  if (patch.byte_size !== undefined) payload.byte_size = patch.byte_size != null ? Number(patch.byte_size) : null;
  if (patch.chunk_count !== undefined) payload.chunk_count = Number(patch.chunk_count) || 0;
  if (patch.metadata !== undefined) payload.metadata = patch.metadata;
  if (patch.sort_order !== undefined && patch.sort_order !== null && patch.sort_order !== '') {
    payload.sort_order = Number(patch.sort_order) || 0;
  }

  if (sb && Object.keys(payload).length) {
    const written = await writeWithColumnFallback(
      async (body) => {
        const res = await sb.from('documents').update(body).eq('id', id).select('*').maybeSingle();
        return { data: res.data, error: res.error };
      },
      payload,
      {
        loadMetadata: async () => {
          const cur = await sb.from('documents').select('metadata').eq('id', id).maybeSingle();
          return cur.data?.metadata || {};
        },
      }
    );
    let { data, error } = written;
    if (!error && data) {
      if (payload.sort_order !== undefined) {
        const meta = { ...(data.metadata || {}), sort_order: payload.sort_order };
        await sb.from('documents').update({ metadata: meta }).eq('id', id);
        data = { ...data, metadata: meta, sort_order: payload.sort_order };
      }
      return { ok: true, source: 'supabase', item: hydrateDocument(data) };
    }
    if (error) console.warn('[supabase] updateDocument:', pgErrorText(error));
  }
  return updateLocalDocument(id, payload);
}

async function deleteDocumentRow(id) {
  const found = await getDocument(id);
  if (!found.ok) return found;
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from('documents').delete().eq('id', id);
    if (error) {
      console.warn('[supabase] deleteDocument:', error.message);
      return { ok: false, error: error.message };
    }
  }
  deleteLocalDocument(id);
  return { ok: true, item: found.item };
}

module.exports = {
  getSupabase,
  isConfigured,
  uploadPdfToStorage,
  uploadFileToStorage,
  insertChatLog,
  listChatLogs,
  getChatLog,
  markChatKnowledge,
  countChatLogs,
  countDocuments,
  listDocuments,
  insertDocument,
  updateDocumentCategory,
  getDocument,
  getDocumentByFileName,
  getDocumentByContentHash,
  listIngestedDriveFileIds,
  updateDocument,
  deleteDocumentRow,
  STORAGE_BUCKET,
};
