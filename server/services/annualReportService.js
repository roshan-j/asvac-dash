/**
 * Annual Night-Crew Hours Report
 *
 * Builds the data structure that powers the per-year XLSX export. Mirrors the
 * structure of the original PDF report:
 *
 *   1. Calendar coverage   — nights and crew-hours per crew, % of year
 *   2. Hours by member     — monthly grid + Nights + Daytime hrs + Total hrs,
 *                            grouped by crew
 *   3. Exclusions footer   — FDC and leave members
 *
 * Hours math:
 *   - Each on-call night = 8 hrs (10 PM → 6 AM the next morning)
 *   - The night is credited to the date it STARTED (Dec 31 night → December)
 *   - Each daytime ride (start time in [06:00, 22:00)) earns 2 hrs of credit;
 *     these are summed annually only, not split by month, per the original ask
 *   - Total hrs = (sum of monthly night hours) + (annual daytime hours)
 *
 * Daytime ride detection: prefers riding_points.call_time (HH:MM, populated
 * by the parser since the call_time fix) and falls back to extracting the
 * time portion from call_number for older Format-A rows that haven't been
 * re-imported. Rides with no time anywhere (Format-B UUID rows that predate
 * the fix and haven't been re-imported) are excluded from the daytime count
 * and reported in the meta block.
 */

const db = require('../db/database');
const { getActiveRosterByCrew, getExclusions } = require('./crewRosterService');
const { getNightsByCrewForYear }                = require('./nightShiftService');

const HOURS_PER_NIGHT = 8;
const HOURS_PER_DAYTIME_RIDE = 2;

/**
 * Build the report payload for a given year.
 *
 * Returns:
 * {
 *   year,
 *   meta: { generatedAt, totalNights, daytimeRideRowsParsed, daytimeRideRowsUnparsed },
 *   coverage: [{ crew, nights, hours, pctOfYear }, ..., { crew: 'Total', ... }],
 *   crews:    [{ number, nights, hours, members: [{ name, rank, role,
 *                  monthly: [Jan..Dec], nights, daytimeHrs, totalHrs }] }],
 *   exclusions: { fdc: [...], leave: [...] }
 * }
 */
function buildAnnualReport(year) {
  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInYear = isLeap ? 366 : 365;

  // ─── Coverage: nights per crew ────────────────────────────────────────────
  const coverageRows = db.prepare(`
    SELECT crew_number, COUNT(*) AS nights
    FROM crew_nights
    WHERE date BETWEEN ? AND ?
    GROUP BY crew_number
    ORDER BY crew_number
  `).all(yearStart, yearEnd);

  const coverage = [1, 2, 3, 4, 5, 6].map(c => {
    const row = coverageRows.find(r => r.crew_number === c);
    const nights = row ? row.nights : 0;
    return {
      crew:      `Crew ${c}`,
      nights,
      hours:     nights * HOURS_PER_NIGHT,
      pctOfYear: nights / daysInYear,
    };
  });
  const totalNights = coverage.reduce((s, r) => s + r.nights, 0);
  coverage.push({
    crew:      'Total',
    nights:    totalNights,
    hours:     totalNights * HOURS_PER_NIGHT,
    pctOfYear: totalNights / daysInYear,
  });

  // ─── Per-crew nights, broken down by month ────────────────────────────────
  // For each crew: an array of 12 ints — count of nights in that month.
  const monthlyByCrew = {};
  for (const c of [1, 2, 3, 4, 5, 6]) monthlyByCrew[c] = new Array(12).fill(0);

  const allNights = db.prepare(`
    SELECT date, crew_number FROM crew_nights
    WHERE date BETWEEN ? AND ?
  `).all(yearStart, yearEnd);

  for (const n of allNights) {
    const monthIdx = parseInt(n.date.slice(5, 7), 10) - 1;
    if (monthlyByCrew[n.crew_number]) {
      monthlyByCrew[n.crew_number][monthIdx]++;
    }
  }

  // ─── Daytime rides per member for the year ────────────────────────────────
  // Prefer call_time when populated (the canonical column), fall back to
  // pulling HH:MM out of call_number for legacy Format-A rows that have not
  // had their call_time backfilled. effective_time is NULL for Format-B
  // legacy rows that lack any time data; those are excluded from the count.
  const dayRows = db.prepare(`
    WITH rp_with_time AS (
      SELECT
        member_id,
        COALESCE(
          call_time,
          CASE WHEN length(call_number) = 16 AND substr(call_number, 14, 1) = ':'
               THEN substr(call_number, 12, 5) END
        ) AS effective_time
      FROM riding_points
      WHERE call_date BETWEEN ? AND ?
    )
    SELECT
      member_id,
      SUM(CASE
        WHEN effective_time IS NOT NULL
         AND effective_time >= '06:00'
         AND effective_time <  '22:00'
        THEN 1 ELSE 0
      END) AS daytime_rides,
      SUM(CASE WHEN effective_time IS NOT NULL THEN 1 ELSE 0 END) AS parsed_rides,
      COUNT(*) AS total_rides
    FROM rp_with_time
    GROUP BY member_id
  `).all(yearStart, yearEnd);

  const daytimeByMemberId = new Map();
  let parsedCount = 0, totalCount = 0;
  for (const r of dayRows) {
    daytimeByMemberId.set(r.member_id, r.daytime_rides);
    parsedCount += r.parsed_rides;
    totalCount  += r.total_rides;
  }

  // ─── Compose per-crew member rows ────────────────────────────────────────
  const roster = getActiveRosterByCrew();
  const crews = [1, 2, 3, 4, 5, 6].map(c => {
    const monthly = monthlyByCrew[c];
    const nights  = monthly.reduce((s, n) => s + n, 0);
    const members = (roster[c] || []).map(m => {
      const memberMonthly  = monthly.map(n => n * HOURS_PER_NIGHT);
      const nightHrs       = nights * HOURS_PER_NIGHT;
      const daytimeRides   = daytimeByMemberId.get(m.id) || 0;
      const daytimeHrs     = daytimeRides * HOURS_PER_DAYTIME_RIDE;
      return {
        memberId: m.id,
        name:     m.name,
        rank:     m.rank,
        role:     m.role,
        monthly:  memberMonthly,
        nights,
        daytimeRides,
        daytimeHrs,
        nightHrs,
        totalHrs: nightHrs + daytimeHrs,
      };
    });
    return { number: c, nights, hours: nights * HOURS_PER_NIGHT, members };
  });

  // ─── Exclusions footer ────────────────────────────────────────────────────
  const exclusions = { fdc: [], leave: [] };
  for (const ex of getExclusions()) {
    const bucket = ex.exclusion === 'FDC' ? 'fdc' : 'leave';
    exclusions[bucket].push({ name: ex.name, crew: ex.crew_number, type: ex.exclusion });
  }

  return {
    year,
    meta: {
      generatedAt:              new Date().toISOString(),
      totalNights,
      daytimeRideRowsParsed:    parsedCount,
      daytimeRideRowsUnparsed:  totalCount - parsedCount,
    },
    coverage,
    crews,
    exclusions,
  };
}

module.exports = { buildAnnualReport, HOURS_PER_NIGHT, HOURS_PER_DAYTIME_RIDE };
