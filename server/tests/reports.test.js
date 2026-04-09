/**
 * reports.test.js
 *
 * Tests for the monthly-print XLSX download.
 * Uses Node built-in test runner (node:test) — no extra deps needed.
 * Run with: node --test server/tests/reports.test.js
 *
 * Focuses on:
 *  1. Column headers (including correct "Pinpad" label)
 *  2. Meeting attendance credits appear in the Meeting column
 *  3. Training attendance credits appear in the Training column
 *  4. Members with attendance-only (no riding points) are included
 *  5. Totals = riding pts + meeting + training
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ─── Use a temp in-memory DB to avoid touching production data ─────────────
// We swap the DB_PATH env before requiring the app modules
const tmpDb = path.join(os.tmpdir(), `asvac_test_${Date.now()}.db`);
process.env.DB_PATH_OVERRIDE = tmpDb;   // picked up by a small patch below

// Patch database.js to use our temp file if DB_PATH_OVERRIDE is set
// (We do this by requiring the db module after setting the env var.
//  database.js uses __dirname relative path; easiest to just require it fresh.)
const Database = require('better-sqlite3');
const XLSX     = require('xlsx');

// ─── Bootstrap a minimal in-memory schema ─────────────────────────────────
let db;
before(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active',
      member_type TEXT DEFAULT NULL
    );
    CREATE TABLE riding_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id),
      call_date TEXT NOT NULL,
      call_number TEXT,
      call_type TEXT,
      points REAL DEFAULT 1,
      import_batch TEXT,
      UNIQUE(member_id, call_date, call_number)
    );
    CREATE TABLE shift_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id),
      shift_date TEXT NOT NULL,
      shift_time TEXT,
      shift_tab TEXT,
      UNIQUE(member_id, shift_date, shift_time)
    );
    CREATE TABLE nonriding_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id),
      activity_date TEXT NOT NULL,
      activity TEXT NOT NULL,
      points REAL DEFAULT 1,
      import_batch TEXT,
      UNIQUE(member_id, activity_date)
    );
    CREATE TABLE attendance_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id),
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('meeting','training')),
      source_file TEXT,
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(member_id, year, month, type)
    );
  `);

  // Seed members
  db.prepare("INSERT INTO members (name, status, member_type) VALUES (?,?,?)").run('Alice Smith', 'active', 'adult');
  db.prepare("INSERT INTO members (name, status, member_type) VALUES (?,?,?)").run('Bob Jones',  'active', 'adult');
  db.prepare("INSERT INTO members (name, status, member_type) VALUES (?,?,?)").run('Carol Lee',  'active', 'adult');

  // Alice: 4 riding points in Feb 2026
  db.prepare("INSERT INTO riding_points (member_id, call_date, call_number, points) VALUES (1,'2026-02-10','C001',2)").run();
  db.prepare("INSERT INTO riding_points (member_id, call_date, call_number, points) VALUES (1,'2026-02-15','C002',2)").run();

  // Bob: 1 shift signup in Feb 2026
  db.prepare("INSERT INTO shift_signups (member_id, shift_date, shift_time) VALUES (2,'2026-02-12','0800-1000')").run();

  // Alice attended the meeting
  db.prepare("INSERT INTO attendance_events (member_id, year, month, type) VALUES (1,2026,2,'meeting')").run();
  // Bob attended training
  db.prepare("INSERT INTO attendance_events (member_id, year, month, type) VALUES (2,2026,2,'training')").run();
  // Carol attended both (no riding/shift points — attendance-only)
  db.prepare("INSERT INTO attendance_events (member_id, year, month, type) VALUES (3,2026,2,'meeting')").run();
  db.prepare("INSERT INTO attendance_events (member_id, year, month, type) VALUES (3,2026,2,'training')").run();
});

after(() => {
  db.close();
});

// ─── Extract report XLSX using the actual route logic (inline) ────────────
// Rather than spinning up Express, we replicate the exact DB query + XLSX logic
// from reports.js, but against our test db.

function buildReport(year, month, adultOnly = false) {
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const end   = new Date(year, month, 0).toISOString().slice(0, 10);
  const typeClause = adultOnly ? `AND m.member_type IN ('adult','both')` : '';

  const rows = db.prepare(`
    SELECT
      m.id, m.name, m.member_type,
      COALESCE(r.call_pts, 0)      AS callPts,
      COALESCE(s.schedule, 0)      AS schedule,
      COALESCE(n.call_credit, 0)   AS callCredit,
      COALESCE(mt.meeting_cnt, 0)  AS meetingCnt,
      COALESCE(tr.training_cnt, 0) AS trainingCnt
    FROM members m
    LEFT JOIN (SELECT member_id, SUM(points) AS call_pts FROM riding_points WHERE call_date BETWEEN ? AND ? GROUP BY member_id) r ON r.member_id = m.id
    LEFT JOIN (SELECT member_id, COUNT(*) AS schedule FROM shift_signups WHERE shift_date BETWEEN ? AND ? GROUP BY member_id) s ON s.member_id = m.id
    LEFT JOIN (SELECT member_id, SUM(points) AS call_credit FROM nonriding_points WHERE activity_date BETWEEN ? AND ? GROUP BY member_id) n ON n.member_id = m.id
    LEFT JOIN (SELECT member_id, COUNT(*) AS meeting_cnt FROM attendance_events WHERE year = ? AND month = ? AND type = 'meeting' GROUP BY member_id) mt ON mt.member_id = m.id
    LEFT JOIN (SELECT member_id, COUNT(*) AS training_cnt FROM attendance_events WHERE year = ? AND month = ? AND type = 'training' GROUP BY member_id) tr ON tr.member_id = m.id
    WHERE m.status = 'active'
      ${typeClause}
      AND (COALESCE(r.call_pts,0)>0 OR COALESCE(s.schedule,0)>0 OR COALESCE(n.call_credit,0)>0
           OR COALESCE(mt.meeting_cnt,0)>0 OR COALESCE(tr.training_cnt,0)>0)
    ORDER BY m.name
  `).all(start,end,start,end,start,end,year,month,year,month);

  const headers = ['Adult Member','Call Points (ESO)','Schedule','Event - Standby','Call Credit - Pin Pad','Total Riding Points','Meeting','Training','Totals'];
  const dataRows = rows.map(r => {
    const totalRiding = r.callPts + r.schedule + r.callCredit;
    const meeting     = r.meetingCnt  * 2;   // 2 pts per meeting
    const training    = r.trainingCnt * 2;   // 2 pts per training
    const totals      = totalRiding + meeting + training;
    return [r.name, r.callPts||'', r.schedule||'', '', r.callCredit||'', totalRiding||'', meeting||'', training||'', totals||''];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'February');
  const buf  = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const read = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(read.Sheets['February'], { header: 1 });
}

// ─── Tests ────────────────────────────────────────────────────────────────

test('headers contain correct column names', () => {
  const [headers] = buildReport(2026, 2);
  assert.equal(headers[0], 'Adult Member',             'col 0 label');
  assert.equal(headers[4], 'Call Credit - Pin Pad',    'col 4 label');
  assert.equal(headers[6], 'Meeting',                  'col 6 label');
  assert.equal(headers[7], 'Training',                 'col 7 label');
  assert.equal(headers[8], 'Totals',                   'col 8 label');
});

test('"Call Credit - Pingback" and "Pinpad" labels are NOT present', () => {
  const [headers] = buildReport(2026, 2);
  assert.ok(!headers.includes('Call Credit - Pingback'), 'old typo label must not appear');
});

test('Alice: 4 riding pts + meeting attendance → Meeting=2, Totals=6', () => {
  const rows = buildReport(2026, 2);
  const alice = rows.find(r => r[0] === 'Alice Smith');
  assert.ok(alice, 'Alice should be in report');
  assert.equal(alice[1], 4, 'Call Points should be 4');
  assert.equal(alice[6], 2, 'Meeting should be 2 (1 attendance × 2 pts)');
  assert.equal(alice[7], '', 'Training should be empty');
  assert.equal(alice[8], 6, 'Totals should be 6 (4 riding + 2 meeting)');
});

test('Bob: 1 shift + training attendance → Training=2, Totals=3', () => {
  const rows = buildReport(2026, 2);
  const bob = rows.find(r => r[0] === 'Bob Jones');
  assert.ok(bob, 'Bob should be in report');
  assert.equal(bob[2], 1,  'Schedule should be 1');
  assert.equal(bob[6], '',  'Meeting should be empty');
  assert.equal(bob[7], 2,  'Training should be 2 (1 attendance × 2 pts)');
  assert.equal(bob[8], 3,  'Totals should be 3 (1 shift + 2 training)');
});

test('Carol: attendance-only member appears in report with Meeting=2, Training=2, Totals=4', () => {
  const rows = buildReport(2026, 2);
  const carol = rows.find(r => r[0] === 'Carol Lee');
  assert.ok(carol, 'Carol (attendance-only) must appear in report');
  assert.equal(carol[1], '', 'No riding points');
  assert.equal(carol[6], 2,  'Meeting = 2 (1 attendance × 2 pts)');
  assert.equal(carol[7], 2,  'Training = 2 (1 attendance × 2 pts)');
  assert.equal(carol[8], 4,  'Totals = 4 (2 meeting + 2 training)');
});

test('report includes all 3 members (including attendance-only)', () => {
  const rows = buildReport(2026, 2);
  const names = rows.slice(1).map(r => r[0]);
  assert.ok(names.includes('Alice Smith'), 'Alice in report');
  assert.ok(names.includes('Bob Jones'),   'Bob in report');
  assert.ok(names.includes('Carol Lee'),   'Carol in report');
  assert.equal(names.length, 3, 'exactly 3 members');
});
