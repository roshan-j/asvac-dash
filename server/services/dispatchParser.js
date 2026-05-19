/**
 * Dispatch HTML parser — extracts dispatch rows from iamresponding.com exports.
 *
 * The export format is an HTML report with a single table whose data rows
 * carry class="toprow". Each row has 4 cells:
 *   [0] date  — MM/DD/YYYY
 *   [1] time  — HH:MM:SS (24h)
 *   [2] hidden spacer (display:none)
 *   [3] details — embedded <div>/<span>/<input> icon followed by free text:
 *
 *       12 Alden PL
 *       Hartsdale NY
 *
 *       head injuries from a fall, unk age
 *
 *   The first non-prefix line that begins with "<digit>+ <letter>" is treated
 *   as the address; everything else is description. "2nd plektron" / "3rd
 *   plektron" markers (re-dispatch tags) are recognized as description, not
 *   address, because the digit isn't followed by whitespace.
 *
 * Address normalization is shared with dispatchMatcher so both sides of the
 * fuzzy match use identical canonical forms.
 */

const db = require('../db/database');
const { normalizeAddress, expandLocalAbbreviations } = require('./addressNormalizer');
const { matchDispatchesInRange } = require('./dispatchMatcher');

// Match every <tr class="toprow"> block until the next one or </table>.
const ROW_RE = /<tr class="toprow">([\s\S]*?)(?=<tr class="toprow"|<\/table)/gi;
const TD_RE  = /<td[^>]*>([\s\S]*?)<\/td>/gi;

// "MM/DD/YYYY"
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
// "HH:MM:SS" or "HH:MM"
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
// Lines that look like addresses share two traits: they (often) start with a
// house number and (almost always) contain a street-type word. Requiring the
// street-type word avoids false positives like "1 vehicle accident car into
// the woods" being mistaken for an address.
const STREET_TYPE_RE = /\b(road|rd|street|st|avenue|ave|av|boulevard|blvd|place|pl|lane|ln|drive|dr|court|ct|circle|cir|highway|hwy|parkway|pkwy|terrace|ter|trail|trl|way|broadway)\b\.?/i;
const HOUSE_PREFIX_RE = /^\d+\s+[A-Za-z]/;

// Landmark fallback. The dispatcher sometimes writes a description-style
// address that doesn't start with the house number — e.g. "ATRIA WOODLANDS
// Memory Care 5th floor…" with no address line at all. The Atria assisted-
// living complex occupies two adjacent buildings at 1015 and 1017 Saw Mill
// River Road and accounts for the majority of our Ardsley calls, so we
// match "Atria" aggressively: prefer 1015 or 1017 if either appears on the
// line, otherwise default to 1015 (the larger building / common dispatch
// default). The matcher's similarity threshold tolerates a 1015↔1017
// mismatch (single-char Levenshtein scores 0.96 — well above 0.85), so a
// wrong guess between the two still matches the right ESO call.
const LANDMARKS = [
  {
    name:       'atria',
    match:      /\batria\b/i,
    candidates: ['1015', '1017'],
    fallback:   '1015',
    street:     'Saw Mill River Road',
  },
  {
    name:       'sunrise of ardsley',
    match:      /\bsunrise of ardsley\b/i,
    candidates: ['1017'],
    fallback:   '1017',
    street:     'Saw Mill River Road',
  },
];

function detectLandmarkAddress(line) {
  for (const lm of LANDMARKS) {
    if (!lm.match.test(line)) continue;
    // Prefer an explicit candidate house number from the line.
    for (const num of lm.candidates) {
      if (new RegExp(`\\b${num}\\b`).test(line)) {
        return `${num} ${lm.street}`;
      }
    }
    // Landmark mentioned but no candidate house number → fall back to default.
    return `${lm.fallback} ${lm.street}`;
  }
  return null;
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html) {
  return decodeHtml(String(html || '').replace(/<[^>]+>/g, ''));
}

function parseDispatchDate(raw) {
  const m = String(raw || '').trim().match(DATE_RE);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseDispatchTime(raw) {
  const m = String(raw || '').trim().match(TIME_RE);
  if (!m) return null;
  const [, h, mi, s = '00'] = m;
  return `${h.padStart(2, '0')}:${mi}:${s.padStart(2, '0')}`;
}

/**
 * Split the details cell text into { address, description }.
 *
 * Strategy (in order of preference):
 *   1. First line that has BOTH a house-number prefix AND a street-type word
 *      ("12 Alden PL", "1017 Saw Mill River rd room 1104") — strongest signal.
 *   2. First line that has a street-type word but no house number
 *      ("Sprain Brook Parkway Northbound") — known location, no house #.
 *   3. Nothing — leave address null, all text goes to description. The
 *      matcher will then bucket the dispatch as mutual-aid by default.
 *
 * This avoids the false-positive where a description line starting with a
 * digit (e.g. "1 vehicle accident, car into the woods") gets mistaken for
 * an address.
 */
function splitAddressFromDescription(detailsText) {
  // Original lines for storage (we want to preserve dispatcher shorthand
  // like "SMRR" in raw_address) plus an expanded version that the regex can
  // recognize as an address. They line up by index.
  const lines     = detailsText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const expanded  = lines.map(expandLocalAbbreviations);

  // Pass 1: house-number + street-type — strongest signal
  let addressIdx = expanded.findIndex(l => HOUSE_PREFIX_RE.test(l) && STREET_TYPE_RE.test(l));
  // Pass 2: street-type only (intersections, parkways, etc.)
  if (addressIdx === -1) {
    addressIdx = expanded.findIndex(l => STREET_TYPE_RE.test(l));
  }
  // Pass 3: landmark + house number anywhere on the line. Catches dispatches
  // like "ATRIA WOODLANDS 1015 MEMORY CARE UNIT…" where neither a house-prefix
  // nor a street type is present, but a known landmark identifies the street.
  let synthesizedAddress = null;
  if (addressIdx === -1) {
    for (let i = 0; i < expanded.length; i++) {
      const synth = detectLandmarkAddress(expanded[i]);
      if (synth) { addressIdx = i; synthesizedAddress = synth; break; }
    }
  }

  if (addressIdx === -1) {
    return { address: null, description: lines.join(' ') || null };
  }

  const addressLines = [lines[addressIdx]];
  const descLines = [];
  // City/state line immediately after the address (e.g. "Hartsdale NY") gets
  // absorbed into the address block; other surrounding lines are description.
  for (let i = 0; i < lines.length; i++) {
    if (i === addressIdx) continue;
    if (i === addressIdx + 1 &&
        /^[A-Za-z][A-Za-z .]+\s+[A-Z]{2}$/.test(lines[i])) {
      addressLines.push(lines[i]);
      continue;
    }
    descLines.push(lines[i]);
  }

  return {
    address:     addressLines.join('\n'),
    description: descLines.length ? descLines.join(' ') : null,
    // When pass 3 fired, this is the reconstructed canonical address
    // ("1015 Saw Mill River Road" for an Atria dispatch). normalizeAddress
    // uses this preferentially so the similarity score reflects the inferred
    // street, not the landmark phrase.
    synthesizedAddress,
  };
}

/**
 * Parse a dispatch HTML export into an array of dispatch records.
 *
 * Returns [{ dispatchDate, dispatchTime, rawAddress, rawDescription,
 *            normalizedAddress }, ...]
 *
 * Records with no parseable date+time are dropped.
 */
function parseDispatchHtml(buffer) {
  const text = buffer.toString('utf8');
  const records = [];

  let rowMatch;
  while ((rowMatch = ROW_RE.exec(text)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    let cellMatch;
    TD_RE.lastIndex = 0;
    while ((cellMatch = TD_RE.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 4) continue;

    const dispatchDate = parseDispatchDate(stripTags(cells[0]).trim());
    const dispatchTime = parseDispatchTime(stripTags(cells[1]).trim());
    if (!dispatchDate || !dispatchTime) continue;

    const detailsText = stripTags(cells[3]).trim();
    const { address: rawAddress, description: rawDescription, synthesizedAddress } =
      splitAddressFromDescription(detailsText);

    // Prefer the synthesized canonical (from landmark detection) for the
    // normalized form when it exists, falling back to normalizing the raw
    // address line otherwise. raw_address still holds the dispatcher's
    // original text so the spot-check listing shows what they wrote.
    const normalizedAddress = synthesizedAddress
      ? normalizeAddress(synthesizedAddress)
      : (rawAddress ? normalizeAddress(rawAddress) : null);

    records.push({
      dispatchDate,
      dispatchTime,
      rawAddress,
      rawDescription,
      normalizedAddress,
    });
  }

  return records;
}

/**
 * Import dispatches from an HTML buffer. Idempotent: the UNIQUE constraint on
 * (dispatch_date, dispatch_time, raw_address) makes re-uploading the same
 * export safe. After insert, runs the matcher across the imported date range
 * so the report reflects the new rows immediately.
 *
 * Returns { parsed, inserted, skipped, matched, mutualAid, dateRange }.
 */
function importDispatchData(buffer, filename) {
  const records = parseDispatchHtml(buffer);
  if (records.length === 0) {
    throw new Error(
      'No dispatch rows found in HTML. Make sure this is an iamresponding.com ' +
      'SubscriberReportsDispatch export with class="toprow" rows.'
    );
  }

  const insertRow = db.prepare(`
    INSERT INTO dispatches
      (dispatch_date, dispatch_time, raw_address, raw_description, normalized_address)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(dispatch_date, dispatch_time, raw_address) DO UPDATE SET
      raw_description    = excluded.raw_description,
      normalized_address = excluded.normalized_address
  `);

  let inserted = 0, skipped = 0;
  let minDate = null, maxDate = null;

  db.transaction(() => {
    for (const r of records) {
      const result = insertRow.run(
        r.dispatchDate,
        r.dispatchTime,
        r.rawAddress,
        r.rawDescription,
        r.normalizedAddress
      );
      if (result.changes > 0) inserted++;
      else skipped++;
      if (!minDate || r.dispatchDate < minDate) minDate = r.dispatchDate;
      if (!maxDate || r.dispatchDate > maxDate) maxDate = r.dispatchDate;
    }
  })();

  // Run the matcher across the imported range so the report endpoint reflects
  // the new rows immediately. Catch so a matcher problem doesn't fail import.
  let matchSummary = { matched: 0, mutualAid: 0, scanned: 0 };
  if (minDate && maxDate) {
    try {
      matchSummary = matchDispatchesInRange(minDate, maxDate);
    } catch (err) {
      console.error('[dispatch] matcher post-import failed:', err.message);
    }
  }

  return {
    parsed: records.length,
    inserted,
    skipped,
    dateRange: { start: minDate, end: maxDate },
    ...matchSummary,
  };
}

module.exports = {
  parseDispatchHtml,
  importDispatchData,
  // exposed for unit testing
  splitAddressFromDescription,
  parseDispatchDate,
  parseDispatchTime,
};
