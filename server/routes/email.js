/**
 * Email Routes
 */

const express = require('express');
const router  = express.Router();
const { sendMemberEmail, sendAllMemberEmails } = require('../services/emailService');
const db = require('../db/database');

// POST /api/email/send-member  { memberId, year, month }
router.post('/send-member', async (req, res) => {
  const { memberId, year, month } = req.body;
  if (!memberId || !year || !month) {
    return res.status(400).json({ error: 'memberId, year, and month are required' });
  }
  try {
    const result = await sendMemberEmail(Number(memberId), Number(year), Number(month));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/send-all  { year, month }
router.post('/send-all', async (req, res) => {
  const { year, month } = req.body;
  if (!year || !month) {
    return res.status(400).json({ error: 'year and month are required' });
  }
  try {
    const results = await sendAllMemberEmails(Number(year), Number(month));
    const sent    = results.filter(r => r.success).length;
    const failed  = results.filter(r => !r.success).length;
    res.json({ success: true, sent, failed, details: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/email/logs?limit=50
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = db.prepare(`
    SELECT el.*, m.name AS member_name
    FROM email_logs el
    LEFT JOIN members m ON m.id = el.member_id
    ORDER BY el.sent_at DESC
    LIMIT ?
  `).all(limit);
  res.json(logs);
});

module.exports = router;
