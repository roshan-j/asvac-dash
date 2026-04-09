/**
 * Officer seed service
 *
 * Ensures the seven 2026 officers exist as active members and have
 * officer credit records (2 pts/month) for 2026. Idempotent — safe to
 * run on every startup.
 */

const db = require('../db/database');

// Officers for 2026. Members not yet in the DB will be inserted.
// points_per_month defaults to 2 if omitted
const OFFICERS_2026 = [
  { name: 'Nisha Nambiar',    points_per_month: 4 },   // id=54
  { name: 'Tony Rabadi',      points_per_month: 4 },   // id=6,   alias: Tony Sari
  { name: 'Melissa Jhunja'   },   // id=7,   already exists
  { name: 'Craig Ascher'     },   // id=13,  already exists
  { name: 'Roy Haddad'       },   // new
  { name: 'Frank Doherty'    },   // new
  { name: 'Morry Silbiger'   },   // new
  { name: 'Manoj Nambiar'    },   // id=32,  already exists
  { name: 'Steven Greenfeld' },   // id=22,  already exists
];

const YEAR = 2026;

function seedOfficers() {
  const insertMember = db.prepare(`
    INSERT INTO members (name, status, member_type)
    VALUES (?, 'active', 'adult')
    ON CONFLICT(name) DO NOTHING
  `);

  const upsertOfficer = db.prepare(`
    INSERT INTO officers (member_id, year, points_per_month)
    SELECT id, ?, ? FROM members WHERE name = ?
    ON CONFLICT(member_id, year) DO UPDATE SET points_per_month = excluded.points_per_month
  `);

  const seed = db.transaction(() => {
    for (const { name, points_per_month = 2 } of OFFICERS_2026) {
      insertMember.run(name);
      upsertOfficer.run(YEAR, points_per_month, name);
    }
  });

  seed();

  const count = db.prepare('SELECT COUNT(*) AS n FROM officers WHERE year = ?').get(YEAR).n;
  console.log(`[officers] ${count} officer records seeded for ${YEAR}`);
}

/**
 * February 2026 one-off: all active adult members receive 2 training points
 * for CPR recertification. Uses attendance_events so the existing
 * trainingCnt * 2 logic in reports handles the credit automatically.
 */
function seedFeb2026CprCredit() {
  const inserted = db.prepare(`
    INSERT OR IGNORE INTO attendance_events (member_id, year, month, type, source_file)
    SELECT id, 2026, 2, 'training', 'CPR-recertification-2026'
    FROM members
    WHERE status = 'active'
      AND member_type IN ('adult', 'both')
  `).run();

  console.log(`[officers] Feb 2026 CPR credit: ${inserted.changes} attendance records added`);
}

function seedAll() {
  seedOfficers();
  seedFeb2026CprCredit();
}

module.exports = { seedOfficers, seedAll };
