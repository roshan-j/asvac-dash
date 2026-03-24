/**
 * Google Sheets Routes — shift signup sync
 */

const express = require('express');
const router  = express.Router();
const { syncShiftsFromSheet, getShifts } = require('../services/sheetsService');

// POST /api/sheets/sync
router.post('/sync', async (req, res) => {
  try {
    const result = await syncShiftsFromSheet();
    res.json({ success: true, ...result });
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
