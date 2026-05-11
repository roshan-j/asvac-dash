/**
 * Google Sheets Routes — shift signup sync
 */

const express = require('express');
const router  = express.Router();
const { syncDutyboard, getShifts } = require('../services/sheetsService');
const { syncEventCredits }         = require('../services/eventsService');

// POST /api/sheets/sync — dutyboards + event credit
router.post('/sync', async (req, res) => {
  try {
    const dutyboard = await syncDutyboard();
    const events    = await syncEventCredits();
    res.json({ success: true, dutyboard, events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sheets/sync-events — events only
router.post('/sync-events', async (req, res) => {
  try {
    const events = await syncEventCredits();
    res.json({ success: true, ...events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sheets/shifts?year=2025&month=2&memberId=3
router.get('/shifts', (req, res) => {
  const { year, month, memberId } = req.query;
  const shifts = getShifts({
    year:     year     ? parseInt(year)     : undefined,
    month:    month    ? parseInt(month)    : undefined,
    memberId: memberId ? parseInt(memberId) : undefined,
  });
  res.json(shifts);
});

module.exports = router;
