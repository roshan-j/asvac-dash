/**
 * Night-Shift Service — fetches the public ASVAC Google Calendar ICS feed
 * and populates the crew_nights table.
 *
 * The calendar (tony@cprtony.com) contains all-day events with summaries like
 *   "CREW # 1 NIGHT CREW", "CREW # 2 NIGHT CREW", ...
 *
 * Each such event spans the dates the crew is on call (DTEND is exclusive,
 * per RFC 5545 for VALUE=DATE events). We expand each event into one row
 * per night in crew_nights, keyed by the date the night begins.
 *
 * The night is credited to the date it STARTS (e.g., a night running
 * 22:00 Dec 31 → 06:00 Jan 1 is a December night).
 */

const https = require('https');
const db    = require('../db/database');

const ICS_URL = process.env.NIGHT_SHIFT_ICS_URL ||
                'https://calendar.google.com/calendar/ical/tony%40cprtony.com/public/basic.ics';

// The calendar's SUMMARY field has been authored over many years with drift;
// the corpus contains all of these variants — each must extract crew 1-6:
//   "CREW # 1 NIGHT CREW", "CREW 1 NIGHT CREW", "Crew # 3 Night Crew",
//   "CREW # 5 NIGHT CREW", "CREW # 5NIGHT CREW", "CREW # 5 CREW NIGHT" (typo),
//   "[NIGHT CREW] Crew 1"
//
// Strategy: try the dominant order first ("CREW...N...NIGHT"), fall back to the
// "[NIGHT CREW] Crew N" variant. Anything else (CPR, meetings, training) is
// rejected because both patterns require NIGHT to appear.
const RE_CREW_FIRST = /CREW\s*#?\s*([1-6])\b(?=.*NIGHT)/i;
const RE_NIGHT_FIRST = /NIGHT\s*CREW[^A-Za-z0-9]*CREW\s*#?\s*([1-6])\b/i;

function extractCrewNumber(summary) {
  if (!summary) return null;
  const m1 = summary.match(RE_CREW_FIRST);
  if (m1) return parseInt(m1[1], 10);
  const m2 = summary.match(RE_NIGHT_FIRST);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

const TZ = 'America/New_York';
const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

function utcDateToLocalYmd(jsDate) {
  // en-CA returns YYYY-MM-DD natively; we still parse to be explicit.
  const parts = ymdFormatter.formatToParts(jsDate);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpGet(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 ASVAC-Dashboard' } }, res => {
      // Follow redirects (Google sometimes 302s ICS to a CDN)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        return resolve(httpGet(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`ICS fetch returned HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// ─── ICS parsing ──────────────────────────────────────────────────────────────

/**
 * Unfold ICS lines per RFC 5545 §3.1: any line beginning with whitespace
 * is a continuation of the previous line.
 */
function unfoldLines(text) {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Returns array of events as { summary, dtstart, dtend, allDay } where
 * dtstart/dtend are 'YYYY-MM-DD' (already converted to America/New_York for
 * timed events). allDay distinguishes whether DTEND is exclusive (RFC 5545
 * for VALUE=DATE) — for timed events we do not auto-expand a date range.
 */
function parseEvents(icsText) {
  const lines = unfoldLines(icsText);
  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT')   { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const keyPart  = line.slice(0, colonIdx);
    const value    = line.slice(colonIdx + 1);
    const propName = keyPart.split(';')[0].toUpperCase();

    if (propName === 'SUMMARY') {
      cur.summary = value.replace(/\\,/g, ',').replace(/\\n/g, '\n').trim();
    } else if (propName === 'DTSTART') {
      const parsed = parseIcsDateTime(keyPart, value);
      if (parsed) { cur.dtstart = parsed.ymd; cur.allDay = parsed.allDay; }
    } else if (propName === 'DTEND') {
      const parsed = parseIcsDateTime(keyPart, value);
      if (parsed) cur.dtend = parsed.ymd;
    } else if (propName === 'RRULE') {
      cur.rrule = parseRRule(value);
    } else if (propName === 'EXDATE') {
      // EXDATE can list multiple comma-separated dates per RFC 5545
      cur.exdates = cur.exdates || new Set();
      for (const v of value.split(',')) {
        const parsed = parseIcsDateTime(keyPart, v.trim());
        if (parsed) cur.exdates.add(parsed.ymd);
      }
    }
  }
  return events;
}

/**
 * Parse an ICS DTSTART/DTEND value and return { ymd, allDay }.
 *
 *   "VALUE=DATE" param  → all-day event, ymd = date (DTEND exclusive)
 *   "20251119T001500Z"  → UTC datetime, ymd = local NY date
 *   TZID-prefixed local → already-local datetime, ymd = its date
 */
function parseIcsDateTime(keyPart, value) {
  const isDateOnly = /VALUE=DATE(?!-)/i.test(keyPart);

  if (isDateOnly) {
    const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})$/);
    return m ? { ymd: `${m[1]}-${m[2]}-${m[3]}`, allDay: true } : null;
  }

  // Datetime: "YYYYMMDDTHHMMSSZ" (UTC) or "YYYYMMDDTHHMMSS" (TZID-local)
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, z] = m;

  if (z === 'Z') {
    // UTC — convert to America/New_York date
    const jsDate = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
    return { ymd: utcDateToLocalYmd(jsDate), allDay: false };
  }

  // No Z and no TZID handling — assume the date as written
  return { ymd: `${y}-${mo}-${d}`, allDay: false };
}

/**
 * Iterate dates from start (inclusive) to end (exclusive), yielding 'YYYY-MM-DD'.
 * If end is missing, yields just the start date.
 */
function* dateRange(startYmd, endYmd) {
  const start = new Date(`${startYmd}T00:00:00Z`);
  const end   = endYmd ? new Date(`${endYmd}T00:00:00Z`) : null;
  if (!end || end <= start) {
    yield startYmd;
    return;
  }
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().slice(0, 10);
  }
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(startYmd, endYmd) {
  const a = new Date(`${startYmd}T00:00:00Z`);
  const b = new Date(`${endYmd}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * Parse a DAILY RRULE value. Returns { interval, until, count } or null for
 * unsupported FREQ values. The ASVAC calendar uses only FREQ=DAILY for the
 * 6-crew, 3-night, 18-day rotation.
 */
function parseRRule(value) {
  const parts = {};
  for (const p of String(value).split(';')) {
    const [k, v] = p.split('=');
    if (k && v != null) parts[k.toUpperCase()] = v;
  }
  if ((parts.FREQ || '').toUpperCase() !== 'DAILY') return null;
  let until = null;
  if (parts.UNTIL) {
    const m = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return {
    interval: parseInt(parts.INTERVAL || '1', 10),
    until,
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : null,
  };
}

/**
 * Filters events to night-crew assignments and expands them into nights.
 *
 * For all-day events: DTEND is exclusive, expand DTSTART..DTEND-1.
 * For timed events: a single night attributed to DTSTART's local date.
 * For events with RRULE: each occurrence repeats by INTERVAL days until UNTIL.
 *   For each occurrence, expand by the same length as the original event.
 *   EXDATE values exclude entire occurrences identified by their start date.
 *
 * Returns [{ date: 'YYYY-MM-DD', crewNumber: 1-6 }, ...].
 */
function extractCrewNights(events) {
  const out = [];
  for (const ev of events) {
    if (!ev.dtstart || !ev.summary) continue;
    const crewNumber = extractCrewNumber(ev.summary);
    if (!crewNumber) continue;

    const occurrenceStarts = expandOccurrences(ev);

    // Length of the original event in days (for expanding all-day occurrences).
    const lengthDays = ev.allDay && ev.dtend
      ? Math.max(1, daysBetween(ev.dtstart, ev.dtend))
      : 1;

    for (const occStart of occurrenceStarts) {
      if (ev.exdates && ev.exdates.has(occStart)) continue;

      if (ev.allDay) {
        const occEnd = addDays(occStart, lengthDays);
        for (const date of dateRange(occStart, occEnd)) {
          out.push({ date, crewNumber });
        }
      } else {
        out.push({ date: occStart, crewNumber });
      }
    }
  }
  return out;
}

/**
 * Expand RRULE occurrences. For events without RRULE returns just [dtstart].
 * Caps at 5000 iterations as a safety net.
 */
function expandOccurrences(ev) {
  if (!ev.rrule) return [ev.dtstart];
  const { interval, until, count } = ev.rrule;
  const out = [];
  let cur = ev.dtstart;
  let iter = 0;
  while (cur && (!until || cur <= until)) {
    out.push(cur);
    if (count && out.length >= count) break;
    cur = addDays(cur, interval);
    if (++iter > 5000) break;
  }
  return out;
}

// ─── Main sync ────────────────────────────────────────────────────────────────

/**
 * Fetch the ICS feed and replace the crew_nights table with fresh data.
 * Returns { synced, conflicts, byCrewYear }.
 *
 * "conflicts" = nights that appeared on more than one crew's schedule
 * (last-write-wins, last seen entry takes precedence).
 */
async function syncNightShifts() {
  const icsText = await httpGet(ICS_URL);
  const events  = parseEvents(icsText);
  const nights  = extractCrewNights(events);

  const seen = new Map();
  let conflicts = 0;
  for (const n of nights) {
    if (seen.has(n.date) && seen.get(n.date) !== n.crewNumber) conflicts++;
    seen.set(n.date, n.crewNumber);
  }

  const wipe   = db.prepare('DELETE FROM crew_nights');
  const insert = db.prepare(
    `INSERT INTO crew_nights (date, crew_number, source) VALUES (?, ?, 'ics')`
  );

  db.transaction(() => {
    wipe.run();
    for (const [date, crewNumber] of seen) {
      insert.run(date, crewNumber);
    }
  })();

  // Aggregate for log output: nights per crew per year
  const byCrewYear = db.prepare(`
    SELECT substr(date, 1, 4) AS year, crew_number, COUNT(*) AS nights
    FROM crew_nights
    GROUP BY year, crew_number
    ORDER BY year DESC, crew_number
  `).all();

  console.log(`[nightshift] Synced ${seen.size} nights from ICS (${events.length} events scanned, ${conflicts} conflicts).`);
  return { synced: seen.size, eventsScanned: events.length, conflicts, byCrewYear };
}

/**
 * Returns nights for a given year, grouped by crew number.
 *   { 1: [{date, ...}, ...], 2: [...], ... }
 */
function getNightsByCrewForYear(year) {
  const rows = db.prepare(`
    SELECT date, crew_number FROM crew_nights
    WHERE date >= ? AND date <= ?
    ORDER BY date
  `).all(`${year}-01-01`, `${year}-12-31`);

  const out = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rows) out[r.crew_number]?.push(r);
  return out;
}

module.exports = {
  syncNightShifts,
  getNightsByCrewForYear,
  // exposed for unit testing
  parseEvents,
  extractCrewNights,
  extractCrewNumber,
  unfoldLines,
  utcDateToLocalYmd,
};
