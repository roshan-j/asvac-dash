/**
 * Reports Routes — generate printable spreadsheets for a selected month
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const XLSX    = require('xlsx');

// ─── GET /api/reports/monthly-print?year=YYYY&month=MM[&adultOnly=1] ──────────
router.get('/monthly-print', (req, res) => {
  try {
    const year      = parseInt(req.query.year,  10);
    const month     = parseInt(req.query.month, 10);
    const adultOnly = req.query.adultOnly !== '0'; // default true
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ error: 'year and month (1-12) are required' });
    }

    // Date range for the requested month
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end   = new Date(year, month, 0).toISOString().slice(0, 10); // last day

    // member_type filter: 'adult' or 'both' means adult corps member
    const typeClause = adultOnly
      ? `AND m.member_type IN ('adult', 'both')`
      : '';

    // ── Pull per-member data for the month ─────────────────────────────────────
    const rows = db.prepare(`
      SELECT
        m.id,
        m.name,
        m.member_type,
        COALESCE(r.call_pts,  0) AS callPts,
        COALESCE(s.schedule,  0) AS schedule,
        COALESCE(n.call_credit, 0) AS callCredit,
        COALESCE(mt.meeting_cnt,  0) AS meetingCnt,
        COALESCE(tr.training_cnt, 0) AS trainingCnt
      FROM members m
      LEFT JOIN (
        SELECT member_id, SUM(points) AS call_pts
        FROM riding_points
        WHERE call_date BETWEEN ? AND ?
        GROUP BY member_id
      ) r ON r.member_id = m.id
      LEFT JOIN (
        SELECT member_id, COUNT(*) AS schedule
        FROM shift_signups
        WHERE shift_date BETWEEN ? AND ?
        GROUP BY member_id
      ) s ON s.member_id = m.id
      LEFT JOIN (
        SELECT member_id, SUM(points) AS call_credit
        FROM nonriding_points
        WHERE activity_date BETWEEN ? AND ?
        GROUP BY member_id
      ) n ON n.member_id = m.id
      LEFT JOIN (
        SELECT member_id, COUNT(*) AS meeting_cnt
        FROM attendance_events
        WHERE year = ? AND month = ? AND type = 'meeting'
        GROUP BY member_id
      ) mt ON mt.member_id = m.id
      LEFT JOIN (
        SELECT member_id, COUNT(*) AS training_cnt
        FROM attendance_events
        WHERE year = ? AND month = ? AND type = 'training'
        GROUP BY member_id
      ) tr ON tr.member_id = m.id
      WHERE m.status = 'active'
        ${typeClause}
        AND (
          COALESCE(r.call_pts,    0) > 0 OR
          COALESCE(s.schedule,    0) > 0 OR
          COALESCE(n.call_credit, 0) > 0 OR
          COALESCE(mt.meeting_cnt,  0) > 0 OR
          COALESCE(tr.training_cnt, 0) > 0
        )
      ORDER BY m.name
    `).all(start, end, start, end, start, end, year, month, year, month);

    // ── Determine display names (first name only; full name if duplicate) ───────
    const firstNames = {};
    for (const row of rows) {
      const first = row.name.split(' ')[0];
      firstNames[first] = (firstNames[first] || 0) + 1;
    }
    const displayRows = rows.map(row => {
      const parts = row.name.split(' ');
      const first = parts[0];
      const displayName = firstNames[first] > 1 ? row.name : first;

      const callPts    = row.callPts;
      const schedule   = row.schedule;
      const eventStby  = 0;  // not yet tracked
      const callCredit = row.callCredit;
      const totalRiding = callPts + schedule + eventStby + callCredit;
      const meeting    = row.meetingCnt;
      const training   = row.trainingCnt;
      const totals     = totalRiding + meeting + training;

      return { displayName, callPts, schedule, eventStby, callCredit, totalRiding, meeting, training, totals };
    });

    // ── Sort alpha by display name ─────────────────────────────────────────────
    displayRows.sort((a, b) => a.displayName.localeCompare(b.displayName));

    // ── Build XLSX ─────────────────────────────────────────────────────────────
    const monthLabel = new Date(year, month - 1, 1)
      .toLocaleString('en-US', { month: 'long' });
    const sheetTitle = `${monthLabel} ${year}`;

    const headers = [
      '',
      'Call Points (ESO)',
      'Schedule',
      'Event - Standby',
      'Call Credit - Pingback',
      'Total Riding Points',
      'Meeting',
      'Training',
      'Totals',
    ];

    const dataRows = displayRows.map(r => [
      r.displayName,
      r.callPts    || '',
      r.schedule   || '',
      r.eventStby  || '',
      r.callCredit || '',
      r.totalRiding || '',
      r.meeting    || '',
      r.training   || '',
      r.totals     || '',
    ]);

    const wsData = [headers, ...dataRows];
    const ws     = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws['!cols'] = [
      { wch: 22 }, // Name
      { wch: 18 }, // Call Points
      { wch: 10 }, // Schedule
      { wch: 15 }, // Event - Standby
      { wch: 22 }, // Call Credit
      { wch: 20 }, // Total Riding
      { wch: 10 }, // Meeting
      { wch: 10 }, // Training
      { wch: 10 }, // Totals
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, monthLabel);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `ASVAC_${monthLabel}_${year}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (err) {
    console.error('[reports] monthly-print error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
