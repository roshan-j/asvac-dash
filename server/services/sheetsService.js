/**
 * ASVAC Adult Dutyboard — Google Sheets Auto-Sync
 *
 * Reads the public ASVAC dutyboard spreadsheet directly.
 * No service account needed — only a free Google API key (for listing tabs).
 * The sheet must be set to "Anyone with the link can view".
 *
 * Sheet structure (one tab per week, named e.g. "3/15-3/21"):
 *   Row 1: Day names  (SUNDAY … SATURDAY)      — columns B–H
 *   Row 2: Dates      (3/15/2026 … 3/21/2026)  — columns B–H
 *   Then repeating groups of 4 rows per 2-hour slot:
 *     "MORNING (0600-0800)"    ← time-slot header
 *     "Driver\n50-B1/50-B2"   ← names in columns B–H
 *     "EMT\n50-B1/50-B2"
 *     "Rider/Prob. EMT\n..."
 *   …up to EVENING (2000-2200)
 *   "Events/Awareness" row    ← ignored
 *
 * Scoring: 1 point per 2-hour shift slot signed up for.
 *
 * .env keys required:
 *   GOOGLE_SHEET_ID   — the spreadsheet ID from the URL
 *   GOOGLE_API_KEY    — free API key (enable Google Sheets API in Cloud Console)
 *   SHEETS_SYNC_CRON  — cron expression, default "0 * * * *" (every hour)
 */

const https    = require('https');
const Papa     = require('papaparse');
const db       = require('../db/database');

const SHEET_ID       = process.env.GOOGLE_SHEET_ID;
const API_KEY        = process.env.GOOGLE_API_KEY;
const POINTS_PER_SHIFT = 1;

// Identifies a valid weekly schedule tab name vs PERSONNEL, Sheet39, KEY, etc.
// Matches patterns like "3/15-3/21", "06/16-6/22", "12/28-1/3"
const WEEKLY_TAB_RE  = /\d{1,2}\/\d{1,2}.*-.*\d{1,2}\/\d{1,2}/;

// Identifies a time-slot header row: "MORNING (0600-0800)", "EVENING (2000-2200) ", etc.
const SHIFT_HEADER_RE = /(MORNING|AFTERNOON|EVENING|OVERNIGHT|NIGHT)\s*\((\d{4})-(\d{4})\)/i;

// Identifies a crew role row whose names we should extract
const ROLE_ROW_RE = /^(Driver|EMT|Rider)/i;

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// ─── Name extraction ──────────────────────────────────────────────────────────

/**
 * Strip the role suffix from a cell value and return the clean name.
 *
 * "Patricia Leone, D"       → "Patricia Leone"
 * "Noah Bonnet, DEMT"       → "Noah Bonnet"
 * "Shijo Zacharias, PEMT"   → "Shijo Zacharias"
 * "Josephine Kelly, EMT (P)"→ "Josephine Kelly"
 * "Alex Wang, EMT (P)"      → "Alex Wang"
 * "Jakub Olszowski"         → "Jakub Olszowski"   (no suffix)
 *
 * Suffix pattern: comma + uppercase identifier + optional parenthetical (e.g. "(P)").
 */
function extractName(raw) {
  if (!raw) return null;
  const name = raw.trim()
    .replace(/,\s*[A-Z]+(?:\s*\([A-Z]\))?\s*$/, '')
    .trim();
  return name || null;
}

// ─── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return null;
}

// ─── List all tabs via Sheets API v4 (free API key, public sheet) ─────────────

async function listAllTabs() {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEET_ID is not set in .env');
  if (!API_KEY)  throw new Error(
    'GOOGLE_API_KEY is not set in .env.\n' +
    'Get a free key at console.cloud.google.com → APIs & Services → Credentials.\n' +
    'Enable the "Google Sheets API" and create an API Key.'
  );

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
              `?key=${API_KEY}&fields=sheets.properties(title)`;
  const { status, body } = await httpGet(url);

  if (status !== 200) {
    const msg = JSON.parse(body)?.error?.message || body.slice(0, 200);
    throw new Error(`Sheets API returned ${status}: ${msg}`);
  }

  const data = JSON.parse(body);
  return data.sheets.map(s => s.properties.title);
}

// ─── Fetch one tab as CSV via the public gviz endpoint ────────────────────────

async function fetchTabCsv(tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}` +
              `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const { status, body } = await httpGet(url);
  return status === 200 ? body : null;
}

// ─── Parse one weekly tab CSV → signup records ────────────────────────────────

function parseTabCsv(csvText, tabName) {
  const { data: rows } = Papa.parse(csvText, {
    header:          false,
    skipEmptyLines:  false,
  });

  if (rows.length < 2) return [];

  // Row index 1 holds the actual dates in columns 1–7 (B–H)
  const dateRow = rows[1];
  const colDates = {};          // colIndex → "YYYY-MM-DD"
  for (let c = 1; c <= 7; c++) {
    const d = parseDate(dateRow[c]);
    if (d) colDates[c] = d;
  }
  if (Object.keys(colDates).length === 0) return [];

  const signups = [];
  let currentShift = null;      // e.g. "0600-0800"

  for (let r = 2; r < rows.length; r++) {
    const row  = rows[r];
    const col0 = String(row[0] || '').trim();
    if (!col0) continue;

    // ── Time-slot header? ──────────────────────────────────────────────────
    const shiftMatch = col0.match(SHIFT_HEADER_RE);
    if (shiftMatch) {
      currentShift = `${shiftMatch[2]}-${shiftMatch[3]}`;  // "0600-0800"
      continue;
    }

    // ── Skip non-role rows (Events/Awareness, blank labels, etc.) ──────────
    if (!ROLE_ROW_RE.test(col0) || !currentShift) continue;

    // ── Extract member names from columns B–H ─────────────────────────────
    for (let c = 1; c <= 7; c++) {
      const cell = String(row[c] || '').trim();
      if (!cell || !colDates[c]) continue;
      const name = extractName(cell);
      if (name) {
        signups.push({
          memberName: name,
          date:       colDates[c],
          shiftTime:  currentShift,
          tabName,
        });
      }
    }
  }

  return signups;
}

// ─── Main sync ────────────────────────────────────────────────────────────────

/**
 * Sync all weekly dutyboard tabs to the database.
 *
 * For each weekly tab:
 *   1. Fetch the CSV
 *   2. Parse into (member, date, shiftTime) records
 *   3. Delete the existing records for that tab, re-insert fresh
 *      (so removed sign-ups are also reflected)
 *
 * Returns { synced, weeklyTabsFound, tabs, errors }
 */
async function syncDutyboard() {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEET_ID is not set in .env');

  const allTabs     = await listAllTabs();
  const weeklyTabs  = allTabs.filter(t => WEEKLY_TAB_RE.test(t));

  if (weeklyTabs.length === 0) throw new Error(
    'No weekly schedule tabs found. ' +
    'Expected tabs named like "3/15-3/21". Check GOOGLE_SHEET_ID in .env.'
  );

  const getOrCreateMember = db.prepare(`
    INSERT INTO members (name) VALUES (?)
    ON CONFLICT(name) DO UPDATE SET name = excluded.name
    RETURNING id
  `);

  const deleteTab = db.prepare(`
    DELETE FROM shift_signups WHERE shift_tab = ?
  `);

  const insertSignup = db.prepare(`
    INSERT OR IGNORE INTO shift_signups
      (member_id, shift_date, shift_time, shift_tab)
    VALUES (?, ?, ?, ?)
  `);

  let totalSynced = 0;
  const tabResults = [];
  const errors     = [];

  for (const tabName of weeklyTabs) {
    try {
      const csv = await fetchTabCsv(tabName);
      if (!csv) {
        errors.push(`${tabName}: could not fetch CSV`);
        continue;
      }

      const signups = parseTabCsv(csv, tabName);

      db.transaction(() => {
        deleteTab.run(tabName);
        for (const s of signups) {
          const member = getOrCreateMember.get(s.memberName);
          if (member) {
            insertSignup.run(member.id, s.date, s.shiftTime, s.tabName);
          }
        }
      })();

      tabResults.push({ tab: tabName, signups: signups.length });
      totalSynced += signups.length;

    } catch (err) {
      errors.push(`${tabName}: ${err.message}`);
    }
  }

  // Remove ghost members created by previous bad name extraction (no data anywhere)
  const cleaned = db.prepare(`
    DELETE FROM members
    WHERE id NOT IN (SELECT DISTINCT member_id FROM riding_points)
      AND id NOT IN (SELECT DISTINCT member_id FROM nonriding_points)
      AND id NOT IN (SELECT DISTINCT member_id FROM shift_signups)
  `).run();
  if (cleaned.changes > 0) {
    console.log(`[sheets] Removed ${cleaned.changes} orphan member record(s).`);
  }

  console.log(`[sheets] Synced ${totalSynced} shift signups across ${tabResults.length} tabs.`);
  return { synced: totalSynced, weeklyTabsFound: weeklyTabs.length, tabs: tabResults, errors };
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

function getShifts({ year, month, memberId } = {}) {
  let sql = `
    SELECT ss.*, m.name AS member_name
    FROM shift_signups ss
    JOIN members m ON m.id = ss.member_id
    WHERE 1=1
  `;
  const params = [];
  if (year)     { sql += ` AND strftime('%Y', ss.shift_date) = ?`;  params.push(String(year)); }
  if (month)    { sql += ` AND strftime('%m', ss.shift_date) = ?`;  params.push(String(month).padStart(2,'0')); }
  if (memberId) { sql += ` AND ss.member_id = ?`;                   params.push(memberId); }
  sql += ` ORDER BY ss.shift_date, ss.shift_time`;
  return db.prepare(sql).all(...params);
}

// Test the name extraction (called from unit tests)
module.exports = { syncDutyboard, getShifts, extractName, parseTabCsv, fetchTabCsv };
