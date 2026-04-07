/**
 * attendance.js — routes for CSV attendance upload/preview/commit
 *
 * POST /api/attendance/preview   — parse CSV, return match results (no DB writes)
 * POST /api/attendance/commit    — save confirmed attendance to attendance_events
 * GET  /api/attendance?year=&month= — list attendance events for a month
 */

const express = require('express');
const multer  = require('multer');
const db      = require('../db/database');
const { parseAttendanceCSV } = require('../services/attendanceParser');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Preview ──────────────────────────────────────────────────────────────
router.post('/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const csvText = req.file.buffer.toString('utf8');
  const filename = req.file.originalname;

  const result = parseAttendanceCSV(csvText, filename);
  if (result.error) return res.status(422).json({ error: result.error });

  res.json(result);
});

// ─── Commit ───────────────────────────────────────────────────────────────
const insertEvent = db.prepare(`
  INSERT OR IGNORE INTO attendance_events (member_id, year, month, type, source_file)
  VALUES (?, ?, ?, ?, ?)
`);

router.post('/commit', (req, res) => {
  const { year, month, type, mappings, sourceFile } = req.body;
  if (!year || !month || !type || !Array.isArray(mappings)) {
    return res.status(400).json({ error: 'year, month, type, and mappings[] required' });
  }
  if (!['meeting', 'training'].includes(type)) {
    return res.status(400).json({ error: 'type must be meeting or training' });
  }

  const commitMany = db.transaction((entries) => {
    let saved = 0;
    for (const { memberId } of entries) {
      if (!memberId) continue;
      const info = insertEvent.run(memberId, year, month, type, sourceFile || null);
      saved += info.changes;
    }
    return saved;
  });

  const saved = commitMany(mappings);
  res.json({ saved, total: mappings.filter(m => m.memberId).length });
});

// ─── List ─────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });

  const rows = db.prepare(`
    SELECT ae.type, ae.member_id, m.name
    FROM attendance_events ae
    JOIN members m ON m.id = ae.member_id
    WHERE ae.year = ? AND ae.month = ?
    ORDER BY ae.type, m.name
  `).all(parseInt(year), parseInt(month));

  res.json(rows);
});

module.exports = router;
