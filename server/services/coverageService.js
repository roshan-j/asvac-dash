/**
 * Coverage-gap analytics — the "patchwork quilt" instrument.
 *
 * Answers the operational question the Flexible-Scheduling pillar could never
 * see: WHEN (day-of-week × time-block) do we lose our own calls to mutual aid,
 * and HOW concentrated is our riding load across the ACTIVE ADULT membership?
 *
 * Demand + loss come from `dispatches`, using the SAME classification as the
 * dispatch match-report: a call is "ours" if it matched an ESO record
 * (responded) OR was categorised `in_area_gap` (dispatched to our area, no
 * crew fielded → lost to mutual aid). out_of_area / highway / unparseable are
 * excluded — they were never operationally ours. Miss% = in_area_gap /
 * (matched + in_area_gap).
 *
 * Breadth comes from `riding_points`, measured against the ACTIVE ADULT roster
 * (crew_members, seeded from crew_roster.json) rather than the full members
 * table — the "build as we see them" member list overcounts (college +
 * inactive + historical). Active adult = on a crew and not on medical/personnel
 * leave.
 */

const db = require('../db/database');

const BLOCKS = [
  { key: 'overnight', label: 'Overnight', range: '22:00–06:00' },
  { key: 'morning',   label: 'Morning',   range: '06:00–10:00' },
  { key: 'day',       label: 'Day',       range: '10:00–18:00' },
  { key: 'evening',   label: 'Evening',   range: '18:00–22:00' },
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const OURS = `(matched_call_number IS NOT NULL OR aid_category = 'in_area_gap')`;
const MISSED = `(aid_category = 'in_area_gap')`;
const BLOCK_SQL = `
  CASE
    WHEN dispatch_time >= '22:00' OR dispatch_time < '06:00' THEN 'overnight'
    WHEN dispatch_time < '10:00' THEN 'morning'
    WHEN dispatch_time < '18:00' THEN 'day'
    ELSE 'evening'
  END`;

const missPct = (missed, ours) => (ours > 0 ? Math.round((missed / ours) * 1000) / 10 : null);

// Build a WHERE clause + params from optional filters. `months` is an array of
// 1-12 ints (season filter); `since` is a YYYY-MM-DD lower bound.
function buildWhere({ since = null, months = null } = {}) {
  const clauses = [];
  const params = {};
  if (since) { clauses.push('dispatch_date >= @since'); params.since = since; }
  if (months && months.length) {
    const ph = months.map((m, i) => `@m${i}`);
    months.forEach((m, i) => { params[`m${i}`] = String(m).padStart(2, '0'); });
    clauses.push(`strftime('%m', dispatch_date) IN (${ph.join(',')})`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** The 7×4 gap grid + ranked worst cells. */
function buildGapMap(filters = {}) {
  const { where, params } = buildWhere(filters);
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%w', dispatch_date) AS INTEGER) AS dow,
      ${BLOCK_SQL} AS block,
      SUM(CASE WHEN ${OURS}   THEN 1 ELSE 0 END) AS ours,
      SUM(CASE WHEN ${MISSED} THEN 1 ELSE 0 END) AS missed
    FROM dispatches ${where}
    GROUP BY dow, block
  `).all(params);

  const byKey = new Map(rows.map(r => [`${r.dow}|${r.block}`, r]));
  const grid = [];
  for (let d = 0; d < 7; d++) {
    for (const b of BLOCKS) {
      const r = byKey.get(`${d}|${b.key}`) || { ours: 0, missed: 0 };
      grid.push({
        dow: d, dowLabel: DOW[d], block: b.key, blockLabel: b.label, blockRange: b.range,
        ours: r.ours, missed: r.missed, missPct: missPct(r.missed, r.ours),
      });
    }
  }
  const worstCells = grid
    .filter(c => c.ours >= 40 && c.missPct != null)
    .sort((a, b) => b.missPct - a.missPct)
    .slice(0, 8);
  return { grid, worstCells };
}

/** Headline + year/month trend. byMonth is always full-year (for seasonality). */
function buildOverall(filters = {}) {
  const { where, params } = buildWhere(filters);
  const o = db.prepare(`
    SELECT SUM(CASE WHEN ${OURS} THEN 1 ELSE 0 END) AS ours,
           SUM(CASE WHEN ${MISSED} THEN 1 ELSE 0 END) AS missed,
           MIN(dispatch_date) AS firstDate, MAX(dispatch_date) AS lastDate
    FROM dispatches ${where}
  `).get(params);

  const byYear = db.prepare(`
    SELECT substr(dispatch_date, 1, 4) AS year,
      SUM(CASE WHEN ${OURS} THEN 1 ELSE 0 END) AS ours,
      SUM(CASE WHEN ${MISSED} THEN 1 ELSE 0 END) AS missed
    FROM dispatches GROUP BY year ORDER BY year
  `).all().map(r => ({ year: r.year, ours: r.ours, missed: r.missed, missPct: missPct(r.missed, r.ours) }));

  return {
    ours: o.ours || 0, missed: o.missed || 0, missPct: missPct(o.missed || 0, o.ours || 0),
    firstDate: o.firstDate, lastDate: o.lastDate, byYear, byMonth: monthlyMissRates(),
  };
}

/** Miss% for every calendar month, aggregated across years. */
function monthlyMissRates() {
  return db.prepare(`
    SELECT CAST(substr(dispatch_date, 6, 2) AS INTEGER) AS month,
      SUM(CASE WHEN ${OURS} THEN 1 ELSE 0 END) AS ours,
      SUM(CASE WHEN ${MISSED} THEN 1 ELSE 0 END) AS missed
    FROM dispatches GROUP BY month ORDER BY month
  `).all().map(r => ({ month: r.month, ours: r.ours, missed: r.missed, missPct: missPct(r.missed, r.ours) }));
}

/**
 * Auto-detect two seasons from the monthly miss-rate signal. Finds the
 * contiguous run of months (length 3–6, wrap-around allowed) whose
 * volume-weighted miss% differs most from the rest of the year — the natural
 * "high-miss" vs "low-miss" seasons, rather than hard-coded winter/summer.
 * `meaningful` flags whether the gap clears a materiality bar (≥5 pp).
 */
function detectSeasons() {
  const rows = monthlyMissRates();
  const M = new Map(rows.map(r => [r.month, r]));
  const cell = (m) => M.get(m) || { ours: 0, missed: 0 };
  const agg = (months) => {
    let ours = 0, missed = 0;
    months.forEach(m => { ours += cell(m).ours; missed += cell(m).missed; });
    return { months, ours, missed, missPct: missPct(missed, ours) };
  };
  const label = (months) => `${MON[months[0] - 1]}–${MON[months[months.length - 1] - 1]}`;

  let best = null;
  for (let L = 3; L <= 6; L++) {
    for (let s = 1; s <= 12; s++) {
      const arc = Array.from({ length: L }, (_, k) => ((s - 1 + k) % 12) + 1);
      const arcSet = new Set(arc);
      const comp = []; for (let m = 1; m <= 12; m++) if (!arcSet.has(m)) comp.push(m);
      const A = agg(arc), C = agg(comp);
      if (A.ours < 200 || C.ours < 200 || A.missPct == null || C.missPct == null) continue;
      const gap = Math.abs(A.missPct - C.missPct);
      if (!best || gap > best.gap) {
        const [hi, lo] = A.missPct >= C.missPct ? [A, C] : [C, A];
        best = {
          gap: Math.round(gap * 10) / 10,
          high: { key: 'high', name: `High-miss (${label(hi.months)})`, ...hi },
          low:  { key: 'low',  name: `Low-miss (${label(lo.months)})`,  ...lo },
        };
      }
    }
  }
  if (!best) return { meaningful: false, gapPp: 0, seasons: [] };
  return {
    meaningful: best.gap >= 5,
    gapPp: best.gap,
    seasons: [best.high, best.low],
  };
}

/** Riding-base breadth measured against the ACTIVE ADULT roster. */
function buildBreadth({ months = 12 } = {}) {
  const maxRow = db.prepare(`SELECT MAX(call_date) AS d FROM riding_points`).get();
  if (!maxRow.d) return null;
  const since = db.prepare(`SELECT date(@d, @off) AS s`).get({ d: maxRow.d, off: `-${months} months` }).s;

  // Active adult roster: on a crew, not on leave.
  const ACTIVE = `(exclusion IS NULL OR exclusion != 'leave')`;
  const activeAdults = db.prepare(
    `SELECT COUNT(DISTINCT member_id) AS c FROM crew_members WHERE ${ACTIVE}`
  ).get().c;
  const activeAdultsRode = db.prepare(`
    SELECT COUNT(DISTINCT cm.member_id) AS c
    FROM crew_members cm
    WHERE ${ACTIVE}
      AND EXISTS (SELECT 1 FROM riding_points rp WHERE rp.member_id = cm.member_id AND rp.call_date >= @since)
  `).get({ since }).c;

  // Concentration across everyone who rode (heroes carry the corps).
  const perRider = db.prepare(`
    SELECT member_id, COUNT(*) AS rides FROM riding_points
    WHERE call_date >= @since GROUP BY member_id ORDER BY rides DESC
  `).all({ since });
  const totalRides = perRider.reduce((s, r) => s + r.rides, 0);
  const shareN = (n) => (totalRides > 0
    ? Math.round((perRider.slice(0, n).reduce((s, r) => s + r.rides, 0) / totalRides) * 1000) / 10 : 0);

  const topRiders = db.prepare(`
    SELECT m.name, COUNT(*) AS rides,
           EXISTS(SELECT 1 FROM crew_members cm WHERE cm.member_id = rp.member_id AND ${ACTIVE}) AS activeAdult
    FROM riding_points rp JOIN members m ON m.id = rp.member_id
    WHERE rp.call_date >= @since
    GROUP BY rp.member_id ORDER BY rides DESC LIMIT 10
  `).all({ since }).map(r => ({ name: r.name, rides: r.rides, activeAdult: !!r.activeAdult }));

  return {
    since, months,
    activeAdults,
    activeAdultsRode,
    activeAdultsZero: Math.max(0, activeAdults - activeAdultsRode),
    ridersInWindow: perRider.length,   // all riders incl. college
    totalRides,
    top5Share: shareN(5),
    top10Share: shareN(10),
    topRiders,
  };
}

/** Full payload for the Coverage view. */
function buildCoverageReport({ since = null, months = null, breadthMonths = 12 } = {}) {
  return {
    filters: { since, months },
    overall: buildOverall({ since, months }),
    ...buildGapMap({ since, months }),
    seasonDetection: detectSeasons(),
    breadth: buildBreadth({ months: breadthMonths }),
    blocks: BLOCKS,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { buildCoverageReport, buildGapMap, buildOverall, buildBreadth, detectSeasons };
