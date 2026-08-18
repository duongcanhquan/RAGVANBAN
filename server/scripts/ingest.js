/**
 * CLI ingestion — Multi-LLM extract + embed → Pinecone (batch).
 *
 * Usage:
 *   npm run ingest -- --dry-run
 *   npm run ingest
 *
 * Data dirs (theo thứ tự ưu tiên):
 *   1) DATA_DIR trong .env
 *   2) server/data
 *   3) <project>/data
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const { listPdfFiles } = require('../src/ingestion/listPdfs');
const { extractPdfText } = require('../src/ingestion/extractPdfText');
const { extractMetadataFromPrefix } = require('../src/ingestion/extractMetadata');
const { chunkTextWithMetadata } = require('../src/ingestion/chunkDocuments');
const { upsertChunksToPinecone } = require('../src/ingestion/upsertToPinecone');
const {
  getExtractLLM,
  getPinecone,
  getEmbeddings,
  withProviderFallback,
  hasLiveKeys,
  listAvailableProviders,
} = require('../src/services/clients');

function defaultUrlForFile(filePath) {
  const base = process.env.PUBLIC_DOCS_BASE_URL || '';
  const name = path.basename(filePath);
  if (base) return `${base.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
  return `file://${filePath.replace(/\\/g, '/')}`;
}

/**
 * Resolve thư mục PDF.
 */
function resolveDataDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.DATA_DIR) {
    const fromEnv = path.resolve(__dirname, '..', process.env.DATA_DIR);
    // DATA_DIR có thể là absolute hoặc relative to server/
    const candidates = [
      path.resolve(process.env.DATA_DIR),
      path.resolve(__dirname, '..', process.env.DATA_DIR),
      path.resolve(__dirname, '../..', process.env.DATA_DIR),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return fromEnv;
  }

  const serverData = path.resolve(__dirname, '../data');
  const rootData = path.resolve(__dirname, '../../data');
  if (fs.existsSync(serverData)) return serverData;
  return rootData;
}

function collectPdfFiles(dataDir) {
  const top = listPdfFiles(dataDir).filter(
    (f) => !f.includes(`${path.sep}fixtures${path.sep}`)
  );
  if (top.length) return top;

  const fixtureCandidates = [
    path.join(dataDir, 'fixtures'),
    path.resolve(__dirname, '../../data/fixtures'),
    path.resolve(__dirname, '../data/fixtures'),
  ];

  for (const fixturesDir of fixtureCandidates) {
    try {
      if (!fs.existsSync(fixturesDir)) continue;
      const fixtures = listPdfFiles(fixturesDir);
      if (fixtures.length) {
        console.log(`[ingest] data trống — dùng ${fixtures.length} file fixtures (${fixturesDir})`);
        return fixtures;
      }
    } catch {
      // tiếp tục candidate khác
    }
  }
  return [];
}

async function runIngest(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const dataDir = resolveDataDir(options.dataDir);
  const chunkSize = Number(process.env.CHUNK_SIZE) || 900;
  const chunkOverlap = Number(process.env.CHUNK_OVERLAP) || 150;

  console.log(`[ingest] dataDir=${dataDir}`);
  console.log(`[ingest] mode=${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`[ingest] chunk=${chunkSize}/${chunkOverlap}`);
  console.log(`[ingest] providers=`, listAvailableProviders());

  const effectiveFiles = collectPdfFiles(dataDir);
  if (!effectiveFiles.length) {
    console.warn('[ingest] Không tìm thấy PDF. Đặt file vào server/data hoặc /data');
    return { files: 0, chunks: 0, upserted: 0, dryRun };
  }

  let llm = null;
  let extractProvider = 'heuristic';
  let embeddings = null;
  let embeddingProvider = null;
  let pinecone = null;

  if (!dryRun) {
    if (!hasLiveKeys()) {
      throw new Error(
        'Thiếu cấu hình Multi-LLM / Pinecone. Điền PINECONE_API_KEY + ít nhất 1 chat key + 1 embedding key (openai|gemini).'
      );
    }

    const extract = await getExtractLLM();
    llm = extract.llm;
    extractProvider = extract.provider;

    const emb = await withProviderFallback('embedding', async (p) => getEmbeddings(p));
    embeddings = emb.result;
    embeddingProvider = emb.provider;

    pinecone = getPinecone();
    console.log(`[ingest] extract=${extractProvider}, embedding=${embeddingProvider}`);
  }

  let totalChunks = 0;
  let totalUpserted = 0;
  const summaries = [];

  for (const filePath of effectiveFiles) {
    const fileName = path.basename(filePath);
    console.log(`\n[ingest] Đang xử lý: ${fileName}`);

    const { text, pageCount } = await extractPdfText(filePath);
    if (!text) {
      console.warn(`  ⚠ Bỏ qua (không có text OCR/extract): ${fileName}`);
      continue;
    }

    const urlFileGoc = defaultUrlForFile(filePath);
    const metadata = await extractMetadataFromPrefix(text, {
      fileName,
      urlFileGoc,
      llm,
      useLlm: !dryRun,
    });

    console.log(
      `  meta: ${metadata.loai_van_ban} | ${metadata.so_hieu} | ${metadata.trang_thai} | CQ=${metadata.co_quan_ban_hanh || '—'} | pages=${pageCount}`
    );

    const chunks = await chunkTextWithMetadata(text, metadata, {
      chunkSize,
      chunkOverlap,
    });
    totalChunks += chunks.length;
    console.log(`  chunks: ${chunks.length}`);

    if (dryRun) {
      summaries.push({ fileName, metadata, chunks: chunks.length, extractProvider });
      continue;
    }

    const { upserted } = await upsertChunksToPinecone(chunks, {
      embeddings,
      pinecone,
      indexName: process.env.PINECONE_INDEX_NAME || 'van-ban-hanh-chinh',
      namespace: process.env.PINECONE_NAMESPACE || '',
      batchSize: Number(process.env.UPSERT_BATCH_SIZE) || 64,
    });
    totalUpserted += upserted;
    summaries.push({
      fileName,
      metadata,
      chunks: chunks.length,
      upserted,
      extractProvider,
      embeddingProvider,
    });
  }

  const summary = {
    files: effectiveFiles.length,
    chunks: totalChunks,
    upserted: totalUpserted,
    dryRun,
    extractProvider,
    embeddingProvider,
  };
  console.log('\n[ingest] Hoàn tất');
  console.log(JSON.stringify(summary, null, 2));
  return { ...summary, summaries };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  try {
    await runIngest({ dryRun });
  } catch (err) {
    console.error('[ingest] LỖI:', err.message || err);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { runIngest, defaultUrlForFile, resolveDataDir };
