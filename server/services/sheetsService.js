/**
 * Google Sheets Service — Shift Signup Sync
 *
 * Reads shift signups from a Google Sheet that has multiple tabs (one per
 * month or crew type). Each tab should have columns for member name,
 * shift date, and optionally shift type.
 *
 * Setup:
 *  1. Create a Google Cloud project & enable the Sheets API
 *  2. Create a Service Account, download the JSON key, save as credentials.json
 *  3. Share your Google Sheet with the service account email
 *  4. Set GOOGLE_SHEET_ID in .env
 *
 * Tab/column mapping is flexible — adjust COLUMN_MAP below.
 */

const { google } = require('googleapis');
const db = require('../db/database');
const path = require('path');
const fs = require('fs');

const CREDENTIALS_PATH = path.join(__dirname, '../../credentials.json');
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Column header aliases per tab (adjust to match your sheet)
const COLUMN_MAP = {
  memberName: ['name', 'member', 'member name', 'volunteer', 'full name'],
  shiftDate:  ['date', 'shift date', 'scheduled date', 'day'],
  shiftType:  ['shift type', 'type', 'crew', 'position', 'role'],
};

function findColIndex(headers, aliases) {
  const lower = headers.map(h => String(h).toLowerCase().trim());
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseSheetDate(raw) {
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

async function getAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'Google credentials file not found. ' +
      'Download your service account JSON key and save it as credentials.json in the project root.'
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return auth.getClient();
}

/**
 * Fetch all tabs from the configured Google Sheet and sync shift signups to DB.
 * Returns { synced, tabs, errors }
 */
async function syncShiftsFromSheet() {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEET_ID is not set in .env');

  const auth = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // Get list of tabs
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tabNames = meta.data.sheets.map(s => s.properties.title);

  const getOrCreateMember = db.prepare(`
    INSERT INTO members (name) VALUES (?)
    ON CONFLICT(name) DO UPDATE SET name=name
    RETURNING id
  `);
  const insertShift = db.prepare(`
    INSERT OR IGNORE INTO shift_signups (member_id, shift_date, shift_type, shift_tab, synced_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  // Clear existing synced data before re-sync to avoid duplicates
  const clearShifts = db.prepare(`DELETE FROM shift_signups`);

  let synced = 0;
  const tabResults = [];
  const errors = [];

  // Clear and re-sync
  clearShifts.run();

  const syncAll = db.transaction(async () => {
    for (const tab of tabNames) {
      try {
        const resp = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: tab,
        });

        const rows = resp.data.values || [];
        if (rows.length < 2) continue;

        const headers = rows[0];
        const colName  = findColIndex(headers, COLUMN_MAP.memberName);
        const colDate  = findColIndex(headers, COLUMN_MAP.shiftDate);
        const colType  = findColIndex(headers, COLUMN_MAP.shiftType);

        if (colName === -1 || colDate === -1) {
          errors.push(`Tab "${tab}": could not find required columns (name, date)`);
          continue;
        }

        let tabCount = 0;
        for (const row of rows.slice(1)) {
          const name  = String(row[colName] || '').trim();
          const date  = parseSheetDate(row[colDate]);
          const stype = colType !== -1 ? String(row[colType] || '').trim() : null;
          if (!name || !date) continue;

          const member = getOrCreateMember.get(name);
          if (!member) continue;
          insertShift.run(member.id, date, stype, tab);
          tabCount++;
        }

        tabResults.push({ tab, count: tabCount });
        synced += tabCount;
      } catch (err) {
        errors.push(`Tab "${tab}": ${err.message}`);
      }
    }
  });

  await syncAll();

  return { synced, tabs: tabResults, errors };
}

/**
 * Return shift signups from DB (already synced), optionally filtered by period.
 */
function getShifts({ year, month, memberId } = {}) {
  let query = `
    SELECT ss.*, m.name AS member_name
    FROM shift_signups ss
    JOIN members m ON m.id = ss.member_id
    WHERE 1=1
  `;
  const params = [];

  if (year) {
    query += ` AND strftime('%Y', ss.shift_date) = ?`;
    params.push(String(year));
  }
  if (month) {
    query += ` AND strftime('%m', ss.shift_date) = ?`;
    params.push(String(month).padStart(2, '0'));
  }
  if (memberId) {
    query += ` AND ss.member_id = ?`;
    params.push(memberId);
  }

  return db.prepare(query).all(...params);
}

module.exports = { syncShiftsFromSheet, getShifts };
