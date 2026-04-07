/**
 * Personnel Sync Service
 * Fetches the PERSONNEL worksheet from the adult and college dutyboards
 * and tags each DB member with member_type: 'adult' | 'college' | 'both'
 *
 * Name matching uses:
 *  1. Exact match (case-insensitive, cert suffix stripped)
 *  2. Hyphenated-suffix strip  (Greg Khitrov-G → Greg Khitrov)
 *  3. First-name alias map     (Jim → James, Cristopher → Christopher, etc.)
 *  4. Prefix matching on first name (Steve → Steven)
 *  5. Last-name only (if unique in the sheet set)
 */

const https = require('https');
const db    = require('../db/database');

const ADULT_SHEET_ID   = process.env.GOOGLE_SHEET_ID;           // adult dutyboard
const COLLEGE_SHEET_ID = process.env.COLLEGE_SHEET_ID;          // college dutyboard
const API_KEY          = process.env.GOOGLE_API_KEY;

// Known first-name aliases (sheet value → canonical / or variations)
const FIRST_NAME_ALIASES = {
  'jim':        'james',
  'james':      'jim',
  'cristopher': 'christopher',
  'christopher':'cristopher',
  'siddarth':   'siddharth',
  'siddharth':  'siddarth',
  'micheal':    'michael',
  'michael':    'micheal',
  'khaushik':   'kaushik',
  'kaushik':    'khaushik',
  'steve':      'steven',
  'steven':     'steve',
};

function fetchCSV(sheetId, tab) {
  return new Promise((resolve, reject) => {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&key=${API_KEY}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode} fetching ${sheetId}/${tab}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

function parseSheetNames(csv) {
  const SKIP = new Set(['x', 'emt', 'driver', 'pemt', 'emr', 'rider', 'master list', '']);
  const names = new Set();

  for (const line of csv.split('\n')) {
    // Simple CSV split (handles quoted fields)
    const cells = line.match(/("(?:[^"]|"")*"|[^,]*)/g) || [];
    for (const rawCell of cells) {
      const cell = rawCell.replace(/^"|"$/g, '').trim();
      if (!cell || cell.startsWith('NOTE') || SKIP.has(cell.toLowerCase())) continue;
      // Strip certification suffix: "Steve Greenfeld, DEMT " → "Steve Greenfeld"
      const name = cell.replace(/,\s*[A-Z].*$/, '').trim();
      if (name.length > 2) names.add(name.toLowerCase());
    }
  }
  return names;
}

function normDB(name) {
  // Strip hyphenated disambiguation suffixes like "-G", "-M", "-T"
  return name.toLowerCase().replace(/-\w+$/, '').trim();
}

function matchesSheet(dbName, sheetNames) {
  const dn = normDB(dbName);
  const dp = dn.split(' ');
  const dFirst = dp[0];
  const dLast  = dp.slice(1).join(' ');

  for (const sn of sheetNames) {
    // 1. Exact
    if (sn === dn) return true;

    // 2. DB name starts with sheet name (e.g. "Juan Wiley Garcia" ↔ "Juan Wiley")
    if (dLast && sn.split(' ').length > 1) {
      if (dn.startsWith(sn)) return true;
    }

    const sp = sn.split(' ');
    const sFirst = sp[0];
    const sLast  = sp.slice(1).join(' ');

    // 3. Same last name
    if (dLast && sLast && dLast === sLast) {
      // a. Prefix match on first name
      if (dFirst.startsWith(sFirst) || sFirst.startsWith(dFirst)) return true;
      // b. Alias match
      const dAlias = FIRST_NAME_ALIASES[dFirst];
      const sAlias = FIRST_NAME_ALIASES[sFirst];
      if (dAlias === sFirst || sAlias === dFirst) return true;
    }
  }
  return false;
}

async function syncPersonnelTypes() {
  if (!ADULT_SHEET_ID || !API_KEY) {
    console.warn('[personnel] GOOGLE_SHEET_ID or GOOGLE_API_KEY not set — skipping personnel sync');
    return { tagged: 0 };
  }

  // Fetch adult sheet (required), college sheet (optional)
  let adultNames, collegeNames;
  try {
    adultNames = parseSheetNames(await fetchCSV(ADULT_SHEET_ID, 'PERSONNEL'));
  } catch (err) {
    console.error('[personnel] Failed to fetch adult PERSONNEL:', err.message);
    return { tagged: 0 };
  }

  if (COLLEGE_SHEET_ID) {
    try {
      collegeNames = parseSheetNames(await fetchCSV(COLLEGE_SHEET_ID, 'PERSONNEL'));
    } catch (err) {
      console.warn('[personnel] Failed to fetch college PERSONNEL (continuing without):', err.message);
      collegeNames = new Set();
    }
  } else {
    collegeNames = new Set();
  }

  const members = db.prepare("SELECT id, name FROM members WHERE status='active'").all();
  const updateType = db.prepare('UPDATE members SET member_type=? WHERE id=?');

  let tagged = 0;
  const tagMany = db.transaction(() => {
    for (const m of members) {
      const isAdult   = matchesSheet(m.name, adultNames);
      const isCollege = matchesSheet(m.name, collegeNames);

      let type = null;
      if (isAdult && isCollege) type = 'both';
      else if (isAdult)         type = 'adult';
      else if (isCollege)       type = 'college';
      // else remains null (unknown)

      if (type) { updateType.run(type, m.id); tagged++; }
    }
  });
  tagMany();

  console.log(`[personnel] Tagged ${tagged}/${members.length} members (adult=${adultNames.size}, college=${collegeNames.size})`);
  return { tagged, adultSheet: adultNames.size, collegeSheet: collegeNames.size };
}

module.exports = { syncPersonnelTypes };
