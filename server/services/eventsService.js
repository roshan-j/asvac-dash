/**
 * Special Events / Awareness Credit Sync
 *
 * Reads the ASVAC Adult Events Points spreadsheet and stores per-member
 * event credit in the `event_credits` table.
 *
 * Sheet structure (every tab is a separate log; we scan all tabs):
 *   Row 1: title (e.g. "EVENTS POINTS LOG")          ← skipped
 *   Row 2: blank                                      ← skipped
 *   Row 3: header "Date,Event,Points Awarded,Members Involved (->)..."
 *   Row 4+: M/D/YYYY, "Event name", N, "Member, ROLE", "Member, ROLE", ...
 *
 * Each row awards N points to each named member, counted toward the month
 * containing the row's date.
 */

const https = require('https');
const Papa  = require('papaparse');
const db    = require('../db/database');

const SHEET_ID = process.env.GOOGLE_EVENTS_SHEET_ID;
const API_KEY  = process.env.GOOGLE_API_KEY;

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpGetOnce(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function httpGet(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await httpGetOnce(url);
      if (r.status >= 500 && i < attempts - 1) {
        await new Promise(res => setTimeout(res, 500 * (i + 1)));
        continue;
      }
      return r;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(res => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw lastErr || new Error('httpGet failed after retries');
}

// ─── Name cleanup: strip the ", DEMR" / ", PEMT (P)" certification suffix ─────

function extractName(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim()
    .replace(/,\s*[A-Z]+(?:\s*\([A-Z]\))?\s*$/, '')
    .trim();
  return cleaned || null;
}

function parseDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// ─── List all tabs via Sheets API v4 ──────────────────────────────────────────

async function listAllTabs() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
              `?key=${API_KEY}&fields=sheets.properties(title)`;
  const { status, body } = await httpGet(url);
  if (status !== 200) {
    const msg = (() => { try { return JSON.parse(body).error.message; } catch { return body.slice(0, 200); } })();
    throw new Error(`Sheets API returned ${status}: ${msg}`);
  }
  return JSON.parse(body).sheets.map(s => s.properties.title);
}

async function fetchTabCsv(tabName) {
  // Use Sheets API v4 values.get (not docs.google.com gviz, which some networks block).
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
              `/values/${encodeURIComponent(tabName)}?key=${API_KEY}`;
  const { status, body } = await httpGet(url);
  if (status !== 200) {
    let detail = body.slice(0, 200);
    try { detail = JSON.parse(body).error.message; } catch (_) {}
    throw new Error(`HTTP ${status}: ${detail}`);
  }
  let values;
  try { values = JSON.parse(body).values || []; } catch { return null; }
  return Papa.unparse(values);
}

// ─── Parse one tab CSV → per-member credit records ────────────────────────────

function parseEventsCsv(csvText, tabName) {
  const { data: rows } = Papa.parse(csvText, { header: false, skipEmptyLines: false });

  // Find the header row: first row whose first cell is exactly "Date".
  // Everything before it (title, blanks) is preamble.
  const headerIdx = rows.findIndex(r => String(r[0] || '').trim().toLowerCase() === 'date');
  if (headerIdx === -1) return [];

  const credits = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDate(row[0]);
    if (!date) continue;

    const eventName = String(row[1] || '').trim();
    const points    = parseFloat(row[2]);
    if (!eventName || !Number.isFinite(points) || points <= 0) continue;

    // Columns 3+ are member-name cells (variable count).
    for (let c = 3; c < row.length; c++) {
      const name = extractName(row[c]);
      if (name) credits.push({ memberName: name, date, eventName, points, tabName });
    }
  }
  return credits;
}

// ─── Main sync ────────────────────────────────────────────────────────────────

async function syncEventCredits() {
  if (!SHEET_ID || !API_KEY) {
    console.warn('[events] GOOGLE_EVENTS_SHEET_ID or GOOGLE_API_KEY not set — skipping event sync');
    return { synced: 0, tabs: [], errors: [] };
  }

  const allTabs = await listAllTabs();

  const lookupAlias  = db.prepare('SELECT member_id FROM member_aliases WHERE alias = lower(?)');
  const lookupExact  = db.prepare('SELECT id FROM members WHERE name = ?');
  const insertMember = db.prepare('INSERT INTO members (name) VALUES (?) RETURNING id');

  function getOrCreateMember(name) {
    const alias = lookupAlias.get(name);
    if (alias) return { id: alias.member_id };
    const existing = lookupExact.get(name);
    if (existing) return existing;
    return insertMember.get(name);
  }

  // Clear & rewrite per tab so removed/edited rows propagate.
  const deleteTab = db.prepare('DELETE FROM event_credits WHERE source_tab = ?');
  const insertOne = db.prepare(`
    INSERT OR REPLACE INTO event_credits
      (member_id, event_date, event_name, points, source_tab)
    VALUES (?, ?, ?, ?, ?)
  `);

  let totalSynced = 0;
  const tabResults = [];
  const errors     = [];

  for (const tabName of allTabs) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const csv = await fetchTabCsv(tabName);
      if (!csv) continue; // unparseable response; skip
      const credits = parseEventsCsv(csv, tabName);
      if (credits.length === 0) continue;

      db.transaction(() => {
        deleteTab.run(tabName);
        for (const c of credits) {
          const m = getOrCreateMember(c.memberName);
          if (m) insertOne.run(m.id, c.date, c.eventName, c.points, c.tabName);
        }
      })();

      totalSynced += credits.length;
      tabResults.push({ tab: tabName, credits: credits.length });
    } catch (err) {
      errors.push(`${tabName}: ${err.message}`);
    }
  }

  console.log(`[events] Synced ${totalSynced} event credits across ${tabResults.length} tab(s).`);
  return { synced: totalSynced, tabs: tabResults, errors };
}

module.exports = { syncEventCredits, parseEventsCsv, extractName };
