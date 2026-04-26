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
    created_at  TEXT    DEFAULT (datetime('now')),
    member_type TEXT                         -- adult | college | both | NULL
  );

  CREATE TABLE IF NOT EXISTS riding_points (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    call_date   TEXT    NOT NULL,   -- ISO date YYYY-MM-DD
    call_time   TEXT,               -- "HH:MM" 24h, NULL when source has no time (back-fillable)
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
    created_at  TEXT    DEFAULT (datetime('now')),
    UNIQUE(member_id, activity_date)   -- one credit per person per day, safe to re-import
  );

  CREATE TABLE IF NOT EXISTS shift_signups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    shift_date  TEXT    NOT NULL,
    shift_time  TEXT,               -- "0600-0800", "0800-1000", etc.
    shift_tab   TEXT,               -- Google Sheet tab name e.g. "3/15-3/21"
    synced_at   TEXT    DEFAULT (datetime('now')),
    UNIQUE(member_id, shift_date, shift_time)   -- safe to re-sync
  );

  -- Maps alternate / misspelled / old names → canonical member ID.
  -- Checked by sheetsService before creating new members, preventing ghost re-creation.
  CREATE TABLE IF NOT EXISTS member_aliases (
    alias     TEXT    NOT NULL UNIQUE,   -- lowercased alternate name
    member_id INTEGER NOT NULL REFERENCES members(id)
  );

  -- Tracks meeting / training attendance per member per month.
  -- One entry per person per month per type; idempotent on re-upload.
  CREATE TABLE IF NOT EXISTS attendance_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id),
    year        INTEGER NOT NULL,
    month       INTEGER NOT NULL,
    type        TEXT    NOT NULL CHECK(type IN ('meeting','training')),
    source_file TEXT,
    imported_at TEXT    DEFAULT (datetime('now')),
    UNIQUE(member_id, year, month, type)
  );

  CREATE TABLE IF NOT EXISTS email_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER REFERENCES members(id),
    period      TEXT    NOT NULL,   -- e.g. "2025-02"
    sent_at     TEXT    DEFAULT (datetime('now')),
    success     INTEGER DEFAULT 1,
    error_msg   TEXT
  );

  -- ─── Night-crew tables (annual night-shift hours report) ───────────────────
  -- One row per night that a crew is on call. Sourced from the public ICS feed
  -- of tony@cprtony.com via nightShiftService. The night STARTS at 22:00 of
  -- the date stored here and ends at 06:00 the next day.
  CREATE TABLE IF NOT EXISTS crew_nights (
    date         TEXT    PRIMARY KEY,    -- YYYY-MM-DD (date the night begins)
    crew_number  INTEGER NOT NULL,       -- 1-6
    source       TEXT    DEFAULT 'ics',
    synced_at    TEXT    DEFAULT (datetime('now'))
  );

  -- Mapping of corps members to their night crews. Seeded from
  -- server/config/crew_roster.json by crewRosterService.
  -- exclusion: NULL = active, 'FDC' = full day crew, 'TMP' = temporary,
  -- 'leave' = medical / personal leave. Excluded members are still stored so
  -- they can be listed in the report footer.
  CREATE TABLE IF NOT EXISTS crew_members (
    member_id    INTEGER NOT NULL REFERENCES members(id),
    crew_number  INTEGER NOT NULL,
    rank         TEXT,
    role         TEXT,
    exclusion    TEXT,
    sort_order   INTEGER DEFAULT 0,
    display_name TEXT,                  -- name as it appears in crew_roster.json
    PRIMARY KEY (member_id, crew_number)
  );
`);

// Idempotent: add display_name to crew_members if a previous schema lacked it.
const crewCols = db.prepare('PRAGMA table_info(crew_members)').all();
if (!crewCols.find(c => c.name === 'display_name')) {
  db.exec("ALTER TABLE crew_members ADD COLUMN display_name TEXT");
}

// Idempotent: add call_time to riding_points if missing.
const rpCols = db.prepare('PRAGMA table_info(riding_points)').all();
if (!rpCols.find(c => c.name === 'call_time')) {
  db.exec("ALTER TABLE riding_points ADD COLUMN call_time TEXT");
}

// ─── One-off migration: add member_type column to existing DBs ────────────────
// Older DBs were created before member_type was part of the schema; the
// personnelSyncService relies on it. Idempotent — only runs if missing.
const memberCols = db.prepare('PRAGMA table_info(members)').all();
if (!memberCols.find(c => c.name === 'member_type')) {
  db.exec("ALTER TABLE members ADD COLUMN member_type TEXT");
}

module.exports = db;
