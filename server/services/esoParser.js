/**
 * ESO (Widget) Call Record Parser
 *
 * Actual export format — 2 columns, one member per row:
 *
 *   "Time in PSAP Call","PM Complete Person Name (Last, First Middle Suffix | Employee Number)"
 *   "01/01/2025 08:45","CLEAR, JOHN"
 *   "01/01/2025 08:45","ARORA, SIDDHARTH"
 *   "01/02/2025 09:45","KATZENSTEIN, JED | 481112"
 *
 * Rules:
 *  - Each row = one member on one call
 *  - Rows sharing the same "Time in PSAP Call" value are the same call
 *  - Each member earns POINTS_PER_CALL (2) for each unique call they appear on
 *  - The call timestamp is used as the call identifier for deduplication
 *  - Member names are normalized: strip "| EmployeeNum", convert to "First Last" title case
 */

const Papa = require('papaparse');
const XLSX = require('xlsx');
const db   = require('../db/database');

const POINTS_PER_CALL = 2;

// ─── Name normalization ────────────────────────────────────────────────────────

/**
 * Normalize an ESO name to "Firstname Lastname" title case.
 *
 * Handles formats:
 *   "CLEAR, JOHN"           → "John Clear"
 *   "SCHWARTZ, DANIELA | 1277" → "Daniela Schwartz"
 *   "RABADI - T, TONY"      → "Tony Rabadi - T"
 *   "Lopez, Ashly"          → "Ashly Lopez"
 *   "Tomioka, Serina | 6799" → "Serina Tomioka"
 */
function normalizeName(raw) {
  if (!raw) return null;

  // Strip employee number suffix ( | XXXX )
  let name = String(raw).replace(/\|.*$/, '').trim();

  if (name.includes(',')) {
    // "LAST, FIRST MIDDLE" → "First Middle Last"
    const [last, ...firstParts] = name.split(',').map(s => s.trim());
    const first = firstParts.join(' ').trim();
    name = `${first} ${last}`;
  }

  // Title-case each word
  return name
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Date parsing ──────────────────────────────────────────────────────────────

/**
 * Parse "MM/DD/YYYY HH:MM" (or just "MM/DD/YYYY") → "YYYY-MM-DD"
 * Also handles ISO dates and Excel serial numbers.
 */
function parseCallDate(raw) {
  if (!raw) return null;

  // If it's already a JS Date (from XLSX cellDates:true)
  if (raw instanceof Date) {
    if (isNaN(raw)) return null;
    return raw.toISOString().split('T')[0];
  }

  const s = String(raw).trim();

  // "MM/DD/YYYY HH:MM" or "MM/DD/YYYY"
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // ISO fallback
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().split('T')[0];

  return null;
}

// ─── Row parsing ───────────────────────────────────────────────────────────────

const COL_TIMESTAMP = 'time in psap call';
const COL_MEMBER    = 'pm complete person name';   // prefix match — full header is long

function findHeaders(rawHeaders) {
  const lower = rawHeaders.map(h => String(h).toLowerCase().trim());

  const tsIdx = lower.findIndex(h => h.startsWith(COL_TIMESTAMP));
  const mbIdx = lower.findIndex(h => h.startsWith(COL_MEMBER));

  if (tsIdx === -1) throw new Error(
    'Could not find "Time in PSAP Call" column in ESO export. ' +
    `Found columns: ${rawHeaders.join(', ')}`
  );
  if (mbIdx === -1) throw new Error(
    'Could not find member name column in ESO export. ' +
    `Found columns: ${rawHeaders.join(', ')}`
  );

  return { tsCol: rawHeaders[tsIdx], mbCol: rawHeaders[mbIdx] };
}

function parseRows(rows) {
  if (!rows || rows.length === 0) return [];
  const { tsCol, mbCol } = findHeaders(Object.keys(rows[0]));

  const records = [];
  for (const row of rows) {
    const rawDate = row[tsCol];
    const rawName = row[mbCol];

    const callDate   = parseCallDate(rawDate);
    // Use the full raw timestamp string as the call key for deduplication
    const callKey    = String(rawDate || '').trim();
    const memberName = normalizeName(rawName);

    if (!callDate || !memberName) continue;
    records.push({ callDate, callKey, memberName });
  }
  return records;
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
 * Import ESO data. Returns { inserted, skipped, members, calls }
 *
 * Each member earns POINTS_PER_CALL points per unique call (callKey).
 * Re-importing the same file is safe — duplicates are skipped via UNIQUE constraint.
 */
function importEsoData(buffer, filename, batchId) {
  const ext = filename.toLowerCase().split('.').pop();
  const records = ext === 'csv' ? parseCsv(buffer) : parseExcel(buffer);

  if (records.length === 0) {
    throw new Error('No valid records found in file. Check that it is an ESO call export.');
  }

  const getOrCreateMember = db.prepare(`
    INSERT INTO members (name) VALUES (?)
    ON CONFLICT(name) DO UPDATE SET name = excluded.name
    RETURNING id
  `);

  // callKey is the raw timestamp string — uniquely identifies a call
  const insertPoint = db.prepare(`
    INSERT OR IGNORE INTO riding_points
      (member_id, call_date, call_number, call_type, points, import_batch)
    VALUES (?, ?, ?, NULL, ?, ?)
  `);

  let inserted = 0, skipped = 0;
  const membersSeen = new Set();
  const callsSeen   = new Set();

  const run = db.transaction(() => {
    for (const rec of records) {
      const row = getOrCreateMember.get(rec.memberName);
      if (!row) continue;

      membersSeen.add(rec.memberName);
      callsSeen.add(rec.callKey);

      const result = insertPoint.run(
        row.id,
        rec.callDate,
        rec.callKey,      // stored as call_number for deduplication
        POINTS_PER_CALL,
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
    records:  records.length,
    members:  membersSeen.size,
    calls:    callsSeen.size,
    pointsAwarded: inserted * POINTS_PER_CALL,
  };
}

module.exports = { importEsoData, normalizeName };
