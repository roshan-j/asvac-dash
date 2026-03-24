/**
 * ESO Call Record Parser
 *
 * Parses CSV/Excel exports from ESO where each row is a call (incident)
 * containing one or more responding members. Derives riding points per member.
 *
 * Expected columns (flexible matching):
 *   - Incident / Call Number
 *   - Incident Date / Call Date / Date
 *   - Call Type / Incident Type
 *   - Crew Members / Responding Members / Personnel (comma-separated names OR one per row)
 *
 * You can adjust the COLUMN_MAP below to match your actual ESO export headers.
 */

const Papa = require('papaparse');
const XLSX = require('xlsx');
const db = require('../db/database');

// ── Column name aliases ────────────────────────────────────────────────────────
const COLUMN_MAP = {
  callNumber: ['incident number', 'call number', 'incident #', 'call #', 'run number'],
  callDate:   ['incident date', 'call date', 'date', 'run date'],
  callType:   ['call type', 'incident type', 'nature', 'problem'],
  members:    ['crew members', 'responding members', 'personnel', 'crew', 'members responding'],
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
  // Handle MM/DD/YYYY, YYYY-MM-DD, M/D/YY, etc.
  const d = new Date(raw);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  // Try MM/DD/YYYY
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

  const colCallNum  = findColumn(headers, COLUMN_MAP.callNumber);
  const colDate     = findColumn(headers, COLUMN_MAP.callDate);
  const colType     = findColumn(headers, COLUMN_MAP.callType);
  const colMembers  = findColumn(headers, COLUMN_MAP.members);

  if (!colDate) throw new Error('Could not find a date column in the ESO export. Check COLUMN_MAP in esoParser.js.');
  if (!colMembers) throw new Error('Could not find a members/crew column in the ESO export. Check COLUMN_MAP in esoParser.js.');

  // Each row may have multiple members (comma-separated) or one member per row
  const records = [];
  for (const row of rows) {
    const callDate   = parseDate(row[colDate]);
    const callNumber = colCallNum ? String(row[colCallNum] || '').trim() : null;
    const callType   = colType   ? String(row[colType]   || '').trim() : null;
    const membersRaw = String(row[colMembers] || '').trim();

    if (!callDate || !membersRaw) continue;

    // Split on comma or semicolon
    const names = membersRaw.split(/[,;]/).map(n => n.trim()).filter(Boolean);
    for (const name of names) {
      records.push({ callDate, callNumber, callType, memberName: name });
    }
  }
  return records;
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
 * Import ESO data into the database.
 * Returns { inserted, skipped, errors, newMembers }
 */
function importEsoData(buffer, filename, batchId) {
  const ext = filename.toLowerCase().split('.').pop();
  const records = ext === 'csv' ? parseCsv(buffer) : parseExcel(buffer);

  const getOrCreateMember = db.prepare(`
    INSERT INTO members (name) VALUES (?)
    ON CONFLICT(name) DO UPDATE SET name=name
    RETURNING id
  `);
  const insertPoint = db.prepare(`
    INSERT OR IGNORE INTO riding_points (member_id, call_date, call_number, call_type, points, import_batch)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  let inserted = 0, skipped = 0;
  const newMembers = new Set();

  const run = db.transaction(() => {
    for (const rec of records) {
      const row = getOrCreateMember.get(rec.memberName);
      if (!row) continue;
      const memberId = row.id;
      newMembers.add(rec.memberName);

      const result = insertPoint.run(memberId, rec.callDate, rec.callNumber, rec.callType, batchId);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });

  run();
  return { inserted, skipped, records: records.length, newMembers: [...newMembers] };
}

module.exports = { importEsoData };
