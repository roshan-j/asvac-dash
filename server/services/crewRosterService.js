/**
 * Crew Roster Service
 *
 * Seeds the crew_members table from server/config/crew_roster.json.
 * Idempotent — safe to run on every startup.
 *
 * Member matching strategy (in order):
 *   1. Exact name match in members table
 *   2. Alias lookup via member_aliases (handles known misspellings)
 *   3. Create a new member row if neither found (rare — most members are
 *      already in the DB from ESO imports)
 *
 * Roster source: ASVAC Crew List PDF, last updated 2024-01-08. Edit the JSON
 * when the corps reissues the list.
 */

const path = require('path');
const fs   = require('fs');
const db   = require('../db/database');

const ROSTER_PATH = path.join(__dirname, '..', 'config', 'crew_roster.json');

// First-name spelling variants — same source of truth as personnelSyncService.
// "Steve Greenfeld" in the roster needs to match "Steven Greenfeld" in ESO data.
const FIRST_NAME_ALIASES = {
  'jim':         'james',     'james':       'jim',
  'cristopher':  'christopher','christopher': 'cristopher',
  'siddarth':    'siddharth', 'siddharth':   'siddarth',
  'micheal':     'michael',   'michael':     'micheal',
  'khaushik':    'kaushik',   'kaushik':     'khaushik',
  'steve':       'steven',    'steven':      'steve',
};

function parseName(name) {
  const norm = String(name).toLowerCase().replace(/-\w+$/, '').trim().replace(/\s+/g, ' ');
  const parts = norm.split(' ');
  return { full: norm, first: parts[0] || '', last: parts[parts.length - 1] || '' };
}

function firstMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (FIRST_NAME_ALIASES[a] === b || FIRST_NAME_ALIASES[b] === a) return true;
  return false;
}

const insertMember    = db.prepare('INSERT INTO members (name) VALUES (?) RETURNING id');
// REPLACE (not IGNORE) so a stale alias from an earlier seed gets repointed
// at the canonical member when the matcher finds a better candidate.
const insertAlias     = db.prepare('INSERT OR REPLACE INTO member_aliases (alias, member_id) VALUES (lower(?), ?)');

/**
 * Returns the member id for a roster name, considering exact match, alias
 * table, and last-name+first-name-alias fuzzy match. When multiple candidates
 * match (e.g. "Steve Greenfeld", "Steven Greenfeld", "Steven Samuel Greenfeld"
 * all coexist), prefer the one with the most rides — the "real" member rather
 * than a typo'd duplicate created by an earlier import.
 *
 * Returns null if no candidate matches.
 */
function findExistingMemberId(rosterName) {
  const r = parseName(rosterName);
  if (!r.last) return null;

  const candidates = db.prepare(`
    SELECT m.id, m.name, COALESCE(c.rides, 0) AS rides,
           CASE WHEN lower(m.name) = lower(?) THEN 1 ELSE 0 END AS exact_match,
           CASE WHEN m.id = (SELECT member_id FROM member_aliases WHERE alias = lower(?)) THEN 1 ELSE 0 END AS alias_match
    FROM members m
    LEFT JOIN (SELECT member_id, COUNT(*) AS rides FROM riding_points GROUP BY member_id) c
      ON c.member_id = m.id
    WHERE lower(m.name) LIKE ?
       OR lower(m.name) = lower(?)
       OR m.id = (SELECT member_id FROM member_aliases WHERE alias = lower(?))
    ORDER BY rides DESC, exact_match DESC, alias_match DESC, m.id ASC
  `).all(rosterName, rosterName, `%${r.last}%`, rosterName, rosterName);

  for (const c of candidates) {
    const cn = parseName(c.name);
    if (cn.last !== r.last) continue;
    // Accept exact full match OR last-name match with first-name compatibility
    if (cn.full === r.full || firstMatches(r.first, cn.first)) {
      return c.id;
    }
  }
  return null;
}

function getOrCreateMember(rosterName) {
  const matchedId = findExistingMemberId(rosterName);
  if (matchedId) {
    insertAlias.run(rosterName, matchedId);
    return { id: matchedId };
  }
  return insertMember.get(rosterName);
}

function loadRoster() {
  if (!fs.existsSync(ROSTER_PATH)) {
    throw new Error(`Crew roster config not found at ${ROSTER_PATH}`);
  }
  return JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
}

/**
 * Seed crew_members from crew_roster.json. Returns { active, excluded }.
 */
function seedCrewRoster() {
  const roster = loadRoster();

  const wipe = db.prepare('DELETE FROM crew_members');
  const insert = db.prepare(`
    INSERT INTO crew_members (member_id, crew_number, rank, role, exclusion, sort_order, display_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id, crew_number) DO UPDATE SET
      rank         = excluded.rank,
      role         = excluded.role,
      exclusion    = excluded.exclusion,
      sort_order   = excluded.sort_order,
      display_name = excluded.display_name
  `);

  let active = 0, excluded = 0;

  db.transaction(() => {
    wipe.run();

    for (const [crewStr, members] of Object.entries(roster.crews || {})) {
      const crewNum = parseInt(crewStr, 10);
      members.forEach((m, idx) => {
        const row = getOrCreateMember(m.name);
        if (row) {
          insert.run(row.id, crewNum, m.rank || null, m.role || null, null, idx, m.name);
          active++;
        }
      });
    }

    for (const ex of roster.exclusions || []) {
      const row = getOrCreateMember(ex.name);
      if (row) {
        insert.run(row.id, ex.crew, ex.rank || null, ex.role || null, ex.type || 'leave', 999, ex.name);
        excluded++;
      }
    }
  })();

  // Cleanup runs OUTSIDE the seed transaction. After re-seeding, any member
  // rows left over from previous bad seeds (e.g. "Steve Greenfeld" created
  // before the fuzzy matcher consolidated him with "Steven Greenfeld") have
  // no remaining references — alias rows were repointed via INSERT OR REPLACE,
  // crew_members was wiped + re-seeded under the canonical id. Safe to delete.
  const cleaned = db.prepare(`
    DELETE FROM members
    WHERE id NOT IN (SELECT DISTINCT member_id FROM riding_points)
      AND id NOT IN (SELECT DISTINCT member_id FROM nonriding_points)
      AND id NOT IN (SELECT DISTINCT member_id FROM shift_signups)
      AND id NOT IN (SELECT DISTINCT member_id FROM crew_members)
      AND id NOT IN (SELECT DISTINCT member_id FROM attendance_events)
      AND id NOT IN (SELECT DISTINCT member_id FROM email_logs WHERE member_id IS NOT NULL)
      AND id NOT IN (SELECT DISTINCT member_id FROM member_aliases)
  `).run();
  const orphansRemoved = cleaned.changes;

  if (orphansRemoved > 0) {
    console.log(`[roster] Removed ${orphansRemoved} orphan member row(s).`);
  }
  console.log(`[roster] Seeded ${active} active + ${excluded} excluded crew members across 6 crews.`);
  return { active, excluded, orphansRemoved };
}

/**
 * Returns the active roster grouped by crew, in display order.
 *
 * Output: { 1: [{ id, name, rank, role }, ...], 2: [...], ... }
 */
function getActiveRosterByCrew() {
  const rows = db.prepare(`
    SELECT m.id, COALESCE(cm.display_name, m.name) AS name,
           cm.crew_number, cm.rank, cm.role, cm.sort_order
    FROM crew_members cm
    JOIN members m ON m.id = cm.member_id
    WHERE cm.exclusion IS NULL
    ORDER BY cm.crew_number, cm.sort_order, name
  `).all();

  const out = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rows) out[r.crew_number]?.push(r);
  return out;
}

/**
 * Returns excluded members (FDC + leave) for the report footer.
 */
function getExclusions() {
  return db.prepare(`
    SELECT m.id, COALESCE(cm.display_name, m.name) AS name,
           cm.crew_number, cm.exclusion
    FROM crew_members cm
    JOIN members m ON m.id = cm.member_id
    WHERE cm.exclusion IS NOT NULL
    ORDER BY cm.exclusion, cm.crew_number, name
  `).all();
}

module.exports = { seedCrewRoster, getActiveRosterByCrew, getExclusions };
