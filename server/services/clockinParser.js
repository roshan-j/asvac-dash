/**
 * TimeStation Non-Riding Points Parser
 *
 * Actual export format:
 *
 *   "Date","Employee ID","Name","Department","Device","Time","Activity","Punch Method",...
 *   "01/01/2025","1241","Clear, John","Asvac","Call Credit NEW","11:32 AM","Punch In","PIN",...
 *   "01/01/2025","1241","Clear, John","Asvac","Call Credit NEW","11:32 AM","Punch Out","PIN",...
 *   "01/01/2025","1277","Daniela Schwartz","College Members","Call Credit NEW","10:01 AM","Punch In","PIN",...
 *
 * Rules:
 *  - Filter to rows where Device = "Call Credit NEW" (only non-riding credit events)
 *  - Group rows by (Employee ID + Date) — each unique combination = 1 point
 *  - Punch In / Punch Out distinction is irrelevant — just count presence per day
 *  - John Clear entering his code twice on the same day = 1 point, not 2
 *  - Member names are normalized to "First Last" title case
 *  - Employee ID is stored in the member record for cross-system matching
 */

const Papa = require('papaparse');
const XLSX = require('xlsx');
const db   = require('../db/database');

const POINTS_PER_SESSION = 1;
const REQUIRED_DEVICE    = 'call credit new';  // case-insensitive match

// ─── Name normalization ────────────────────────────────────────────────────────

/**
 * Normalize a TimeStation name to "Firstname Lastname" title case.
 *
 * Handles:
 *   "Clear, John"      → "John Clear"
 *   "Daniela Schwartz" → "Daniela Schwartz"
 *   "Arora, Sid"       → "Sid Arora"
 *   "Moskowitz Susan"  → "Moskowitz Susan"  (already "Last First" without comma — left as-is)
 */
function normalizeName(raw) {
  if (!raw) return null;

  let name = String(raw).trim();

  if (name.includes(',')) {
    // "Last, First" → "First Last"
    const [last, ...firstParts] = name.split(',').map(s => s.trim());
    const first = firstParts.join(' ').trim();
    name = `${first} ${last}`;
  }

  // Title-case
  return name
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    return isNaN(raw) ? null : raw.toISOString().split('T')[0];
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().split('T')[0];
}

// ─── Row parsing ───────────────────────────────────────────────────────────────

function findCol(headers, ...aliases) {
  const lower = headers.map(h => String(h).toLowerCase().trim());
  for (const alias of aliases) {
    const i = lower.indexOf(alias.toLowerCase());
    if (i !== -1) return headers[i];
  }
  return null;
}

function parseRows(rows) {
  if (!rows || rows.length === 0) return [];
  const headers = Object.keys(rows[0]);

  const colDate     = findCol(headers, 'date');
  const colEmpId    = findCol(headers, 'employee id', 'employee_id', 'emp id', 'empid');
  const colName     = findCol(headers, 'name', 'employee name', 'member name');
  const colDevice   = findCol(headers, 'device');

  if (!colDate)  throw new Error('Could not find "Date" column in TimeStation export.');
  if (!colName)  throw new Error('Could not find "Name" column in TimeStation export.');
  if (!colEmpId) throw new Error('Could not find "Employee ID" column in TimeStation export.');

  // Build a deduplicated set: key = "empId|date" → { empId, date, name }
  const sessions = new Map();

  for (const row of rows) {
    // Only process "Call Credit NEW" device rows if column exists
    if (colDevice) {
      const device = String(row[colDevice] || '').toLowerCase().trim();
      if (!device.includes(REQUIRED_DEVICE.replace(/ new$/, ''))) continue;
      // Accept any "Call Credit" device variant
    }

    const date   = parseDate(row[colDate]);
    const empId  = String(row[colEmpId] || '').trim();
    const name   = normalizeName(row[colName]);

    if (!date || !empId || !name) continue;

    const key = `${empId}|${date}`;
    if (!sessions.has(key)) {
      sessions.set(key, { empId, date, name });
    }
  }

  return [...sessions.values()];
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8');
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parseRows(data);
}

function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return parseRows(rows);
}

// ─── DB import ─────────────────────────────────────────────────────────────────

/**
 * Import TimeStation data. Returns { inserted, skipped, members, sessions }
 *
 * Uses Employee ID as the lookup key when creating/finding members, then
 * falls back to name-based lookup so riding and non-riding records
 * link to the same member row.
 */
function importClockinData(buffer, filename, batchId) {
  const ext = filename.toLowerCase().split('.').pop();
  const sessions = ext === 'csv' ? parseCsv(buffer) : parseExcel(buffer);

  if (sessions.length === 0) {
    throw new Error('No valid sessions found. Check that this is a TimeStation export with a "Call Credit" device.');
  }

  // Try to find existing member by name (normalized), create if not found
  const findByName = db.prepare(`SELECT id FROM members WHERE name = ?`);
  const insertMember = db.prepare(`
    INSERT INTO members (name) VALUES (?)
    ON CONFLICT(name) DO UPDATE SET name = excluded.name
    RETURNING id
  `);

  const insertPoint = db.prepare(`
    INSERT OR IGNORE INTO nonriding_points
      (member_id, activity_date, activity, points, import_batch)
    VALUES (?, ?, 'Call Credit', ?, ?)
  `);

  let inserted = 0, skipped = 0;
  const membersSeen = new Set();

  const run = db.transaction(() => {
    for (const session of sessions) {
      // Look up or create member by normalized name
      let row = findByName.get(session.name);
      if (!row) {
        row = insertMember.get(session.name);
      }
      if (!row) continue;

      membersSeen.add(session.name);

      const result = insertPoint.run(
        row.id,
        session.date,
        POINTS_PER_SESSION,
        batchId
      );

      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });

  run();

  return {
    inserted,
    skipped,
    sessions: sessions.length,
    members:  membersSeen.size,
    pointsAwarded: inserted * POINTS_PER_SESSION,
  };
}

module.exports = { importClockinData, normalizeName };
