/**
 * attendanceParser.js
 *
 * Parses CSV attendance exports (three observed formats) and fuzzy-matches
 * display names against DB members.
 *
 * Format A — Tony's meeting export:
 *   Headers: "Meeting Start Time", "Display Name"
 *   All rows share the same timestamp (bulk sign-in)
 *
 * Format B — Nisha's meeting export:
 *   Row 0: blank, "Month Monthly Meeting Attendance" (title)
 *   Subsequent rows: serial-date, Name
 *
 * Format C — Tony's training export:
 *   Headers: "Name", "CME - ..." (date column)
 *   Blank rows with section header in col A between groups
 */

const db = require('../db/database');

// ─── Month name → number ───────────────────────────────────────────────────
const MONTH_NAMES = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

function monthFromName(text) {
  const lower = (text || '').toLowerCase();
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (lower.includes(name)) return num;
  }
  return null;
}

// Parse "M/D/YY HH:MM" or "M/D/YYYY" → { year, month }
function parseDate(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  return { year, month: parseInt(m[1], 10) };
}

// ─── Format detection ──────────────────────────────────────────────────────

function detectFormat(rows) {
  if (!rows || rows.length < 2) return null;
  const header = rows[0];

  // Format A: first header is "Meeting Start Time"
  if (header[0] && header[0].toLowerCase().includes('meeting start time')) return 'A';

  // Format B: first cell blank/empty, second cell contains "attendance" or "meeting"
  const secondCell = (header[1] || '').toLowerCase();
  if ((!header[0] || !header[0].trim()) &&
      (secondCell.includes('attendance') || secondCell.includes('meeting'))) return 'B';

  // Format C: first header is "Name" (case-insensitive) and second is a CME-style col
  const firstName = (header[0] || '').toLowerCase().trim();
  if (firstName === 'name') return 'C';

  return null;
}

// ─── Row extractors ────────────────────────────────────────────────────────

function extractFormatA(rows) {
  // Row 0 = header; subsequent rows = [timestamp, displayName]
  const names = [];
  let year = null, month = null;

  for (let i = 1; i < rows.length; i++) {
    const [ts, name] = rows[i];
    if (!name || !name.trim()) continue;
    names.push(name.trim());
    if (!year) {
      const d = parseDate(ts);
      if (d) ({ year, month } = d);
    }
  }
  return { names, year, month, type: 'meeting' };
}

function extractFormatB(rows) {
  // Row 0 = [blank, "Month Monthly Meeting Attendance"] title row
  const titleText = rows[0][1] || rows[0][0] || '';
  const month = monthFromName(titleText);

  const names = [];
  let year = null;

  for (let i = 1; i < rows.length; i++) {
    const [dateLike, name] = rows[i];
    if (!name || !name.trim()) continue;
    // Skip header-like rows
    if (name.toLowerCase().includes('attendance') || name.toLowerCase().includes('meeting')) continue;
    names.push(name.trim());
    if (!year) {
      const d = parseDate(dateLike);
      if (d) year = d.year;
    }
  }

  // Fallback: derive year from current date if not found in data
  if (!year) year = new Date().getFullYear();

  return { names, year, month, type: 'meeting' };
}

function extractFormatC(rows) {
  // Row 0 = ["Name", "CME - ..."] header; blank rows = section separators
  const names = [];
  let year = null, month = null;

  for (let i = 1; i < rows.length; i++) {
    const [name, dateLike] = rows[i];
    if (!name || !name.trim()) continue;
    // Section header rows (e.g. ",CME - EMTs") — name col is blank
    if (!dateLike && !name.includes(',')) {
      // This row might be a section header with name in col A like "CME - EMTs"
      if (name.toLowerCase().includes('cme') || name.toLowerCase().includes('emt')) continue;
    }
    // Skip rows where name looks like a header
    if (name.toLowerCase() === 'name') continue;
    names.push(name.trim());
    if (!year) {
      const d = parseDate(dateLike);
      if (d) ({ year, month } = d);
    }
  }

  return { names, year, month, type: 'training' };
}

// ─── Name matching ─────────────────────────────────────────────────────────

const lookupAlias = db.prepare('SELECT member_id FROM member_aliases WHERE alias = lower(?)');

function levenshtein(a, b) {
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[la][lb];
}

function matchName(rawName, members) {
  const lower = rawName.toLowerCase().trim();
  const rawFirst = lower.split(/\s+/)[0];

  // 1. Alias table
  const aliasRow = lookupAlias.get(lower);
  if (aliasRow) {
    const m = members.find(m => m.id === aliasRow.member_id);
    if (m) return { memberId: m.id, memberName: m.name, confidence: 'exact' };
  }

  // 2. Exact case-insensitive
  const exact = members.find(m => m.name.toLowerCase() === lower);
  if (exact) return { memberId: exact.id, memberName: exact.name, confidence: 'exact' };

  // 3. First-name-only: if only ONE active member has this first name
  const firstMatches = members.filter(m => m.name.toLowerCase().split(/\s+/)[0] === rawFirst);
  if (firstMatches.length === 1) {
    return { memberId: firstMatches[0].id, memberName: firstMatches[0].name, confidence: 'first_name' };
  }

  // 3b. Word-subset match: all words in rawName appear as tokens at the start of member name words
  //     Handles "Juan Wiley" → "Juan Wiley Garcia" and "Chris Rich" → "Christopher Rich"
  //     Require min 3 chars to avoid single-initial false positives ("C" matching "Chris")
  const rawTokens = lower.split(/\s+/);
  const subsetMatches = members.filter(m => {
    const mTokens = m.name.toLowerCase().split(/\s+/);
    return rawTokens.every(rt =>
      mTokens.some(mt =>
        mt === rt ||
        (rt.length >= 3 && mt.startsWith(rt)) ||   // "chris" prefix of "christopher"
        (mt.length >= 3 && rt.startsWith(mt))        // "christopher" starts with "chris" reversed
      )
    );
  });
  if (subsetMatches.length === 1) {
    return { memberId: subsetMatches[0].id, memberName: subsetMatches[0].name, confidence: 'partial' };
  }
  // If multiple subset matches, prefer those where first token is an exact match
  if (subsetMatches.length > 1) {
    const exactFirstMatches = subsetMatches.filter(m =>
      m.name.toLowerCase().split(/\s+/)[0] === rawFirst
    );
    const pool = exactFirstMatches.length > 0 ? exactFirstMatches : subsetMatches;
    const canonical = pool.reduce((a, b) => a.id < b.id ? a : b);
    return { memberId: canonical.id, memberName: canonical.name, confidence: 'partial' };
  }

  // 4. Fuzzy: Levenshtein ≤ 2 on full name (tight threshold to avoid false positives)
  const scored = members
    .map(m => ({ m, dist: levenshtein(lower, m.name.toLowerCase()) }))
    .sort((a, b) => a.dist - b.dist);

  if (scored[0].dist <= 2) {
    const best = scored[0].m;
    return { memberId: best.id, memberName: best.name, confidence: 'fuzzy' };
  }

  // 5. Unmatched — return top suggestions
  const suggestions = scored.slice(0, 3).map(s => ({ name: s.m.name, score: s.dist }));
  return { memberId: null, memberName: null, confidence: 'none', suggestions };
}

// ─── Main parse function ───────────────────────────────────────────────────

function parseAttendanceCSV(csvText, filename) {
  // Minimal CSV parser (handles quoted fields)
  function parseCSV(text) {
    const rows = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) { rows.push([]); continue; }
      const cells = [];
      let i = 0;
      while (i < line.length) {
        if (line[i] === '"') {
          let j = i + 1;
          while (j < line.length && !(line[j] === '"' && line[j + 1] !== '"')) j++;
          cells.push(line.slice(i + 1, j).replace(/""/g, '"'));
          i = j + 2;
        } else {
          const end = line.indexOf(',', i);
          cells.push(end === -1 ? line.slice(i) : line.slice(i, end));
          i = end === -1 ? line.length : end + 1;
        }
      }
      rows.push(cells);
    }
    return rows.filter(r => r.length > 0);
  }

  const rows = parseCSV(csvText);
  const format = detectFormat(rows);
  if (!format) return { error: 'Unknown CSV format — could not detect attendance sheet type.' };

  let extracted;
  if (format === 'A') extracted = extractFormatA(rows);
  else if (format === 'B') extracted = extractFormatB(rows);
  else extracted = extractFormatC(rows);

  const { names, year, month, type } = extracted;

  // Load active members
  const members = db.prepare("SELECT id, name FROM members WHERE status = 'active'").all();

  const matched = [];
  const unmatched = [];

  for (const rawName of names) {
    if (!rawName) continue;
    const result = matchName(rawName, members);
    if (result.memberId) {
      matched.push({ rawName, ...result });
    } else {
      unmatched.push({ rawName, suggestions: result.suggestions || [] });
    }
  }

  return { format, year, month, type, matched, unmatched, totalNames: names.length };
}

module.exports = { parseAttendanceCSV };
