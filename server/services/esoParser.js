/**
 * ESO (Widget) Call Record Parser
 *
 * Supports two export formats:
 *
 * FORMAT A — legacy 2-column widget export:
 *   "Time in PSAP Call","PM Complete Person Name (Last, First Middle Suffix | Employee Number)"
 *   "01/01/2025 08:45","CLEAR, JOHN"
 *   "01/01/2025 08:45","ARORA, SIDDHARTH | 481112"
 *
 * FORMAT B — new 4-column widget export:
 *   "ESO Record ID","Time in ESO Record Created Date","Crew Full Name","Crew Standard Role"
 *   "b28287f4-...","10/20/2025 11:40","Patricia Leone","Driver"
 *   "b28287f4-...","10/20/2025 11:40","JOHANNA MENA","Lead"
 *
 * Rules (both formats):
 *  - Each row = one member on one call
 *  - Each member earns POINTS_PER_CALL (2) per unique call
 *  - Format A: call key = raw timestamp string
 *  - Format B: call key = ESO Record ID (UUID — more reliable deduplication)
 *  - Member names normalized to "First Last" title case
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
 * Parse "MM/DD/YYYY HH:MM" (or just "MM/DD/YYYY") → { date: "YYYY-MM-DD", time: "HH:MM"|null }.
 * Also handles ISO dates and JS Date objects (from XLSX cellDates:true).
 *
 * The time portion drives the daytime/night split in the annual report —
 * see annualReportService.js. NULL when the source row has no time component.
 */
function parseCallDateTime(raw) {
  if (!raw) return { date: null, time: null };

  if (raw instanceof Date) {
    if (isNaN(raw)) return { date: null, time: null };
    const iso = raw.toISOString();
    // Anything imported via cellDates:true with a midnight time is a date-only
    // cell; treat as unknown time rather than invent "00:00".
    const time = (raw.getUTCHours() || raw.getUTCMinutes()) ? iso.slice(11, 16) : null;
    return { date: iso.slice(0, 10), time };
  }

  const s = String(raw).trim();

  // "MM/DD/YYYY HH:MM" or "MM/DD/YYYY HH:MM:SS"
  const mdyTime = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (mdyTime) {
    const [, m, d, y, hh, mm] = mdyTime;
    return {
      date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
      time: `${hh.padStart(2, '0')}:${mm}`,
    };
  }

  // "MM/DD/YYYY" (date only)
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return { date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, time: null };
  }

  // ISO fallback
  const dt = new Date(s);
  if (!isNaN(dt)) {
    const iso = dt.toISOString();
    const time = (dt.getUTCHours() || dt.getUTCMinutes()) ? iso.slice(11, 16) : null;
    return { date: iso.slice(0, 10), time };
  }

  return { date: null, time: null };
}

// Backwards-compatible wrapper for callers that only need the date.
function parseCallDate(raw) {
  return parseCallDateTime(raw).date;
}

// ─── Row parsing ───────────────────────────────────────────────────────────────

// Format A column identifiers (prefix match)
const COL_A_TIMESTAMP = 'time in psap call';
const COL_A_MEMBER    = 'pm complete person name';

// Format B column identifiers (exact, lowercased)
const COL_B_ID        = 'eso record id';
const COL_B_TIMESTAMP = 'time in eso record created date';
const COL_B_MEMBER    = 'crew full name';

/**
 * Detect export format and return column name mapping.
 * Returns { format: 'A'|'B', tsCol, mbCol, idCol }
 * idCol is only present for Format B.
 */
function findHeaders(rawHeaders) {
  const lower = rawHeaders.map(h => String(h).toLowerCase().trim());

  // Detect Format B first (has ESO Record ID column)
  const idIdx = lower.findIndex(h => h === COL_B_ID);
  if (idIdx !== -1) {
    const tsIdx = lower.findIndex(h => h === COL_B_TIMESTAMP);
    const mbIdx = lower.findIndex(h => h === COL_B_MEMBER);
    if (tsIdx === -1 || mbIdx === -1) throw new Error(
      'Detected new ESO format (has "ESO Record ID") but missing expected columns. ' +
      `Found: ${rawHeaders.join(', ')}`
    );
    return { format: 'B', tsCol: rawHeaders[tsIdx], mbCol: rawHeaders[mbIdx], idCol: rawHeaders[idIdx] };
  }

  // Fall back to Format A
  const tsIdx = lower.findIndex(h => h.startsWith(COL_A_TIMESTAMP));
  const mbIdx = lower.findIndex(h => h.startsWith(COL_A_MEMBER));
  if (tsIdx === -1) throw new Error(
    'Could not find "Time in PSAP Call" column in ESO export. ' +
    `Found columns: ${rawHeaders.join(', ')}`
  );
  if (mbIdx === -1) throw new Error(
    'Could not find member name column in ESO export. ' +
    `Found columns: ${rawHeaders.join(', ')}`
  );
  return { format: 'A', tsCol: rawHeaders[tsIdx], mbCol: rawHeaders[mbIdx] };
}

function parseRows(rows) {
  if (!rows || rows.length === 0) return [];
  const { format, tsCol, mbCol, idCol } = findHeaders(Object.keys(rows[0]));

  const records = [];
  for (const row of rows) {
    const rawDate = row[tsCol];
    const rawName = row[mbCol];

    const { date: callDate, time: callTime } = parseCallDateTime(rawDate);
    const memberName = normalizeName(rawName);
    if (!callDate || !memberName) continue;

    // Format B uses UUID as call key; Format A uses the raw timestamp string
    const callKey = format === 'B'
      ? String(row[idCol] || '').trim()
      : String(rawDate || '').trim();

    if (!callKey) continue;
    records.push({ callDate, callTime, callKey, memberName });
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

  // callKey is the raw timestamp string (Format A) or UUID (Format B) and
  // uniquely identifies a call. ON CONFLICT … DO UPDATE backfills call_time
  // for existing rows that were imported before the parser stored time —
  // re-importing the same CSV is now an idempotent way to populate call_time.
  const insertPoint = db.prepare(`
    INSERT INTO riding_points
      (member_id, call_date, call_time, call_number, call_type, points, import_batch)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(member_id, call_date, call_number) DO UPDATE
      SET call_time = COALESCE(riding_points.call_time, excluded.call_time)
  `);

  let inserted = 0, skipped = 0, backfilled = 0;
  const membersSeen = new Set();
  const callsSeen   = new Set();

  const run = db.transaction(() => {
    for (const rec of records) {
      const row = getOrCreateMember.get(rec.memberName);
      if (!row) continue;

      membersSeen.add(rec.memberName);
      callsSeen.add(rec.callKey);

      // Pre-check: was a row with NULL call_time present? If yes and we have
      // a time now, this counts as a backfill rather than a fresh insert.
      const existing = db.prepare(
        'SELECT call_time FROM riding_points WHERE member_id=? AND call_date=? AND call_number=?'
      ).get(row.id, rec.callDate, rec.callKey);
      const isBackfill = existing && existing.call_time == null && rec.callTime != null;

      const result = insertPoint.run(
        row.id,
        rec.callDate,
        rec.callTime || null,
        rec.callKey,
        POINTS_PER_CALL,
        batchId
      );

      if (!existing) inserted++;
      else if (isBackfill) backfilled++;
      else skipped++;
    }
  });

  run();

  return {
    inserted,
    skipped,
    backfilled,
    records:  records.length,
    members:  membersSeen.size,
    calls:    callsSeen.size,
    pointsAwarded: inserted * POINTS_PER_CALL,
  };
}

module.exports = { importEsoData, normalizeName };
