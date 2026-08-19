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
const { listIngestFiles, listPdfFiles } = require('../src/ingestion/listPdfs');
const { ingestSingleFile } = require('../src/services/ingestFile');
const {
  hasLiveKeys,
  listAvailableProviders,
  ensureBrain,
  brainNotReadyMessage,
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
  const top = listIngestFiles(dataDir).filter(
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

  console.log(`[ingest] dataDir=${dataDir}`);
  console.log(`[ingest] mode=${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`[ingest] providers=`, listAvailableProviders());

  const effectiveFiles = collectPdfFiles(dataDir);
  if (!effectiveFiles.length) {
    console.warn('[ingest] Không tìm thấy tài liệu. Đặt file vào server/data hoặc /data');
    return { files: 0, chunks: 0, upserted: 0, dryRun };
  }

  if (!dryRun) {
    await ensureBrain();
    if (!hasLiveKeys()) {
      throw new Error(brainNotReadyMessage());
    }
  }

  let totalChunks = 0;
  let totalUpserted = 0;
  const summaries = [];

  for (const filePath of effectiveFiles) {
    const fileName = path.basename(filePath);
    console.log(`\n[ingest] Đang xử lý: ${fileName}`);
    try {
      const r = await ingestSingleFile(filePath, {
        dryRun,
        onProgress: ({ message }) => console.log(`  ${message}`),
      });
      totalChunks += r.chunks || 0;
      totalUpserted += r.upserted || 0;
      summaries.push({
        fileName,
        metadata: r.metadata,
        chunks: r.chunks,
        upserted: r.upserted,
        extractProvider: r.extractProvider,
        embeddingProvider: r.embeddingProvider,
      });
    } catch (err) {
      console.warn(`  ⚠ Bỏ qua ${fileName}: ${err.message}`);
      summaries.push({ fileName, error: err.message });
    }
  }

  const summary = {
    files: effectiveFiles.length,
    chunks: totalChunks,
    upserted: totalUpserted,
    dryRun,
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
