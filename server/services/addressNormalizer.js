/**
 * Address normalization for dispatch matching.
 *
 * Goal: turn both dispatch addresses ("1017 Saw Mill River rd room 1104") and
 * ESO scene addresses ("1015  Saw Mill River Road") into a canonical form that
 * makes them safe to compare via Levenshtein similarity:
 *
 *   "1017 saw mill river road"
 *   "1015 saw mill river road"
 *
 * Steps:
 *   1. Lowercase
 *   2. Strip city/state tails (Hartsdale NY, Ardsley NY, etc.)
 *   3. Remove apartment/unit/room/floor/suite markers and any number attached
 *   4. Canonicalize street-type abbreviations (Rd → Road, Ave → Avenue, …)
 *   5. Collapse whitespace and trim punctuation
 *
 * Output is { full, houseNumber, streetName } so the matcher can score house
 * number and street name separately when useful.
 */

// Local shorthand the dispatchers use. Expand BEFORE any other normalization
// so the standard regex/street-type machinery can recognize them.
// "1017 SMRR" → "1017 Saw Mill River Road" makes 62+ Atria/Sunrise dispatches
// matchable against ESO scene addresses.
const LOCAL_ABBREVS = [
  [/\bsmrr\b/gi,  'saw mill river road'],
];

// Local cities/states/zip-prefix tokens we want to drop. Add as needed.
const LOCALITY_RE = new RegExp(
  '\\b(' +
    'hartsdale|ardsley|dobbs ferry|tarrytown|elmsford|greenburgh|' +
    'irvington|yonkers|white plains|scarsdale|new rochelle|' +
    'new york|n\\.?y\\.?|ny|nys|usa' +
  ')\\b',
  'g'
);

// Apartment/unit/room/floor/suite phrases followed by an optional alphanumeric tag.
// Strips "room 1104", "apt 3B", "unit 5", "ste 200", "floor 2", "fl 3", "#4A".
const UNIT_RE = /\b(?:apartment|apt|room|rm|unit|suite|ste|floor|fl)\.?\s*[#]?\s*[a-z0-9-]+\b/g;
const HASH_UNIT_RE = /#\s*[a-z0-9-]+\b/g;

// Canonical street-type swaps. Applied as whole words, lowercase already.
const STREET_TYPES = [
  ['rd',       'road'],
  ['st',       'street'],
  ['ave',      'avenue'],
  ['av',       'avenue'],
  ['blvd',     'boulevard'],
  ['pl',       'place'],
  ['ln',       'lane'],
  ['dr',       'drive'],
  ['ct',       'court'],
  ['cir',      'circle'],
  ['hwy',      'highway'],
  ['pkwy',     'parkway'],
  ['ter',      'terrace'],
  ['trl',      'trail'],
  ['way',      'way'],
  // Broadway is its own street type — "1 Broadway" has no suffix because
  // the name IS the suffix. Mapping it to itself lets the parser recognize
  // such lines as addresses and the truncator stop after it.
  ['broadway', 'broadway'],
];

const DIRECTIONAL_TYPES = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};

/**
 * Expand known local abbreviations (SMRR → Saw Mill River Road, etc.).
 * Exported so the dispatch parser can apply it BEFORE line-detection regexes
 * (otherwise SMRR addresses look description-shaped and get skipped).
 */
function expandLocalAbbreviations(s) {
  let out = String(s || '');
  for (const [re, full] of LOCAL_ABBREVS) out = out.replace(re, full);
  return out;
}

// Set of canonical street-type words (post-expansion). Used to truncate
// trailing descriptive text after the street name in normalize().
const CANONICAL_STREET_TYPES = new Set(STREET_TYPES.map(([, full]) => full));

/**
 * Normalize a raw address string into a canonical lowercase form.
 * Returns null if the input is empty after stripping noise.
 */
function normalizeAddress(raw) {
  if (!raw) return null;
  let s = String(raw).toLowerCase();

  // Strip dispatcher prefixes that aren't part of the address. iamresponding.com
  // dispatchers frequently prefix the address line with "Address: : " or
  // "address:" — leaving it in tanks similarity vs. the clean ESO scene_address
  // (e.g. "address 128 ashford avenue" vs. "128 ashford avenue" scores 0.69
  // instead of 1.0). 20+ matches were missed for this reason.
  s = s.replace(/^\s*(address|addr|location|loc)\s*:\s*:?\s*/i, '').trim();

  // Expand local shorthand first (SMRR → Saw Mill River Road).
  s = expandLocalAbbreviations(s);

  // Collapse newlines into spaces but preserve token boundaries.
  s = s.replace(/[\r\n]+/g, ' ');

  // Drop punctuation that doesn't carry meaning (keep digits, letters, spaces, hyphens within tokens).
  s = s.replace(/[.,;]/g, ' ');

  // Strip locality tails before unit stripping (locality might contain numbers in zip-style).
  s = s.replace(LOCALITY_RE, ' ');

  // Strip unit/apartment markers.
  s = s.replace(UNIT_RE, ' ');
  s = s.replace(HASH_UNIT_RE, ' ');

  // Strip 5-digit zip codes if any sneak through.
  s = s.replace(/\b\d{5}(?:-\d{4})?\b/g, ' ');

  // Canonicalize street-type abbreviations (as whole words).
  for (const [abbr, full] of STREET_TYPES) {
    s = s.replace(new RegExp(`\\b${abbr}\\b\\.?`, 'g'), full);
  }
  // Canonicalize directionals (whole words) e.g. "n broadway" → "north broadway"
  for (const [abbr, full] of Object.entries(DIRECTIONAL_TYPES)) {
    s = s.replace(new RegExp(`\\b${abbr}\\b\\.?`, 'g'), full);
  }

  // Collapse repeated whitespace and trim.
  s = s.replace(/\s+/g, ' ').trim();

  // Truncate everything after the first canonical street-type word so a
  // dispatch line like "1017 saw mill river road in the lobby near the
  // restroom" reduces to "1017 saw mill river road" — same shape as the ESO
  // scene_address, which makes the similarity score reflect what we care
  // about (the street identity, not trailing description noise).
  const tokens = s.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    if (CANONICAL_STREET_TYPES.has(tokens[i])) {
      s = tokens.slice(0, i + 1).join(' ');
      break;
    }
  }

  return s || null;
}

function extractHouseNumber(normalized) {
  const m = (normalized || '').match(/^(\d+)\b/);
  return m ? m[1] : null;
}

function extractStreetName(normalized) {
  const m = (normalized || '').match(/^\d+\s+(.+)$/);
  return m ? m[1].trim() : (normalized || null);
}

// Plain Levenshtein distance.
function levenshtein(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const dp = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j - 1], dp[j]);
      prev = tmp;
    }
  }
  return dp[lb];
}

/**
 * Similarity 0.0–1.0 of two normalized address strings using
 * 1 - (levenshtein / max(len)). Returns 0 when either string is empty.
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return 1 - (levenshtein(a, b) / maxLen);
}

/**
 * Drop the trailing canonical street type from a normalized address.
 * Used by addressSimilarity to make "100 euclid avenue" comparable to
 * "100 euclid" (ESO frequently omits the street type).
 */
function stripStreetType(normalized) {
  if (!normalized) return normalized;
  const tokens = normalized.split(' ');
  if (tokens.length > 1 && CANONICAL_STREET_TYPES.has(tokens[tokens.length - 1])) {
    return tokens.slice(0, -1).join(' ');
  }
  return normalized;
}

/**
 * Best similarity of two normalized addresses, computed two ways:
 *   1. Full strings as-is.
 *   2. With trailing street type stripped from both sides.
 * The max of the two is returned. This handles the common case where one
 * side records "100 Euclid Avenue" and the other "100 Euclid" — both refer
 * to the same call, but the trailing token tanks the raw Levenshtein score.
 * The risk of false positives (same house# + base name, different types) is
 * negligible in our service area and further constrained by the time window.
 */
function addressSimilarity(a, b) {
  const full     = similarity(a, b);
  const stripped = similarity(stripStreetType(a), stripStreetType(b));
  return Math.max(full, stripped);
}

module.exports = {
  normalizeAddress,
  expandLocalAbbreviations,
  extractHouseNumber,
  extractStreetName,
  similarity,
  addressSimilarity,
  stripStreetType,
  levenshtein,
};
