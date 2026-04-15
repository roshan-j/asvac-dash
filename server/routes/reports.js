/**
 * Reports Routes — generate printable spreadsheets for a selected month
 */

const express  = require('express');
const router   = express.Router();
const db       = require('../db/database');
const ExcelJS  = require('exceljs');
const fs       = require('fs');
const { Readable } = require('stream');
const { google } = require('googleapis');

const { TOKENS_PATH, buildOAuth2Client } = require('./auth');

// Shift-response multiplier — same logic as statsService.js
const SHIFT_BONUS = 1.5;
const MULTIPLIED_PTS = `
  CASE
    WHEN r.call_time IS NOT NULL AND EXISTS (
      SELECT 1 FROM shift_signups ss
      WHERE ss.member_id = r.member_id
        AND ss.shift_date = r.call_date
        AND CAST(REPLACE(r.call_time, ':', '') AS INTEGER)
            >= CAST(SUBSTR(ss.shift_time, 1, 4) AS INTEGER)
        AND CAST(REPLACE(r.call_time, ':', '') AS INTEGER)
            <  CAST(SUBSTR(ss.shift_time, 6, 4) AS INTEGER)
    ) THEN r.points * ${SHIFT_BONUS}
    ELSE r.points
  END`.trim();

const AUTH_URL = `${process.env.SERVER_ORIGIN || 'http://localhost:3001'}/api/auth/google`;
const needsAuthResponse = () => ({ needsAuth: true, authUrl: AUTH_URL });

function getDriveClient() {
  try {
    const tokens       = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    const oauth2Client = buildOAuth2Client();
    oauth2Client.setCredentials(tokens);
    oauth2Client.once('tokens', updated => {
      fs.writeFileSync(TOKENS_PATH, JSON.stringify({ ...tokens, ...updated }, null, 2));
    });
    return google.drive({ version: 'v3', auth: oauth2Client });
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[reports] Failed to load OAuth2 tokens:', e.message);
    return null;
  }
}

// ─── Shared: build workbook buffer for a given month ──────────────────────────
async function buildMonthlyWorkbook(year, month, adultOnly = true) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end      = new Date(year, month, 0).toISOString().slice(0, 10);
  const ytdStart = `${year}-01-01`;
  const typeClause = adultOnly ? `AND m.member_type IN ('adult', 'both')` : '';

  const rows = db.prepare(`
    SELECT
      m.id, m.name, m.member_type,
      COALESCE(r.call_pts,          0) AS callPts,
      COALESCE(s.schedule,          0) AS schedule,
      COALESCE(sb.event_stby,       0) AS eventStby,
      COALESCE(n.call_credit,       0) AS callCredit,
      COALESCE(mt.meeting_cnt,      0) AS meetingCnt,
      COALESCE(tr.training_cnt,     0) AS trainingCnt,
      COALESCE(of.points_per_month, 0) AS officerPts,
      COALESCE(ry.call_pts_ytd,     0) AS callPtsYtd,
      COALESCE(sy.schedule_ytd,     0) AS scheduleYtd,
      COALESCE(sby.event_stby_ytd,  0) AS eventStbyYtd,
      COALESCE(ny.call_credit_ytd,  0) AS callCreditYtd,
      COALESCE(mty.meeting_ytd,     0) AS meetingCntYtd,
      COALESCE(try2.training_ytd,   0) AS trainingCntYtd
    FROM members m
    LEFT JOIN (
      SELECT r.member_id, SUM(${MULTIPLIED_PTS}) AS call_pts
      FROM riding_points r WHERE r.call_date BETWEEN ? AND ?
      GROUP BY r.member_id
    ) r ON r.member_id = m.id
    LEFT JOIN (
      SELECT member_id,
        SUM((CAST(SUBSTR(shift_time,6,4) AS INTEGER) - CAST(SUBSTR(shift_time,1,4) AS INTEGER))/200) AS schedule
      FROM shift_signups WHERE shift_date BETWEEN ? AND ?
      GROUP BY member_id
    ) s ON s.member_id = m.id
    LEFT JOIN (
      SELECT member_id, SUM(points) AS event_stby
      FROM standby_events WHERE event_date BETWEEN ? AND ?
      GROUP BY member_id
    ) sb ON sb.member_id = m.id
    LEFT JOIN (
      SELECT member_id, SUM(points) AS call_credit
      FROM nonriding_points WHERE activity_date BETWEEN ? AND ?
      GROUP BY member_id
    ) n ON n.member_id = m.id
    LEFT JOIN (
      SELECT member_id, COUNT(*) AS meeting_cnt
      FROM attendance_events WHERE year = ? AND month = ? AND type = 'meeting'
      GROUP BY member_id
    ) mt ON mt.member_id = m.id
    LEFT JOIN (
      SELECT member_id, COUNT(*) AS training_cnt
      FROM attendance_events WHERE year = ? AND month = ? AND type = 'training'
      GROUP BY member_id
    ) tr ON tr.member_id = m.id
    LEFT JOIN officers of ON of.member_id = m.id AND of.year = ?
    LEFT JOIN (
      SELECT r.member_id, SUM(${MULTIPLIED_PTS}) AS call_pts_ytd
      FROM riding_points r WHERE r.call_date BETWEEN ? AND ?
      GROUP BY r.member_id
    ) ry ON ry.member_id = m.id
    LEFT JOIN (
      SELECT member_id,
        SUM((CAST(SUBSTR(shift_time,6,4) AS INTEGER) - CAST(SUBSTR(shift_time,1,4) AS INTEGER))/200) AS schedule_ytd
      FROM shift_signups WHERE shift_date BETWEEN ? AND ?
      GROUP BY member_id
    ) sy ON sy.member_id = m.id
    LEFT JOIN (
      SELECT member_id, SUM(points) AS event_stby_ytd
      FROM standby_events WHERE event_date BETWEEN ? AND ?
      GROUP BY member_id
    ) sby ON sby.member_id = m.id
    LEFT JOIN (
      SELECT member_id, SUM(points) AS call_credit_ytd
      FROM nonriding_points WHERE activity_date BETWEEN ? AND ?
      GROUP BY member_id
    ) ny ON ny.member_id = m.id
    LEFT JOIN (
      SELECT member_id, COUNT(*) AS meeting_ytd
      FROM attendance_events WHERE year = ? AND month <= ? AND type = 'meeting'
      GROUP BY member_id
    ) mty ON mty.member_id = m.id
    LEFT JOIN (
      SELECT member_id, COUNT(*) AS training_ytd
      FROM attendance_events WHERE year = ? AND month <= ? AND type = 'training'
      GROUP BY member_id
    ) try2 ON try2.member_id = m.id
    WHERE m.status = 'active'
      ${typeClause}
      AND (
        COALESCE(r.call_pts,          0) > 0 OR
        COALESCE(s.schedule,          0) > 0 OR
        COALESCE(sb.event_stby,       0) > 0 OR
        COALESCE(n.call_credit,       0) > 0 OR
        COALESCE(mt.meeting_cnt,      0) > 0 OR
        COALESCE(tr.training_cnt,     0) > 0 OR
        COALESCE(of.points_per_month, 0) > 0
      )
    ORDER BY m.name
  `).all(
    start, end, start, end, start, end, start, end, year, month, year, month,
    year,
    ytdStart, end, ytdStart, end, ytdStart, end, ytdStart, end, year, month, year, month
  );

  const displayRows = rows.map(row => {
    const displayName    = row.name;
    const callPts        = row.callPts;
    const schedule       = row.schedule;
    const eventStby      = row.eventStby;
    const callCredit     = row.callCredit;
    const totalRiding    = callPts + schedule + eventStby + callCredit;
    const meeting        = row.meetingCnt  * 2;
    const training       = row.trainingCnt * 2;
    const officer        = row.officerPts;
    const totals         = totalRiding + meeting + training + officer;
    // YTD columns — structured to match sample report (D–H) + 95 to Qualify
    const meetingYtd   = row.meetingCntYtd  * 2;                                  // cap 24
    const trainingYtd  = row.trainingCntYtd * 2;                                  // cap 24
    const ridingYtd    = row.callPtsYtd + row.scheduleYtd + row.eventStbyYtd;    // cap 80
    const officerYtd   = officer * month;                                          // cap 25
    const otherYtd     = row.callCreditYtd;                                       // cap 10
    const qualifyScore = Math.min(meetingYtd, 24) + Math.min(trainingYtd, 24)
                       + Math.min(ridingYtd, 80)  + Math.min(officerYtd, 25)
                       + Math.min(otherYtd, 10);
    return {
      displayName, callPts, schedule, eventStby, callCredit, totalRiding,
      meeting, training, officer, totals,
      meetingYtd, trainingYtd, ridingYtd, officerYtd, otherYtd, qualifyScore,
    };
  });

  displayRows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });

  // ─── Build styled workbook with ExcelJS ────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASVAC Dashboard';
  const ws = wb.addWorksheet(monthLabel);

  // Freeze header row
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  ws.columns = [
    { width: 26 }, // A  Name
    { width: 14 }, // B  Call Points
    { width: 10 }, // C  Schedule
    { width: 14 }, // D  Event-Standby
    { width: 20 }, // E  Call Credit - Pin Pad
    { width: 18 }, // F  Total Riding
    { width: 10 }, // G  Meeting
    { width: 10 }, // H  Training
    { width: 10 }, // I  Officers
    { width: 10 }, // J  Totals
    { width:  3 }, // K  spacer
    { width: 14 }, // L  YTD Meetings
    { width: 12 }, // M  YTD Training
    { width: 12 }, // N  YTD Riding
    { width: 12 }, // O  YTD Officers
    { width: 10 }, // P  YTD Other
    { width: 14 }, // Q  95 to Qualify
  ];

  // Palette
  const NAVY      = 'FF1B4F8A';  // monthly header bg
  const FOREST    = 'FF1E5631';  // YTD header bg
  const GOLD_HDR  = 'FF7B5B00';  // 95-to-qualify header bg (dark gold text on amber)
  const GOLD_BG   = 'FFFFF3CD';  // 95-to-qualify data cells
  const GOLD_HDR_BG = 'FFFFC107'; // 95-to-qualify header bg (amber)
  const BLUE_EVEN = 'FFE8EEF8';  // even data rows, monthly cols
  const GREEN_EVEN= 'FFE8F4EE';  // even data rows, YTD cols
  const GREEN_ODD = 'FFF5FAF7';  // odd data rows, YTD cols (slight tint)
  const SPACER    = 'FFD8D8D8';
  const HIDE_ZERO = '#,##0;-#,##0;;@'; // show blank for zero values

  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const fnt  = (bold, argb = 'FF1A1A2E', size = 11) =>
    ({ name: 'Calibri', size, bold, color: { argb } });

  // ── Header row ────────────────────────────────────────────────────────────
  const headers = [
    'Adult Member', 'Call Points (ESO)', 'Schedule', 'Event - Standby',
    'Call Credit - Pin Pad', 'Total Riding Points', 'Meeting', 'Training',
    'Officers', 'Totals', '',
    'YTD Meetings', 'YTD Training', 'YTD Riding', 'YTD Officers', 'YTD Other',
    '95 to Qualify',
  ];
  const hRow = ws.addRow(headers);
  hRow.height = 30;
  hRow.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.font      = fnt(true, 'FFFFFFFF');
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    if      (col <= 10)  cell.fill = fill(NAVY);
    else if (col === 11) cell.fill = fill(SPACER);
    else if (col <= 16)  cell.fill = fill(FOREST);
    else                 { cell.fill = fill(GOLD_HDR_BG); cell.font = fnt(true, GOLD_HDR); }
  });

  // ── Data rows ─────────────────────────────────────────────────────────────
  displayRows.forEach((r, i) => {
    const rowNum = i + 2;
    const even   = i % 2 === 0;

    const row = ws.addRow([
      r.displayName,
      r.callPts, r.schedule, r.eventStby, r.callCredit,
      0,           // F → formula
      r.meeting, r.training, r.officer,
      0,           // J → formula
      null,        // K spacer
      r.meetingYtd, r.trainingYtd, r.ridingYtd, r.officerYtd, r.otherYtd,
      0,           // Q → formula
    ]);
    row.height = 17;

    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col === 1) {
        cell.font      = fnt(false, 'FF1A1A2E');
        cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        cell.fill      = fill(even ? 'FFF8F9FA' : 'FFFFFFFF');
      } else if (col <= 10) {
        cell.fill      = fill(even ? BLUE_EVEN : 'FFFFFFFF');
        cell.font      = fnt([6, 10].includes(col));  // bold subtotals
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt    = HIDE_ZERO;
      } else if (col === 11) {
        cell.fill = fill(SPACER);
      } else if (col <= 16) {
        cell.fill      = fill(even ? GREEN_EVEN : GREEN_ODD);
        cell.font      = fnt(false);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt    = HIDE_ZERO;
      } else {
        cell.fill      = fill(GOLD_BG);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt    = HIDE_ZERO;
      }
    });

    // Formula: F = Total Riding
    const F = row.getCell(6);
    F.value    = { formula: `B${rowNum}+C${rowNum}+D${rowNum}+E${rowNum}`, result: r.totalRiding };
    F.fill     = fill(even ? BLUE_EVEN : 'FFFFFFFF');
    F.font     = fnt(true);
    F.alignment= { horizontal: 'center', vertical: 'middle' };
    F.numFmt   = HIDE_ZERO;

    // Formula: J = Totals
    const J = row.getCell(10);
    J.value    = { formula: `F${rowNum}+G${rowNum}+H${rowNum}+I${rowNum}`, result: r.totals };
    J.fill     = fill(even ? BLUE_EVEN : 'FFFFFFFF');
    J.font     = fnt(true);
    J.alignment= { horizontal: 'center', vertical: 'middle' };
    J.numFmt   = HIDE_ZERO;

    // Formula: Q = 95 to Qualify (capped)
    const passed = r.qualifyScore >= 95;
    const Q = row.getCell(17);
    Q.value    = { formula: `MIN(L${rowNum},24)+MIN(M${rowNum},24)+MIN(N${rowNum},80)+MIN(O${rowNum},25)+MIN(P${rowNum},10)`, result: r.qualifyScore };
    Q.fill     = fill(GOLD_BG);
    Q.font     = fnt(true, passed ? 'FF155724' : 'FF721C24');
    Q.alignment= { horizontal: 'center', vertical: 'middle' };
    Q.numFmt   = HIDE_ZERO;
  });

  const buf = await wb.xlsx.writeBuffer();
  return { buf, monthLabel, filename: `ASVAC_${monthLabel}_${year}.xlsx` };
}

// ─── GET /api/reports/monthly-print?year=YYYY&month=MM[&adultOnly=1] ──────────
router.get('/monthly-print', async (req, res) => {
  try {
    const year      = parseInt(req.query.year,  10);
    const month     = parseInt(req.query.month, 10);
    const adultOnly = req.query.adultOnly !== '0';
    if (!year || !month || month < 1 || month > 12)
      return res.status(400).json({ error: 'year and month (1-12) are required' });

    const { buf, filename } = await buildMonthlyWorkbook(year, month, adultOnly);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('[reports] monthly-print error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/reports/open-in-sheets?year=YYYY&month=MM[&adultOnly=1] ────────
// Uploads the XLSX to Google Drive (as a native Sheet) and returns the URL.
// Requires a one-time OAuth2 consent via GET /api/auth/google.
router.post('/open-in-sheets', async (req, res) => {
  const drive = getDriveClient();
  if (!drive) return res.status(401).json(needsAuthResponse());

  try {
    const year      = parseInt(req.query.year,  10);
    const month     = parseInt(req.query.month, 10);
    const adultOnly = req.query.adultOnly !== '0';
    if (!year || !month || month < 1 || month > 12)
      return res.status(400).json({ error: 'year and month (1-12) are required' });

    const { buf, filename } = await buildMonthlyWorkbook(year, month, adultOnly);

    const driveRes = await drive.files.create({
      requestBody: {
        name:     filename.replace('.xlsx', ''),
        mimeType: 'application/vnd.google-apps.spreadsheet',
      },
      media: {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body:     Readable.from(buf),
      },
      fields: 'id',
    });

    res.json({ url: `https://docs.google.com/spreadsheets/d/${driveRes.data.id}/edit` });
  } catch (err) {
    console.error('[reports] open-in-sheets error:', err);
    if (err.code === 401 || err.message?.includes('invalid_grant')) {
      try { fs.unlinkSync(TOKENS_PATH); } catch (_) {}
      return res.status(401).json(needsAuthResponse());
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
