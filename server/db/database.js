const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/asvaс.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    email       TEXT,
    status      TEXT    DEFAULT 'active',   -- active | inactive
    joined_date TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS riding_points (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    call_date   TEXT    NOT NULL,   -- ISO date YYYY-MM-DD
    call_number TEXT,
    call_type   TEXT,
    points      REAL    DEFAULT 1,
    import_batch TEXT,              -- tracks which upload this came from
    created_at  TEXT    DEFAULT (datetime('now')),
    UNIQUE(member_id, call_date, call_number)
  );

  CREATE TABLE IF NOT EXISTS nonriding_points (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    activity_date TEXT  NOT NULL,
    activity    TEXT    NOT NULL,
    points      REAL    DEFAULT 1,
    import_batch TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shift_signups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    shift_date  TEXT    NOT NULL,
    shift_type  TEXT,
    shift_tab   TEXT,               -- which Google Sheet tab it came from
    status      TEXT    DEFAULT 'signed_up',
    synced_at   TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER REFERENCES members(id),
    period      TEXT    NOT NULL,   -- e.g. "2025-02"
    sent_at     TEXT    DEFAULT (datetime('now')),
    success     INTEGER DEFAULT 1,
    error_msg   TEXT
  );
`);

module.exports = db;
