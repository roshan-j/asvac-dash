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
    SELECT COUNT(*) AS count, SUM(points) AS total
    FROM riding_points
    WHERE member_id = ? AND call_date BETWEEN ? AND ?
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
      SUM(points)                            AS totalPoints,
      COUNT(DISTINCT member_id)              AS activeMembers,
      CAST(SUM(points) AS REAL) /
        MAX(COUNT(DISTINCT member_id), 1)    AS avgPointsPerMember
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
      totalPoints:        riding.totalPoints      || 0,
      activeMembers:      riding.activeMembers    || 0,
      avgPointsPerMember: riding.avgPointsPerMember || 0,
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
      COALESCE(r.points, 0) + COALESCE(nr.points, 0) AS totalPoints,
      COALESCE(nr.clockins, 0) AS nonridingClockIns,
      COALESCE(s.signups, 0)   AS shiftSignups,
      COALESCE(mt.cnt, 0)      AS meetingAttendance,
      COALESCE(tr.cnt, 0)      AS trainingAttendance
    FROM members m
    LEFT JOIN (
      SELECT member_id, SUM(points) AS points
      FROM riding_points WHERE call_date BETWEEN ? AND ?
      GROUP BY member_id
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
};
