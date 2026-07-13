/**
 * Coverage-gap routes — the "patchwork quilt" instrument.
 *
 * GET /api/coverage/report?since=YYYY-MM-DD&breadthMonths=12
 *   Full payload: overall + trend, the 7×4 gap grid, worst cells, and
 *   riding-base breadth. `since` optionally scopes the demand/loss analysis.
 */

const express = require('express');
const { buildCoverageReport } = require('../services/coverageService');

const router = express.Router();

router.get('/report', (req, res) => {
  try {
    const since = /^\d{4}-\d{2}-\d{2}$/.test(req.query.since || '') ? req.query.since : null;
    const breadthMonths = Math.min(60, Math.max(1, parseInt(req.query.breadthMonths, 10) || 12));
    // months: comma-separated 1-12 season filter, e.g. ?months=5,6,7,8
    const months = String(req.query.months || '')
      .split(',').map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= 12);
    res.json(buildCoverageReport({ since, months: months.length ? months : null, breadthMonths }));
  } catch (err) {
    console.error('[coverage] report failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
