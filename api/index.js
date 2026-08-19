/**
 * Vercel serverless entry — export Express app (không listen).
 * Rewrite /api/* → file này; Express giữ nguyên các route /api/chat, /api/upload, …
 */
module.exports = require('../server/src/index.js');
