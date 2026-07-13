/**
 * Stats Service
 *
 * Computes all aggregated statistics used by the dashboard:
 *  - Per-member monthly/yearly riding & non-riding points
 *  - Corps-wide aggregates and averages
 *  - Trend data for charts
 *  - Member ranking relative to corps
 */

const db = require('../db/database');

// ─── Shift-response multiplier ─────────────────────────────────────────────────
//
// When a member responds to a call that falls within a shift window they signed
// up for, their call points earn a 1.5× bonus.  Requires call_time to be stored
// (populated by esoParser when re-importing existing data or on new imports).
//
// Alias assumption: the riding_points table is aliased `r` in every query below.

const SHIFT_BONUS = 1.5;

// Inline SQL expression that returns multiplied points for a single riding_points row.
const MULTIPLIED_PTS = `
  CASE
    WHEN r.call_time IS NOT NULL AND EXISTS (
      SELECT 1 FROM shift_signups ss
      WHERE ss.member_id = r.member_id
        AND ss.shift_date = r.call_date
        AND CAST(REPLACE(r.call_time, ':', '') AS INTEGER)
            >= CAST(SUBSTR(ss.shift_time, 1, 4) AS INTEGER)
        AND CAST(REPLACE(r.call_time, ':', '') AS INTEGER)
            <  CAST(SUBSTR(ss.shift_time, 6, 4) AS INTEGER)
    ) THEN r.points * ${SHIFT_BONUS}
    ELSE r.points
  END`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthRange(year, month) {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const start = `${y}-${m}-01`;
  const end   = new Date(year, month, 0).toISOString().split('T')[0]; // last day
  return { start, end };
}

// ─── Member list ──────────────────────────────────────────────────────────────

function getAllMembers() {
  return db.prepare(`SELECT * FROM members WHERE status = 'active' ORDER BY name`).all();
}

function getMemberById(id) {
  return db.prepare(`SELECT * FROM members WHERE id = ?`).get(id);
}

// ─── Per-member monthly stats ─────────────────────────────────────────────────

function getMemberMonthStats(memberId, year, month) {
  const { start, end } = monthRange(year, month);

  const riding = db.prepare(`
    SELECT COUNT(*) AS count, SUM(${MULTIPLIED_PTS}) AS total
    FROM riding_points r
    WHERE r.member_id = ? AND r.call_date BETWEEN ? AND ?
  `).get(memberId, start, end);

  const nonriding = db.prepare(`
    SELECT COUNT(*) AS count, SUM(points) AS total
    FROM nonriding_points
    WHERE member_id = ? AND activity_date BETWEEN ? AND ?
  `).get(memberId, start, end);

  const shifts = db.prepare(`
    SELECT COUNT(*) AS count
    FROM shift_signups
    WHERE member_id = ? AND shift_date BETWEEN ? AND ?
  `).get(memberId, start, end);

  return {
    memberId,
    year,
    month,
    ridingCalls:    riding.count   || 0,
    ridingPoints:   riding.total   || 0,
    nonridingCount: nonriding.count || 0,
    nonridingPoints:nonriding.total || 0,
    shiftSignups:   shifts.count   || 0,
    totalPoints:    (riding.total || 0) + (nonriding.total || 0),
  };
}

// ─── Per-member trend (last N months) ─────────────────────────────────────────

function getMemberTrend(memberId, months = 12) {
  const result = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(getMemberMonthStats(memberId, d.getFullYear(), d.getMonth() + 1));
  }

  return result;
}

// ─── Corps-wide monthly aggregate ─────────────────────────────────────────────

function getCorpsMonthStats(year, month) {
  const { start, end } = monthRange(year, month);

  const riding = db.prepare(`
    SELECT
      COUNT(*)                               AS totalCalls,
      COUNT(DISTINCT call_number)            AS uniqueCalls,
      SUM(points)                            AS totalPoints,
      COUNT(DISTINCT member_id)              AS activeMembers,
      CAST(SUM(points) AS REAL) /
        MAX(COUNT(DISTINCT member_id), 1)    AS avgPointsPerMember,
      CAST(COUNT(*) AS REAL) /
        MAX(COUNT(DISTINCT call_number), 1)  AS avgCrewPerCall
    FROM riding_points
    WHERE call_date BETWEEN ? AND ?
  `).get(start, end);

  const nonriding = db.prepare(`
    SELECT
      SUM(points)                            AS totalPoints,
      COUNT(DISTINCT member_id)              AS activeMembers
    FROM nonriding_points
    WHERE activity_date BETWEEN ? AND ?
  `).get(start, end);

  const shifts = db.prepare(`
    SELECT COUNT(*) AS total, COUNT(DISTINCT member_id) AS activeMembers
    FROM shift_signups
    WHERE shift_date BETWEEN ? AND ?
  `).get(start, end);

  const totalMembers = db.prepare(`SELECT COUNT(*) AS n FROM members WHERE status = 'active'`).get().n;

  return {
    year,
    month,
    totalMembers,
    riding: {
      totalCalls:         riding.totalCalls      || 0,
      uniqueCalls:        riding.uniqueCalls     || 0,
      totalPoints:        riding.totalPoints      || 0,
      activeMembers:      riding.activeMembers    || 0,
      avgPointsPerMember: riding.avgPointsPerMember || 0,
      avgCrewPerCall:     riding.avgCrewPerCall   || 0,
    },
    nonriding: {
      totalPoints:   nonriding.totalPoints   || 0,
      activeMembers: nonriding.activeMembers || 0,
    },
    shifts: {
      total:         shifts.total         || 0,
      activeMembers: shifts.activeMembers || 0,
    },
    combinedAvgPerMember: totalMembers
      ? ((riding.totalPoints || 0) + (nonriding.totalPoints || 0)) / totalMembers
      : 0,
  };
}

// ─── Corps trend (last N months) ──────────────────────────────────────────────

function getCorpsTrend(months = 12) {
  const result = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(getCorpsMonthStats(d.getFullYear(), d.getMonth() + 1));
  }

  return result;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function getLeaderboard(year, month) {
  const { start, end } = monthRange(year, month);

  const rows = db.prepare(`
    SELECT
      m.id,
      m.name,
      COALESCE(r.points, 0)    AS ridingPoints,
      COALESCE(nr.points, 0)   AS nonridingPoints,
      COALESCE(r.points, 0) + COALESCE(nr.points, 0)
        + COALESCE(mt.cnt, 0) * 2
        + COALESCE(tr.cnt, 0) * 2 AS totalPoints,
      COALESCE(nr.clockins, 0) AS nonridingClockIns,
      COALESCE(s.signups, 0)   AS shiftSignups,
      COALESCE(mt.cnt, 0)      AS meetingAttendance,
      COALESCE(tr.cnt, 0)      AS trainingAttendance
    FROM members m
    LEFT JOIN (
      SELECT r.member_id, SUM(${MULTIPLIED_PTS}) AS points
      FROM riding_points r WHERE r.call_date BETWEEN ? AND ?
      GROUP BY r.member_id
    ) r ON r.member_id = m.id
    LEFT JOIN (
      SELECT member_id, SUM(points) AS points, COUNT(*) AS clockins
      FROM nonriding_points WHERE activity_date BETWEEN ? AND ?
      GROUP BY member_id
    ) nr ON nr.member_id = m.id
    LEFT JOIN (
      SELECT member_id, COUNT(*) AS signups
      FROM shift_signups WHERE shift_date BETWEEN ? AND ?
      GROUP BY member_id
    ) s ON s.member_id = m.id
    LEFT JOIN (
      SELECT member_id, COUNT(*) AS cnt
      FROM attendance_events WHERE year = ? AND month = ? AND type = 'meeting'
      GROUP BY member_id
    ) mt ON mt.member_id = m.id
    LEFT JOIN (
      SELECT member_id, COUNT(*) AS cnt
      FROM attendance_events WHERE year = ? AND month = ? AND type = 'training'
      GROUP BY member_id
    ) tr ON tr.member_id = m.id
    WHERE m.status = 'active'
      AND (COALESCE(r.points, 0) > 0
        OR COALESCE(nr.points, 0) > 0
        OR COALESCE(s.signups, 0) > 0
        OR COALESCE(mt.cnt, 0) > 0
        OR COALESCE(tr.cnt, 0) > 0)
    ORDER BY totalPoints DESC
  `).all(start, end, start, end, start, end, year, month, year, month);

  return rows.map((row, idx) => ({ rank: idx + 1, ...row }));
}

// ─── Member full summary (for email) ──────────────────────────────────────────

function getMemberSummary(memberId, year, month) {
  const member = getMemberById(memberId);
  const memberStats = getMemberMonthStats(memberId, year, month);
  const corpsStats  = getCorpsMonthStats(year, month);
  const trend       = getMemberTrend(memberId, 12);
  const leaderboard = getLeaderboard(year, month);
  const rank        = leaderboard.find(r => r.id === memberId);

  return {
    member,
    period: { year, month },
    stats: memberStats,
    corpsAvg: {
      ridingPoints:    corpsStats.riding.avgPointsPerMember,
      combinedPoints:  corpsStats.combinedAvgPerMember,
    },
    rank: rank ? { position: rank.rank, outOf: leaderboard.length } : null,
    trend,
  };
}

// ─── Available periods ─────────────────────────────────────────────────────────

function getAvailablePeriods() {
  const riding = db.prepare(`
    SELECT DISTINCT strftime('%Y', call_date) AS year, strftime('%m', call_date) AS month
    FROM riding_points ORDER BY year DESC, month DESC
  `).all();

  const nonriding = db.prepare(`
    SELECT DISTINCT strftime('%Y', activity_date) AS year, strftime('%m', activity_date) AS month
    FROM nonriding_points ORDER BY year DESC, month DESC
  `).all();

  const combined = [...riding, ...nonriding];
  const seen = new Set();
  return combined
    .filter(p => {
      const key = `${p.year}-${p.month}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${b.year}-${b.month}`.localeCompare(`${a.year}-${a.month}`));
}

// ─── Night calls (10pm–6am) ─────────────────────────────────────────────────────
//
// A "night call" is an ESO call whose call_time falls in [22:00, 24:00) or
// [00:00, 06:00). call_time is stored zero-padded "HH:MM" (esoParser pads to 2
// digits), so the lexicographic comparisons below are correct.
//
// Calls are bucketed by their own call_date calendar day — a 2am call shows on
// that date, not folded into the prior evening. Returns one entry for EVERY day
// of the month so the calendar grid can render days with no night calls.
const NIGHT_WINDOW_START = '22:00';  // 10pm — inclusive lower bound
const NIGHT_WINDOW_END   = '06:00';  // 6am  — exclusive upper bound

function getNightCallsForMonth(year, month) {
  const { start, end } = monthRange(year, month);
  const daysInMonth = new Date(year, month, 0).getDate();
  const ym = start.slice(0, 7);  // "YYYY-MM"

  const rows = db.prepare(`
    SELECT r.call_date AS callDate, r.call_number AS callNumber,
           r.call_time AS callTime, m.name AS name
    FROM riding_points r
    JOIN members m ON m.id = r.member_id
    WHERE r.call_date >= ? AND r.call_date <= ?
      AND r.call_time IS NOT NULL
      AND (r.call_time >= ? OR r.call_time < ?)
    ORDER BY r.call_date, r.call_time, m.name
  `).all(start, end, NIGHT_WINDOW_START, NIGHT_WINDOW_END);

  // Group: date → callNumber → { callTime, riders[] }
  const byDate = new Map();        // 'YYYY-MM-DD' → Map(callNumber → call)
  const riderNightCalls = new Map(); // name → Set(callNumber)

  for (const row of rows) {
    if (!byDate.has(row.callDate)) byDate.set(row.callDate, new Map());
    const calls = byDate.get(row.callDate);
    if (!calls.has(row.callNumber)) {
      calls.set(row.callNumber, { callNumber: row.callNumber, callTime: row.callTime, riders: [] });
    }
    const call = calls.get(row.callNumber);
    if (!call.riders.includes(row.name)) call.riders.push(row.name);

    if (!riderNightCalls.has(row.name)) riderNightCalls.set(row.name, new Set());
    riderNightCalls.get(row.name).add(row.callNumber);
  }

  // Build one entry per calendar day
  const days = [];
  let totalNightCalls = 0;
  let totalPersonRides = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const callsMap = byDate.get(date);
    const calls = callsMap ? Array.from(callsMap.values()) : [];
    totalNightCalls += calls.length;
    for (const c of calls) totalPersonRides += c.riders.length;
    days.push({ day: d, date, nightCallCount: calls.length, calls });
  }

  const topRiders = Array.from(riderNightCalls.entries())
    .map(([name, set]) => ({ name, nightCalls: set.size }))
    .sort((a, b) => b.nightCalls - a.nightCalls || a.name.localeCompare(b.name))
    .slice(0, 5);

  return { year, month, daysInMonth, totalNightCalls, totalPersonRides, days, topRiders };
}

module.exports = {
  getAllMembers,
  getMemberById,
  getMemberMonthStats,
  getMemberTrend,
  getCorpsMonthStats,
  getCorpsTrend,
  getLeaderboard,
  getMemberSummary,
  getAvailablePeriods,
  getNightCallsForMonth,
};
