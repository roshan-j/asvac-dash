/**
 * Dispatch ↔ ESO matcher.
 *
 * For each row in `dispatches`, find the best-matching ESO call within a
 * tight time window AND an acceptable address similarity. Dispatches with no
 * acceptable match are treated as "lost to mutual aid" — the corps was paged
 * but didn't field a crew, so the run went to another agency and never
 * produced an ESO record.
 *
 * Rules in force (per discussion):
 *   - Time window:    ±30 minutes between dispatch time and ESO call_time
 *   - Address signal: similarity ≥ 0.85 on normalized "house# street name"
 *   - Confidence:     match_score = similarity (when accepted)
 *   - Same-call replays: multiple dispatches for the same incident (e.g. a
 *     follow-up "2nd plektron") all link to the same ESO call_number. The
 *     matcher itself doesn't dedupe — it just finds the best ESO match for
 *     each dispatch independently, which naturally produces this result.
 *
 * The ESO side requires `scene_address` to be populated. Rides imported
 * before Scene Address 1 became available are excluded from the candidate
 * pool — they can't be address-matched, so we conservatively leave dispatches
 * unmatched rather than guess from time alone.
 *
 * Returns { matched, mutualAid, scanned } per run.
 */

const db = require('../db/database');
const { normalizeAddress, addressSimilarity } = require('./addressNormalizer');

// Asymmetric window: ESO call_time can be slightly before the dispatch (clock
// drift, "Time in ESO Record Created Date" may pre-date the dispatch by a
// few minutes) but is usually 0–180 min AFTER — EMTs chart during/after the
// run. Empirically a tight 30-min window dropped legitimate matches (e.g.
// dispatch 01:59 → ESO chart at 02:55 for the same Saw Mill River call), so
// we widen on the after-dispatch side and lean on the address similarity
// threshold to keep false positives out.
const TIME_BEFORE_MIN = 15;     // ESO can pre-date dispatch by ≤15 min
const TIME_AFTER_MIN  = 180;    // ESO can post-date dispatch by ≤3 hr
const MIN_SCORE       = 0.85;

// Markers in the dispatch text that signal the call was always going to
// another agency. We only fire on STRONG signals — "TO :" prefix, explicit
// "mutual aid", "GPD jurisdiction", or "disregard/cancel". Neighbor-town
// name alone is too weak (we routinely respond inbound to Dobbs Ferry's
// 128 Ashford Ave SNF, for example), so we let those go through the matcher
// and only fall into out_of_area if both unmatched AND no ESO record exists.
const OUT_OF_AREA_RE = new RegExp([
  'mutual aid',
  '\\bmutual aide\\b',
  '\\bto\\s*:',                // "TO :" or "TO:" prefix
  '\\bto dobbs\\b',
  '\\bto hastings\\b',
  '\\bto elmsford\\b',
  '\\bto greenburgh\\b',
  '\\bto irvington\\b',
  '\\bto yonkers\\b',
  '\\bto tarrytown\\b',
  '\\bto sleepy hollow\\b',
  '\\bgpd\\b',
  '\\bdfpd\\b',                // Dobbs Ferry PD requesting
  '\\bgreenburgh pd\\b',
  '\\bgreenburgh school\\b',
  'greenburgh jurisdiction',
  '^disregard\\b',
  '\\bcancel(led|ed|\\b)',
  '\\bcnx\\b',
  'hastings on hudson',
  'this call is in',
  // "2nd plectron" / "2nd plektron" — IAR's re-page signal, fired only when
  // the first page got no response. Per the corps's own description, this
  // is a last-resort signal and the call usually goes to mutual aid.
  '\\b2nd plectron\\b',
  '\\b2nd plektron\\b',
  '\\bsecond plectron\\b',
  '\\bsecond plektron\\b',
].join('|'), 'i');

// Highway / parkway calls — typically NYS Police territory, sometimes our
// jurisdiction but we don't usually field them. Pulled out of the in-area
// bucket because they aren't operationally a "coverage gap" in the corps
// sense.
const HIGHWAY_RE = new RegExp([
  '\\bi[-\\s]?87\\b',
  '\\bmile\\s+(marker|maker|post)\\b',
  '\\bmm\\s*\\d',
  '\\bnorthbound\\b', '\\bsouthbound\\b',
  '\\bn/b\\b', '\\bs/b\\b',
  '\\bnb\\b', '\\bsb\\b',
  'saw mill river parkway',
  'saw mill parkway',
  'sprain brook',
  'bronx river parkway',
  'hutchinson river parkway',
  'thruway',
].join('|'), 'i');

/**
 * Classify an unmatched dispatch. Returns one of:
 *   'out_of_area' — explicit signal it was going to another agency
 *   'highway'     — highway/parkway/mile-marker — typically state police
 *   'unparseable' — no parseable address (description-only)
 *   'in_area_gap' — clean address in our area → real coverage gap
 *
 * Matched dispatches get NULL (no category needed).
 */
function categorizeUnmatched(rawAddr, rawDesc, normalizedAddr) {
  const haystack = `${rawAddr || ''} ${rawDesc || ''}`.trim();
  if (OUT_OF_AREA_RE.test(haystack)) return 'out_of_area';
  if (HIGHWAY_RE.test(haystack))      return 'highway';
  if (!normalizedAddr)                return 'unparseable';
  return 'in_area_gap';
}

// "HH:MM[:SS]" + date → minutes since epoch (ish — we just need diffs).
function toMinutes(dateYmd, timeHms) {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [h, mi] = String(timeHms || '00:00').split(':').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h || 0, mi || 0));
  return Math.floor(dt.getTime() / 60000);
}

/**
 * Pull all candidate ESO calls (one row per unique call) for a date range.
 * We dedupe to one row per call_number — multiple crew rows share the same
 * date/time/address.
 */
function loadCandidatesForRange(startDate, endDate) {
  return db.prepare(`
    SELECT call_number, call_date, call_time, scene_address
    FROM riding_points
    WHERE call_date BETWEEN ? AND ?
      AND call_time IS NOT NULL
      AND scene_address IS NOT NULL
    GROUP BY call_number
  `).all(startDate, endDate);
}

/**
 * Find the best-matching ESO call for a single dispatch.
 * Returns { call_number, score, esoAddress, esoTime } or null.
 */
function findBestMatch(dispatch, candidatesByDate) {
  if (!dispatch.normalized_address) return null;

  const dispatchMin = toMinutes(dispatch.dispatch_date, dispatch.dispatch_time);

  // Consider candidates on the dispatch date and the next day (a midnight
  // dispatch could have an ESO timestamp on the following calendar date).
  const dayKeys = [dispatch.dispatch_date, nextDay(dispatch.dispatch_date)];

  let best = null;
  for (const dayKey of dayKeys) {
    const candidates = candidatesByDate.get(dayKey) || [];
    for (const c of candidates) {
      const callMin = toMinutes(c.call_date, c.call_time + ':00');
      const delta = callMin - dispatchMin;  // signed: + means ESO after dispatch
      if (delta < -TIME_BEFORE_MIN || delta > TIME_AFTER_MIN) continue;

      const esoNorm = normalizeAddress(c.scene_address);
      const score   = addressSimilarity(dispatch.normalized_address, esoNorm);
      if (score < MIN_SCORE) continue;

      const minutesApart = Math.abs(delta);
      if (!best || score > best.score ||
         (score === best.score && minutesApart < best.minutesApart)) {
        best = {
          call_number: c.call_number,
          score,
          esoAddress: c.scene_address,
          esoTime: `${c.call_date} ${c.call_time}`,
          minutesApart,
        };
      }
    }
  }
  return best;
}

function nextDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Match all dispatches in a date range against ESO calls. Writes
 * matched_call_number + match_score + matched_at on each row.
 *
 * Re-runnable; recomputes from scratch within the range.
 */
function matchDispatchesInRange(startDate, endDate) {
  const dispatches = db.prepare(`
    SELECT id, dispatch_date, dispatch_time, normalized_address,
           raw_address, raw_description
    FROM dispatches
    WHERE dispatch_date BETWEEN ? AND ?
  `).all(startDate, endDate);

  // Group candidates by date for O(1) lookup per dispatch.
  const candidates = loadCandidatesForRange(startDate, endDate);
  const candidatesByDate = new Map();
  for (const c of candidates) {
    if (!candidatesByDate.has(c.call_date)) candidatesByDate.set(c.call_date, []);
    candidatesByDate.get(c.call_date).push(c);
  }

  const update = db.prepare(`
    UPDATE dispatches
    SET matched_call_number = ?,
        match_score         = ?,
        aid_category        = ?,
        matched_at          = datetime('now')
    WHERE id = ?
  `);

  let matched = 0, inAreaGap = 0, outOfArea = 0, highway = 0, unparseable = 0;
  db.transaction(() => {
    for (const d of dispatches) {
      const m = findBestMatch(d, candidatesByDate);
      if (m) {
        update.run(m.call_number, m.score, null, d.id);
        matched++;
      } else {
        const category = categorizeUnmatched(d.raw_address, d.raw_description, d.normalized_address);
        update.run(null, null, category, d.id);
        if      (category === 'in_area_gap') inAreaGap++;
        else if (category === 'out_of_area') outOfArea++;
        else if (category === 'highway')     highway++;
        else                                  unparseable++;
      }
    }
  })();

  return {
    scanned: dispatches.length,
    matched,
    inAreaGap,
    outOfArea,
    highway,
    unparseable,
    mutualAid: inAreaGap + outOfArea + highway + unparseable,
    candidatePool: candidates.length,
  };
}

/**
 * Build a year-scoped report:
 *   { year, total, matched, mutualAid, matchRate, esoAddressCoverage,
 *     byMonth: [{ month, total, matched, mutualAid }],
 *     samples: { matched: [...top 10 by score], unmatched: [...top 10 recent] } }
 *
 * esoAddressCoverage = fraction of ESO calls in range that have a scene_address
 * populated; surfaces whether low match-rate is a real mutual-aid signal or
 * just missing address data.
 */
function buildMatchReport(year) {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;

  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM dispatches WHERE dispatch_date BETWEEN ? AND ?
  `).get(start, end).c;

  const matched = db.prepare(`
    SELECT COUNT(*) AS c FROM dispatches
    WHERE dispatch_date BETWEEN ? AND ? AND matched_call_number IS NOT NULL
  `).get(start, end).c;

  // Category buckets for the unmatched. in_area_gap is the headline number
  // the user cares about — dispatches in our area we didn't field.
  const cats = db.prepare(`
    SELECT aid_category, COUNT(*) AS c FROM dispatches
    WHERE dispatch_date BETWEEN ? AND ? AND matched_call_number IS NULL
    GROUP BY aid_category
  `).all(start, end);
  const catCount = (name) => (cats.find(r => r.aid_category === name)?.c) || 0;
  const inAreaGap   = catCount('in_area_gap');
  const outOfArea   = catCount('out_of_area');
  const highway     = catCount('highway');
  const unparseable = catCount('unparseable');

  const mutualAid = total - matched;
  const matchRate = total > 0 ? matched / total : 0;
  const inAreaGapRate = total > 0 ? inAreaGap / total : 0;

  // ESO address coverage in the same year — context for the match rate.
  const esoTotalCalls = db.prepare(`
    SELECT COUNT(DISTINCT call_number) AS c FROM riding_points
    WHERE call_date BETWEEN ? AND ?
  `).get(start, end).c;
  const esoWithAddress = db.prepare(`
    SELECT COUNT(DISTINCT call_number) AS c FROM riding_points
    WHERE call_date BETWEEN ? AND ? AND scene_address IS NOT NULL
  `).get(start, end).c;
  const esoAddressCoverage = esoTotalCalls > 0 ? esoWithAddress / esoTotalCalls : 0;

  const byMonth = db.prepare(`
    SELECT substr(dispatch_date, 6, 2) AS m,
           COUNT(*) AS total,
           SUM(CASE WHEN matched_call_number IS NOT NULL THEN 1 ELSE 0 END) AS matched,
           SUM(CASE WHEN aid_category = 'in_area_gap' THEN 1 ELSE 0 END)    AS in_area_gap,
           SUM(CASE WHEN aid_category = 'out_of_area' THEN 1 ELSE 0 END)    AS out_of_area,
           SUM(CASE WHEN aid_category = 'highway'     THEN 1 ELSE 0 END)    AS highway,
           SUM(CASE WHEN aid_category = 'unparseable' THEN 1 ELSE 0 END)    AS unparseable
    FROM dispatches
    WHERE dispatch_date BETWEEN ? AND ?
    GROUP BY m
    ORDER BY m
  `).all(start, end).map(r => ({
    month:        parseInt(r.m, 10),
    total:        r.total,
    matched:      r.matched,
    inAreaGap:    r.in_area_gap,
    outOfArea:    r.out_of_area,
    highway:      r.highway,
    unparseable:  r.unparseable,
    mutualAid:    r.total - r.matched,
    matchRate:    r.total > 0 ? r.matched / r.total : 0,
  }));

  // Samples for spot-checking. The user said address match rate is what gives
  // them confidence — these let them eyeball pairs at every quality band.
  const sampleMatched = db.prepare(`
    SELECT d.dispatch_date, d.dispatch_time, d.raw_address AS dispatchAddress,
           d.match_score AS score, d.matched_call_number AS callNumber,
           (SELECT scene_address FROM riding_points r WHERE r.call_number = d.matched_call_number LIMIT 1) AS esoAddress
    FROM dispatches d
    WHERE d.dispatch_date BETWEEN ? AND ? AND d.matched_call_number IS NOT NULL
    ORDER BY d.match_score DESC, d.dispatch_date DESC
    LIMIT 20
  `).all(start, end);

  // Unmatched sample focused on in-area gaps — these are the operationally
  // important ones the user cares about (real coverage misses, not the
  // explicit-out-of-area or unparseable ones).
  const sampleUnmatched = db.prepare(`
    SELECT dispatch_date, dispatch_time, raw_address AS dispatchAddress,
           raw_description AS description, aid_category AS aidCategory
    FROM dispatches
    WHERE dispatch_date BETWEEN ? AND ? AND matched_call_number IS NULL
    ORDER BY (aid_category = 'in_area_gap') DESC, dispatch_date DESC, dispatch_time DESC
    LIMIT 20
  `).all(start, end);

  // Score distribution for matched (helps validate the threshold).
  const distribution = db.prepare(`
    SELECT
      SUM(CASE WHEN match_score >= 0.95                       THEN 1 ELSE 0 END) AS bucket_95_100,
      SUM(CASE WHEN match_score >= 0.90 AND match_score <0.95 THEN 1 ELSE 0 END) AS bucket_90_95,
      SUM(CASE WHEN match_score >= 0.85 AND match_score <0.90 THEN 1 ELSE 0 END) AS bucket_85_90
    FROM dispatches
    WHERE dispatch_date BETWEEN ? AND ? AND matched_call_number IS NOT NULL
  `).get(start, end);

  return {
    year,
    total,
    matched,
    mutualAid,         // total unmatched (for backwards compatibility)
    inAreaGap,         // ← THE headline number: dispatches we missed in our area
    outOfArea,         // explicitly going elsewhere, never ours
    highway,           // highway/parkway/mile-marker — typically state police
    unparseable,       // description-only, no parseable address
    matchRate,
    inAreaGapRate,
    esoAddressCoverage,
    byMonth,
    distribution,
    samples: { matched: sampleMatched, unmatched: sampleUnmatched },
    config: { timeBeforeMin: TIME_BEFORE_MIN, timeAfterMin: TIME_AFTER_MIN, minScore: MIN_SCORE },
  };
}

module.exports = { matchDispatchesInRange, buildMatchReport, findBestMatch };
