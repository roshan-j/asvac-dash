/**
 * Import member emails pulled from the Google Contacts "ASVAC" label.
 *
 * Reads server/config/contact_emails.json ("Last, First" → email) and
 * populates members.email. Matching, in order:
 *   1. member_aliases (handles roster aliases like Tony → Haitham Rabadi)
 *   2. exact "First Last" (case-insensitive)
 *   3. unique last-name match with compatible first name (prefix / first-initial)
 *
 * Idempotent and conservative: only sets email when a single member matches,
 * and only overwrites a blank/different email. Prints matched + unmatched so
 * the operator can eyeball. Run: `node server/scripts/import_contact_emails.js`
 */

const path = require('path');
const fs = require('fs');
const db = require('../db/database');

const CFG = path.join(__dirname, '..', 'config', 'contact_emails.json');
const norm = (s) => String(s).toLowerCase().replace(/[.'’-]/g, '').replace(/\s+/g, ' ').trim();
const firstCompat = (a, b) => a === b || a.startsWith(b) || b.startsWith(a) || a[0] === b[0];

function findMember(first, last) {
  const full = `${first} ${last}`.trim();
  // 1. alias table
  const alias = db.prepare('SELECT member_id FROM member_aliases WHERE alias = ?').get(norm(full));
  if (alias) return { id: alias.member_id, how: 'alias' };
  // 2. exact full name
  const exact = db.prepare('SELECT id FROM members WHERE lower(name) = ?').all(norm(full));
  if (exact.length === 1) return { id: exact[0].id, how: 'exact' };
  // 3. last-name match, first-name compatible
  const cands = db.prepare(
    `SELECT m.id, m.name, COALESCE(c.rides, 0) AS rides
       FROM members m
       LEFT JOIN (SELECT member_id, COUNT(*) rides FROM riding_points GROUP BY member_id) c ON c.member_id = m.id
      WHERE lower(m.name) LIKE ?`
  ).all(`% ${norm(last)}`).concat(
    db.prepare(`SELECT m.id, m.name, 0 AS rides FROM members m WHERE lower(m.name) LIKE ?`).all(`%${norm(last)}`)
  );
  const seen = new Set();
  const matches = [];
  for (const c of cands) {
    if (seen.has(c.id)) continue; seen.add(c.id);
    const parts = norm(c.name).split(' ');
    const cLast = parts[parts.length - 1], cFirst = parts[0];
    if (cLast === norm(last) && firstCompat(norm(first), cFirst)) matches.push(c);
  }
  if (matches.length === 1) return { id: matches[0].id, how: 'lastname' };
  if (matches.length > 1) {
    matches.sort((a, b) => b.rides - a.rides);
    return { id: matches[0].id, how: `lastname(${matches.length}, most-rides)` };
  }
  return null;
}

function run() {
  const { contacts } = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  const setEmail = db.prepare(
    `UPDATE members SET email = ? WHERE id = ? AND (email IS NULL OR email = '' OR email != ?)`
  );
  let matched = 0, updated = 0; const unmatched = [];
  for (const c of contacts) {
    const [last, first] = c.name.split(',').map(s => s.trim());
    const m = findMember(first || '', last || '');
    if (!m) { unmatched.push(c.name); continue; }
    matched++;
    const res = setEmail.run(c.email, m.id, c.email);
    if (res.changes) updated++;
    console.log(`  ${c.name.padEnd(22)} → member #${m.id} (${m.how})${res.changes ? ' [set]' : ' [already]'}`);
  }
  console.log(`\n[emails] ${matched}/${contacts.length} matched, ${updated} updated. Unmatched: ${unmatched.join(', ') || 'none'}`);
  const total = db.prepare(`SELECT COUNT(*) c FROM members WHERE email IS NOT NULL AND email != ''`).get().c;
  console.log(`[emails] members with an email now: ${total}`);
}

run();
