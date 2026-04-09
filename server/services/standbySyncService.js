/**
 * Standby / Event points sync
 *
 * Reads the ASVAC Adult Events Points Google Sheet (public, gviz CSV endpoint).
 * Sheet structure (one header row, then data rows):
 *   Col A: Date         e.g. "2/15/2026"
 *   Col B: Event name   e.g. "Feb Coffee Hour"
 *   Col C: Points       e.g. "1" or "2"
 *   Col D+: Members     e.g. "Erica Rosenfeld, DEMR"  (role suffix stripped)
 *
 * .env keys required:
 *   EVENTS_SHEET_ID  — spreadsheet ID
 *   EVENTS_SHEET_GID — sheet tab gid (numeric)
 */

const https  = require('https');
const Papa   = require('papaparse');
const db     = require('../db/database');

const SHEET_ID = process.env.EVENTS_SHEET_ID;
const SHEET_GID = process.env.EVENTS_SHEET_GID;

// ─── Helpers (same name-stripping logic as sheetsService) ─────────────────────

function extractName(raw) {
  if (!raw) return null;
  const name = raw.trim()
    .replace(/,\s*[A-Z]+(?:\s*\([A-Z]\))?\s*$/, '')
    .trim();
  return name || null;
}

function parseDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// ─── Main sync ────────────────────────────────────────────────────────────────

async function syncStandbyEvents() {
  if (!SHEET_ID || !SHEET_GID) {
    console.warn('[standby] EVENTS_SHEET_ID or EVENTS_SHEET_GID not set — skipping sync');
    return { synced: 0, skipped: 0, errors: [] };
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
  const { status, body } = await httpGet(url);

  if (status !== 200) {
    throw new Error(`Events sheet returned HTTP ${status}`);
  }

  const { data: rows } = Papa.parse(body, { header: false, skipEmptyLines: true });

  // Skip header row
  const dataRows = rows.slice(1);

  const lookupAlias  = db.prepare('SELECT member_id FROM member_aliases WHERE alias = lower(?)');
  const lookupExact  = db.prepare('SELECT id FROM members WHERE name = ?');
  const insertMember = db.prepare("INSERT INTO members (name, status, member_type) VALUES (?, 'active', 'adult') RETURNING id");

  function getOrCreateMember(name) {
    const aliasRow = lookupAlias.get(name);
    if (aliasRow) return aliasRow.member_id;
    const existing = lookupExact.get(name);
    if (existing) return existing.id;
    return insertMember.get(name).id;
  }

  const upsert = db.prepare(`
    INSERT INTO standby_events (member_id, event_date, event_name, points)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(member_id, event_date, event_name) DO UPDATE SET
      points    = excluded.points,
      synced_at = datetime('now')
  `);

  let synced = 0;
  let skipped = 0;
  const errors = [];

  const sync = db.transaction(() => {
    for (const row of dataRows) {
      const eventDate = parseDate(row[0]);
      const eventName = String(row[1] || '').trim();
      const points    = parseInt(row[2], 10);

      if (!eventDate || !eventName || isNaN(points)) { skipped++; continue; }

      // Members are in columns D onward (index 3+)
      for (let c = 3; c < row.length; c++) {
        const raw  = String(row[c] || '').trim();
        const name = extractName(raw);
        if (!name) continue;

        try {
          const memberId = getOrCreateMember(name);
          upsert.run(memberId, eventDate, eventName, points);
          synced++;
        } catch (err) {
          errors.push(`${eventDate} / ${eventName} / ${name}: ${err.message}`);
        }
      }
    }
  });

  sync();

  console.log(`[standby] Synced ${synced} standby event records (${skipped} rows skipped, ${errors.length} errors)`);
  return { synced, skipped, errors };
}

module.exports = { syncStandbyEvents };
