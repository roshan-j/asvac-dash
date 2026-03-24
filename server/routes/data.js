/**
 * Data Routes — file upload ingestion & stats queries
 */

const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const db      = require('../db/database');
const stats   = require('../services/statsService');
const { importEsoData }     = require('../services/esoParser');
const { importClockinData } = require('../services/clockinParser');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Upload endpoints ──────────────────────────────────────────────────────────

// POST /api/data/upload/eso
router.post('/upload/eso', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const batchId = `eso-${Date.now()}`;
    const result = importEsoData(req.file.buffer, req.file.originalname, batchId);
    res.json({ success: true, batchId, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/data/upload/clockin
router.post('/upload/clockin', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const batchId = `clockin-${Date.now()}`;
    const result = importClockinData(req.file.buffer, req.file.originalname, batchId);
    res.json({ success: true, batchId, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stats endpoints ───────────────────────────────────────────────────────────

// GET /api/data/periods
router.get('/periods', (req, res) => {
  res.json(stats.getAvailablePeriods());
});

// GET /api/data/members
router.get('/members', (req, res) => {
  res.json(stats.getAllMembers());
});

// PUT /api/data/members/:id — update member info (email, status, etc.)
router.put('/members/:id', (req, res) => {
  const { email, status, joined_date } = req.body;
  db.prepare(`
    UPDATE members SET email=COALESCE(?,email), status=COALESCE(?,status), joined_date=COALESCE(?,joined_date)
    WHERE id=?
  `).run(email, status, joined_date, req.params.id);
  res.json({ success: true });
});

// GET /api/data/corps/trend?months=12
router.get('/corps/trend', (req, res) => {
  const months = parseInt(req.query.months) || 12;
  res.json(stats.getCorpsTrend(months));
});

// GET /api/data/corps/month?year=2025&month=2
router.get('/corps/month', (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  res.json(stats.getCorpsMonthStats(year, month));
});

// GET /api/data/leaderboard?year=2025&month=2
router.get('/leaderboard', (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  res.json(stats.getLeaderboard(year, month));
});

// GET /api/data/members/:id/trend?months=12
router.get('/members/:id/trend', (req, res) => {
  const months = parseInt(req.query.months) || 12;
  res.json(stats.getMemberTrend(req.params.id, months));
});

// GET /api/data/members/:id/summary?year=2025&month=2
router.get('/members/:id/summary', (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  res.json(stats.getMemberSummary(req.params.id, year, month));
});

// GET /api/data/import-history
router.get('/import-history', (req, res) => {
  const riding = db.prepare(`
    SELECT 'eso' AS type, import_batch, MIN(call_date) AS from_date, MAX(call_date) AS to_date, COUNT(*) AS records
    FROM riding_points GROUP BY import_batch ORDER BY rowid DESC LIMIT 20
  `).all();
  const clockin = db.prepare(`
    SELECT 'clockin' AS type, import_batch, MIN(activity_date) AS from_date, MAX(activity_date) AS to_date, COUNT(*) AS records
    FROM nonriding_points GROUP BY import_batch ORDER BY rowid DESC LIMIT 20
  `).all();
  res.json([...riding, ...clockin].sort((a, b) => b.import_batch.localeCompare(a.import_batch)));
});

module.exports = router;
