#!/usr/bin/env node
/**
 * Merge duplicate member rows.
 *
 * Background: the dashboard's `members` table can accumulate duplicates when
 * different importers (ESO vs clock-in vs dutyboard) spell the same person's
 * name slightly differently (e.g. "Steven Greenfeld" + "Steve Greenfeld",
 * "Greg Khitrov" + "Greg Khitrov-G", "Patrick Smith" + "Patrick R Smith").
 * The result is the same human appearing twice in monthly reports.
 *
 * This script consolidates them: migrates all data references to a chosen
 * canonical id, then deletes the orphan member row. Works in two modes:
 *
 *   node merge_duplicate_members.js                     # dry-run scan
 *   node merge_duplicate_members.js --apply-strong      # auto-merge confident pairs
 *   node merge_duplicate_members.js --pairs 112850:22   # merge specific pair(s)
 *
 * Confidence rules:
 *   STRONG = same last word AND (same first word | first-name alias map)
 *            e.g. "Patrick Smith" ↔ "Patrick R Smith" (same first/last)
 *                 "Steve Greenfeld" ↔ "Steven Greenfeld" (alias)
 *                 "Greg Khitrov-G" ↔ "Greg Khitrov" (hyphen suffix)
 *   WEAK   = first names share a prefix but neither equals the other and
 *            they are not in the alias map. Likely DIFFERENT people
 *            (e.g. "Nishanth Nambiar" ≠ "Nisha Nambiar"). Listed only —
 *            never auto-merged.
 *
 * Conflict handling: where a target table has a UNIQUE constraint involving
 * member_id (e.g. nonriding_points UNIQUE(member_id, activity_date)), rows
 * on the orphan that would collide with existing rows on the canonical are
 * DELETED rather than migrated — the canonical's row wins, the orphan's
 * duplicate row is dropped.
 *
 * Idempotent: re-running after a successful merge is a no-op (the orphan id
 * no longer exists).
 *
 * Always run a backup before --apply-strong. SQLite is just a file:
 *   cp data/asvaс.db data/asvaс.db.bak-$(date +%Y%m%d-%H%M%S)
 */

const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

// ─── CLI ──────────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const APPLY_STR = args.includes('--apply-strong');
const DB_OVERRIDE = (args.find(a => a.startsWith('--db=')) || '').slice(5);
const PAIRS_ARG = (args.find(a => a.startsWith('--pairs=')) || args[args.indexOf('--pairs') + 1] || '');
const PAIRS     = (() => {
  // Support `--pairs=A:B,C:D` and `--pairs A:B,C:D`
  const idx = args.indexOf('--pairs');
  let raw = '';
  if (idx !== -1 && args[idx + 1]) raw = args[idx + 1];
  const eq = args.find(a => a.startsWith('--pairs='));
  if (eq) raw = eq.slice('--pairs='.length);
  if (!raw) return [];
  return raw.split(',').map(p => {
    const [from, to] = p.split(':').map(s => parseInt(s.trim(), 10));
    if (!from || !to) throw new Error(`Bad --pairs entry: "${p}" — expect "ORPHAN_ID:CANONICAL_ID"`);
    return { from, to };
  });
})();

const DB_PATH = DB_OVERRIDE || path.join(__dirname, '..', '..', 'data', 'asvaс.db');
if (!fs.existsSync(DB_PATH)) {
  console.error(`Database not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// ─── Name normalization (keep in sync with personnelSyncService.js) ───────────
const FIRST_NAME_ALIASES = {
  'jim':         'james',     'james':       'jim',
  'cristopher':  'christopher','christopher': 'cristopher',
  'siddarth':    'siddharth', 'siddharth':   'siddarth',
  'micheal':     'michael',   'michael':     'micheal',
  'khaushik':    'kaushik',   'kaushik':     'khaushik',
  'steve':       'steven',    'steven':      'steve',
  'alex':        'alexander', 'alexander':   'alex',
};

const stripHyphenSuffix = s => String(s).replace(/-\w+$/, '').trim();
const norm = s => stripHyphenSuffix(s).toLowerCase().replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(Boolean);
const firstWord = s => words(s)[0] || '';
const lastWord  = s => { const w = words(s); return w[w.length - 1] || ''; };

function isStrongDuplicate(a, b) {
  const la = lastWord(a.name), lb = lastWord(b.name);
  if (!la || !lb || la !== lb) return false;
  const fa = firstWord(a.name), fb = firstWord(b.name);
  if (fa === fb) return true;                                    // same first word
  if (FIRST_NAME_ALIASES[fa] === fb) return true;                // alias map
  if (norm(a.name) === norm(b.name)) return true;                // hyphen suffix only
  return false;
}

// ─── Schema introspection ─────────────────────────────────────────────────────
const tableExists = name =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

// Tables that reference members.id, with their member-related UNIQUE tuple
// (the columns OTHER than member_id, used for collision detection).
const REF_TABLES = [
  { name: 'riding_points',     uniqueCols: ['call_date', 'call_number'] },
  { name: 'nonriding_points',  uniqueCols: ['activity_date'] },
  { name: 'shift_signups',     uniqueCols: ['shift_date', 'shift_time'] },
  { name: 'attendance_events', uniqueCols: ['year', 'month', 'type'] },
  { name: 'standby_events',    uniqueCols: ['event_date', 'event_name'] },
  { name: 'officers',          uniqueCols: ['year'] },
  { name: 'email_logs',        uniqueCols: null },        // no member-related unique
  { name: 'member_aliases',    uniqueCols: null },        // alias is the unique key
  { name: 'crew_members',      uniqueCols: ['crew_number'] },
].filter(t => tableExists(t.name));

// ─── Per-member stats ─────────────────────────────────────────────────────────
function memberStats(id) {
  const stats = { id };
  for (const t of REF_TABLES) {
    stats[t.name] = db.prepare(`SELECT COUNT(*) AS c FROM ${t.name} WHERE member_id = ?`).get(id).c;
  }
  return stats;
}

function fetchMembersWithCounts() {
  const sel = ['m.id', 'm.name', 'm.member_type', 'm.email', 'm.status'];
  for (const t of REF_TABLES) {
    sel.push(`COALESCE((SELECT COUNT(*) FROM ${t.name} WHERE member_id = m.id), 0) AS ${t.name}`);
  }
  return db.prepare(`SELECT ${sel.join(', ')} FROM members m`).all();
}

function pickCanonical(a, b) {
  // Prefer the row with more riding records — that's almost always the
  // "real" member that the ESO importer has been writing to consistently.
  if ((a.riding_points || 0) !== (b.riding_points || 0)) {
    return (a.riding_points > b.riding_points) ? [a, b] : [b, a];
  }
  // Then total data
  const total = m => REF_TABLES.reduce((s, t) => s + (m[t.name] || 0), 0);
  if (total(a) !== total(b)) return total(a) > total(b) ? [a, b] : [b, a];
  // Then prefer lower id (older row, almost always the original)
  return a.id < b.id ? [a, b] : [b, a];
}

// ─── Detect duplicate groups ──────────────────────────────────────────────────
function findDuplicates(members) {
  const groupsByLast = {};
  for (const m of members) {
    const lw = lastWord(m.name);
    if (!lw || lw.length < 2) continue;
    (groupsByLast[lw] ||= []).push(m);
  }

  const strong = [];   // [{ canonical, orphan }]
  const weak   = [];   // [{ a, b, reason }]
  const seenOrphans = new Set();   // ensure each orphan only merged once

  for (const group of Object.values(groupsByLast)) {
    if (group.length < 2) continue;
    // Sort group by ride count desc — first is the most likely canonical
    const sorted = [...group].sort((a, b) =>
      (b.riding_points || 0) - (a.riding_points || 0) || a.id - b.id);

    // All-pairs within the last-name group. A group like
    // {Richard, Alexis, Richard-P, Alexis-Z} should yield two strong pairs:
    // (Richard, Richard-P) and (Alexis, Alexis-Z), not just pairs vs Richard.
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        if (isStrongDuplicate(a, b)) {
          const [canonical, orphan] = pickCanonical(a, b);
          if (!seenOrphans.has(orphan.id)) {
            strong.push({ canonical, orphan });
            seenOrphans.add(orphan.id);
          }
        } else {
          const fa = firstWord(a.name), fb = firstWord(b.name);
          // Prefix overlap on first names — could be the same person, could not
          if (fa.length >= 2 && fb.length >= 2 && fa !== fb &&
              (fa.startsWith(fb) || fb.startsWith(fa))) {
            weak.push({ a, b, reason: 'first-name prefix only — verify' });
          }
        }
      }
    }
  }

  return { strong, weak };
}

// ─── Merge logic ──────────────────────────────────────────────────────────────
function previewMerge(fromId, toId) {
  // What would happen if we merged fromId → toId? Returns counts per table.
  const out = { from: memberStats(fromId), to: memberStats(toId), conflicts: {}, migrate: {} };

  for (const t of REF_TABLES) {
    if (t.uniqueCols && t.uniqueCols.length) {
      const ucols = t.uniqueCols.join(', ');
      const conflicts = db.prepare(`
        SELECT COUNT(*) AS c FROM ${t.name} f
        WHERE f.member_id = ?
          AND EXISTS (
            SELECT 1 FROM ${t.name} t WHERE t.member_id = ?
              AND ${t.uniqueCols.map(c => `t.${c} = f.${c}`).join(' AND ')}
          )
      `).get(fromId, toId).c;
      out.conflicts[t.name] = conflicts;
      out.migrate[t.name] = (out.from[t.name] || 0) - conflicts;
    } else {
      out.conflicts[t.name] = 0;
      out.migrate[t.name] = out.from[t.name] || 0;
    }
  }
  return out;
}

function mergeMember(fromId, toId) {
  // Validate
  const fromRow = db.prepare('SELECT id, name FROM members WHERE id = ?').get(fromId);
  const toRow   = db.prepare('SELECT id, name FROM members WHERE id = ?').get(toId);
  if (!fromRow) return { skipped: true, reason: `Source id ${fromId} does not exist (already merged?)` };
  if (!toRow)   return { skipped: true, reason: `Target id ${toId} does not exist` };
  if (fromId === toId) return { skipped: true, reason: 'from == to' };

  const result = { from: fromId, to: toId, fromName: fromRow.name, toName: toRow.name,
                   conflictsDeleted: {}, migrated: {} };

  db.transaction(() => {
    for (const t of REF_TABLES) {
      if (t.uniqueCols && t.uniqueCols.length) {
        // Delete orphan rows that would conflict with canonical's rows
        const placeholders = t.uniqueCols.map(c => `t.${c} = f.${c}`).join(' AND ');
        const deleted = db.prepare(`
          DELETE FROM ${t.name}
          WHERE member_id = ?
            AND EXISTS (
              SELECT 1 FROM ${t.name} t
              WHERE t.member_id = ?
                AND ${t.uniqueCols.map(c => `t.${c} = ${t.name}.${c}`).join(' AND ')}
            )
        `).run(fromId, toId);
        result.conflictsDeleted[t.name] = deleted.changes;
      } else {
        result.conflictsDeleted[t.name] = 0;
      }

      // Migrate the rest
      const updated = db.prepare(`UPDATE ${t.name} SET member_id = ? WHERE member_id = ?`)
                        .run(toId, fromId);
      result.migrated[t.name] = updated.changes;
    }

    // Finally, delete the orphan member row
    const memberDel = db.prepare('DELETE FROM members WHERE id = ?').run(fromId);
    result.memberRowsDeleted = memberDel.changes;
  })();

  return result;
}

// ─── Reporting ────────────────────────────────────────────────────────────────
function formatRow(m) {
  const cells = REF_TABLES.map(t => `${t.name.split('_')[0]}=${String(m[t.name] || 0).padStart(3)}`);
  return `#${String(m.id).padStart(7)} ${m.name.padEnd(30)} ${cells.join(' ')}`;
}

function printPairWithPreview(label, pair) {
  const prev = previewMerge(pair.orphan.id, pair.canonical.id);
  console.log(`  ${label}`);
  console.log(`    canonical: ${formatRow(pair.canonical)}`);
  console.log(`    orphan:    ${formatRow(pair.orphan)}`);
  const conflictText = Object.entries(prev.conflicts).filter(([_, c]) => c > 0)
    .map(([t, c]) => `${t}=${c}`).join(', ');
  const migrateText = Object.entries(prev.migrate).filter(([_, c]) => c > 0)
    .map(([t, c]) => `${t}=${c}`).join(', ');
  console.log(`    will migrate: ${migrateText || '(none)'}`);
  if (conflictText) console.log(`    will delete (conflicts): ${conflictText}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`Database: ${DB_PATH}`);
console.log(`Tables found: ${REF_TABLES.map(t => t.name).join(', ')}`);
console.log('');

if (PAIRS.length > 0) {
  console.log(`Mode: applying ${PAIRS.length} explicit pair(s)\n`);
  for (const { from, to } of PAIRS) {
    console.log(`Merging ${from} → ${to}…`);
    const r = mergeMember(from, to);
    if (r.skipped) {
      console.log(`  skipped: ${r.reason}\n`);
      continue;
    }
    console.log(`  "${r.fromName}" → "${r.toName}"`);
    const migrate = Object.entries(r.migrated).filter(([_, c]) => c > 0)
      .map(([t, c]) => `${t}=${c}`).join(', ');
    const conflicts = Object.entries(r.conflictsDeleted).filter(([_, c]) => c > 0)
      .map(([t, c]) => `${t}=${c}`).join(', ');
    console.log(`  migrated: ${migrate || '(none)'}`);
    if (conflicts) console.log(`  conflicts deleted: ${conflicts}`);
    console.log(`  member row deleted: ${r.memberRowsDeleted}\n`);
  }
  process.exit(0);
}

// Default / scan mode
const members = fetchMembersWithCounts();
const { strong, weak } = findDuplicates(members);

console.log(`Total members: ${members.length}`);
console.log(`Strong duplicates: ${strong.length}    Weak / review: ${weak.length}`);
console.log('');

if (strong.length === 0 && weak.length === 0) {
  console.log('No duplicates found. Nothing to do.');
  process.exit(0);
}

if (strong.length > 0) {
  console.log('━━ STRONG duplicates (auto-mergeable) ━━');
  console.log('Picks the canonical with the most riding_points; orphan data migrates,');
  console.log('UNIQUE-constraint conflicts are deleted from the orphan side.');
  console.log('');
  strong.forEach((p, i) => printPairWithPreview(`[${i + 1}]`, p));
  console.log('');
}

if (weak.length > 0) {
  console.log('━━ WEAK matches (need human verdict — NOT auto-merged) ━━');
  console.log('Likely different people (e.g. siblings, unrelated). Use --pairs ORPHAN:CANON');
  console.log('to merge any you confirm.');
  console.log('');
  weak.forEach((w, i) => {
    console.log(`  [${i + 1}] ${w.reason}`);
    console.log(`    ${formatRow(w.a)}`);
    console.log(`    ${formatRow(w.b)}`);
  });
  console.log('');
}

if (APPLY_STR) {
  console.log('━━ APPLYING strong merges ━━');
  let okCount = 0;
  for (const pair of strong) {
    const r = mergeMember(pair.orphan.id, pair.canonical.id);
    if (r.skipped) {
      console.log(`  skipped #${pair.orphan.id}: ${r.reason}`);
      continue;
    }
    okCount++;
    const migrate = Object.entries(r.migrated).filter(([_, c]) => c > 0)
      .map(([t, c]) => `${t}=${c}`).join(', ');
    const conflicts = Object.entries(r.conflictsDeleted).filter(([_, c]) => c > 0)
      .map(([t, c]) => `${t}=${c}`).join(', ');
    console.log(`  merged #${r.from} "${r.fromName}" → #${r.to} "${r.toName}"  ${migrate ? '[' + migrate + ']' : ''}${conflicts ? ' [conflicts: ' + conflicts + ']' : ''}`);
  }
  console.log(`\n${okCount}/${strong.length} merge(s) applied.`);
} else {
  console.log('Dry run only. To apply the strong merges:');
  console.log(`  cp ${DB_PATH} ${DB_PATH}.bak-$(date +%Y%m%d-%H%M%S)`);
  console.log(`  node ${path.relative(process.cwd(), __filename)} --apply-strong`);
  console.log('');
  console.log('To merge a specific weak pair after manual review:');
  console.log(`  node ${path.relative(process.cwd(), __filename)} --pairs ORPHAN_ID:CANONICAL_ID`);
  console.log('  (e.g. --pairs 108607:3,109715:58768)');
}
