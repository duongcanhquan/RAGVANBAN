/**
 * Cron nội bộ — đồng bộ file Drive *mới*, không phụ thuộc n8n.
 * GET /api/cron/drive-sync mỗi 15 phút (vercel.json).
 * Header: Authorization: Bearer CRON_SECRET  (hoặc Vercel Cron)
 */

const express = require('express');
const { getFlags } = require('../services/integrations');
const { syncDriveFolder } = require('../services/driveIngest');
const { publicErrorMessage } = require('../services/publicError');

const router = express.Router();

function cronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  const auth = String(req.headers.authorization || '');
  if (secret) return auth === `Bearer ${secret}`;
  return Boolean(req.headers['x-vercel-cron']);
}

router.get('/drive-sync', async (req, res) => {
  if (!cronAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  try {
    const flags = await getFlags();
    if (!flags.driveEnabled) {
      res.json({ ok: true, skipped: true, reason: 'drive_disabled' });
      return;
    }
    const result = await syncDriveFolder({ limit: 8 });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: publicErrorMessage(err, 'Cron Drive thất bại') });
  }
});

module.exports = router;
