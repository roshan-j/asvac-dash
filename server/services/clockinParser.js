/**
 * Clock-In System Parser (Non-Riding Points)
 *
 * Parses CSV/Excel exports from your clock-in system where each row
 * represents a non-riding activity (meetings, training, maintenance, etc.)
 *
 * Expected columns (flexible matching):
 *   - Member Name / Name / Employee
 *   - Date / Activity Date
 *   - Activity / Description / Event
 *   - Points / Hours / Credit (optional — defaults to 1 per row)
 *
 * Adjust COLUMN_MAP below to match your actual clock-in export headers.
 */

const Papa = require('papaparse');
const XLSX = require('xlsx');
const db = require('../db/database');

const COLUMN_MAP = {
  memberName: ['member name', 'name', 'employee', 'member', 'full name', 'volunteer name'],
  date:       ['date', 'activity date', 'clock date', 'event date', 'log date'],
  activity:   ['activity', 'description', 'event', 'type', 'category', 'clock type'],
  points:     ['points', 'hours', 'credit', 'value', 'score'],
};

function findColumn(headers, aliases) {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  const parts = String(raw).split('/');
  if (parts.length === 3) {
    const [m, day, y] = parts;
    const year = y.length === 2 ? '20' + y : y;
    return `${year}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

function parseRecords(rows) {
  if (!rows || rows.length === 0) return [];
  const headers = Object.keys(rows[0]);

  const colName     = findColumn(headers, COLUMN_MAP.memberName);
  const colDate     = findColumn(headers, COLUMN_MAP.date);
  const colActivity = findColumn(headers, COLUMN_MAP.activity);
  const colPoints   = findColumn(headers, COLUMN_MAP.points);

  if (!colName) throw new Error('Could not find a member name column. Check COLUMN_MAP in clockinParser.js.');
  if (!colDate) throw new Error('Could not find a date column. Check COLUMN_MAP in clockinParser.js.');

  return rows
    .map(row => ({
      memberName:   String(row[colName]     || '').trim(),
      activityDate: parseDate(row[colDate]),
      activity:     colActivity ? String(row[colActivity] || '').trim() : 'Clock-in',
      points:       colPoints   ? (parseFloat(row[colPoints]) || 1) : 1,
    }))
    .filter(r => r.memberName && r.activityDate);
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8');
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parseRecords(result.data);
}

function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return parseRecords(rows);
}

/**
 * Import clock-in data into the database.
 * Returns { inserted, skipped, records, newMembers }
 */
function importClockinData(buffer, filename, batchId) {
  const ext = filename.toLowerCase().split('.').pop();
  const records = ext === 'csv' ? parseCsv(buffer) : parseExcel(buffer);

  const getOrCreateMember = db.prepare(`
    INSERT INTO members (name) VALUES (?)
    ON CONFLICT(name) DO UPDATE SET name=name
    RETURNING id
  `);
  const insertPoint = db.prepare(`
    INSERT INTO nonriding_points (member_id, activity_date, activity, points, import_batch)
    VALUES (?, ?, ?, ?, ?)
  `);

  let inserted = 0, skipped = 0;
  const newMembers = new Set();

  const run = db.transaction(() => {
    for (const rec of records) {
      try {
        const row = getOrCreateMember.get(rec.memberName);
        if (!row) continue;
        newMembers.add(rec.memberName);
        insertPoint.run(row.id, rec.activityDate, rec.activity, rec.points, batchId);
        inserted++;
      } catch {
        skipped++;
      }
    }
  });

  run();
  return { inserted, skipped, records: records.length, newMembers: [...newMembers] };
}

module.exports = { importClockinData };
