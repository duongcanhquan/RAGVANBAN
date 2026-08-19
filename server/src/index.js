/**
 * Entry — Express RAG Multi-LLM + Supabase + Upload.
 * Bind 0.0.0.0 để Windows/Vite proxy (127.0.0.1) luôn vào được.
 */

const path = require('path');
const fs = require('fs');

// Load .env từ root dự án (ổn định dù chạy từ đâu)
const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath, quiet: true, override: false });

const express = require('express');
const cors = require('cors');
const chatRouter = require('./routes/chat');
const uploadRouter = require('./routes/upload');
const adminRouter = require('./routes/admin');
const driveRouter = require('./routes/drive');
const webhooksRouter = require('./routes/webhooks');
const quantriRouter = require('./routes/quantri');
const { requireAdmin } = require('./middleware/requireAdmin');
const { hasLiveKeys, listAvailableProviders, ensureBrain } = require('./services/clients');
const { isConfigured: isSupabaseConfigured } = require('./services/supabase');
const { publicErrorMessage } = require('./services/publicError');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

function allowedOrigins() {
  const fromEnv = String(process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const vercelHosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .filter(Boolean)
    .map((h) => (String(h).startsWith('http') ? String(h) : `https://${h}`));
  return [
    ...new Set([
      ...fromEnv,
      ...vercelHosts,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]),
  ];
}

app.set('trust proxy', true);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins().includes(origin)) return cb(null, true);
      try {
        if (new URL(origin).hostname.endsWith('.vercel.app')) return cb(null, true);
      } catch {
        /* ignore */
      }
      cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await ensureBrain();
  } catch {
    /* env-only */
  }
  let driveOn = false;
  let n8nOn = false;
  let driveReason = 'unknown';
  let n8nReason = 'unknown';
  try {
    const { getIntegrationHealth } = require('./services/integrations');
    const health = await getIntegrationHealth();
    driveOn = health.drive.on;
    n8nOn = health.n8n.on;
    driveReason = health.drive.reason;
    n8nReason = health.n8n.reason;
  } catch (err) {
    console.warn('[health] integrations:', err.message);
    driveReason = 'error';
    n8nReason = 'error';
  }
  res.json({
    status: 'ok',
    service: 'rag-van-ban-hanh-chinh',
    ragReady: hasLiveKeys(),
    supabase: isSupabaseConfigured(),
    r2: isR2Configured(),
    googleDrive: driveOn,
    googleDriveReason: driveReason,
    n8nWebhook: n8nOn,
    n8nWebhookReason: n8nReason,
    vercel: Boolean(process.env.VERCEL),
    providers: listAvailableProviders(),
    port: PORT,
    host: HOST,
    envFile: fs.existsSync(envPath) ? envPath : null,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (_req, res) => {
  res.json({
    message: 'RAG Multi-LLM API',
    endpoints: [
      'GET /api/health',
      'POST /api/chat (SSE)',
      'POST /api/upload (SSE · PDF/DOC/PPT/ảnh/text)',
      'POST /api/upload/text|url (SSE)',
      'GET/POST /api/quantri/*',
      'GET /api/admin/stats',
      'GET /api/drive/status|list',
      'POST /api/drive/ingest|sync (SSE)',
      'POST /api/webhooks/n8n',
      'GET /api/history',
      'GET /api/library/tree',
      'GET|POST /api/scenarios',
    ],
    providers: listAvailableProviders(),
  });
});

app.use('/api/chat', chatRouter);
app.use('/api/quantri', quantriRouter);
app.use('/api/upload', requireAdmin, uploadRouter);
app.use('/api/admin', requireAdmin, adminRouter);
app.use('/api/drive', requireAdmin, driveRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/history', require('./routes/history'));
app.use('/api/library', require('./routes/library'));
app.use('/api/scenarios', require('./routes/scenarios'));
app.use('/api/settings', require('./routes/settings'));

// 404 JSON rõ ràng (tránh HTML "Cannot GET")
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[server] error:', err);
  res.status(err.status || 500).json({ error: publicErrorMessage(err, 'Internal error') });
});

function startServer() {
  const server = app.listen(PORT, HOST, () => {
    console.log('');
    console.log('[server] ========================================');
    console.log(`[server] Listening on http://${HOST}:${PORT}`);
    console.log(`[server] Local:   http://127.0.0.1:${PORT}/api/health`);
    console.log(`[server] Local:   http://localhost:${PORT}/api/health`);
    console.log(`[server] RAG:     ${hasLiveKeys() ? 'LIVE' : 'DEMO (thiếu API keys)'}`);
    console.log(`[server] Supabase:${isSupabaseConfigured() ? ' ON' : ' OFF'}`);
    console.log(`[server] Providers:`, listAvailableProviders());
    console.log(`[server] .env:    ${fs.existsSync(envPath) ? 'OK' : 'MISSING'} (${envPath})`);
    const { getIntegrationHealth } = require('./services/integrations');
    getIntegrationHealth()
      .then((h) => {
        const driveLabel =
          h.drive.reason === 'ok'
            ? 'ON'
            : h.drive.reason === 'missing_key'
              ? 'OFF (chưa dán Google JSON trong Cài đặt)'
              : h.drive.reason === 'disabled'
                ? 'OFF (đã tắt công tắc)'
                : 'OFF';
        const n8nLabel =
          h.n8n.reason === 'ok'
            ? 'ON'
            : h.n8n.reason === 'missing_secret'
              ? 'OFF (chưa có secret — mở Cài đặt → n8n)'
              : h.n8n.reason === 'disabled'
                ? 'OFF (đã tắt công tắc)'
                : 'OFF';
        console.log(`[server] Drive:   ${driveLabel}`);
        console.log(`[server] n8n:     ${n8nLabel}`);
        console.log('[server] ========================================');
        console.log('[server] Giữ cửa sổ này mở. Ctrl+C để dừng.');
        console.log('');
      })
      .catch((err) => {
        console.log(`[server] Drive/n8n: không đọc được cài đặt (${err.message})`);
        console.log('[server] ========================================');
        console.log('[server] Giữ cửa sổ này mở. Ctrl+C để dừng.');
        console.log('');
      });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error(`[server] LỖI: Port ${PORT} đang bị chiếm.`);
      console.error('[server] Cách xử lý (PowerShell):');
      console.error(`  netstat -ano | findstr :${PORT}`);
      console.error('  Stop-Process -Id <PID> -Force');
      console.error('  rồi chạy lại: npm run start');
      console.error('');
    } else {
      console.error('[server] Listen error:', err);
    }
    process.exit(1);
  });

  // Giữ process sống; log lỗi không làm sập im lặng
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException:', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[server] unhandledRejection:', err);
  });

  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} — đang tắt...`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  const { refreshBrain } = require('./services/llmConfig');
  refreshBrain()
    .catch((err) => console.warn('[brain] load:', err.message))
    .finally(() => startServer());
}

module.exports = app;
