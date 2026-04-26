/**
 * Annual Night-Crew Report — XLSX renderer
 *
 * Consumes the data structure from annualReportService.buildAnnualReport()
 * and produces a styled .xlsx buffer that mirrors the PDF report layout:
 *   - Title + subtitle + methodology block (merged across the table width)
 *   - Calendar coverage table (4 cols)
 *   - Per-crew hours table (Member..Dec, Nights, Daytime hrs, Total hrs)
 *     with crew section bands
 *   - Notes & exclusions footer
 */

const XLSX = require('xlsx-js-style');

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Member-table headers
const MEMBER_HEADERS = [
  'Member', 'Rank', 'Role',
  ...MONTH_LABELS,
  'Nights', 'Daytime hrs', 'Total hrs',
];

const COL_COUNT = MEMBER_HEADERS.length; // 18

// ─── Style palette (matches the PDF's blue ramp) ─────────────────────────────

const C = {
  navy:       '1F4E79',
  blueBand:   'D9E2F3',  // light blue for crew separators
  alt:        'F2F6FC',  // very light blue for alternating rows
  text:       '1F2E4D',
  muted:      '666666',
  border:     'BFBFBF',
};

const border = { style: 'thin', color: { rgb: C.border } };
const allBorders = { top: border, bottom: border, left: border, right: border };

const styles = {
  title: {
    font: { bold: true, sz: 18, color: { rgb: C.text } },
    alignment: { horizontal: 'center', vertical: 'center' },
  },
  subtitle: {
    font: { italic: true, sz: 11, color: { rgb: C.muted } },
    alignment: { horizontal: 'center', vertical: 'center' },
  },
  methodology: {
    font: { sz: 9, color: { rgb: C.muted } },
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
  },
  sectionH: {
    font: { bold: true, sz: 13, color: { rgb: C.navy } },
    alignment: { horizontal: 'left' },
  },
  th: {
    fill: { patternType: 'solid', fgColor: { rgb: C.navy } },
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: allBorders,
  },
  thLeft: {
    fill: { patternType: 'solid', fgColor: { rgb: C.navy } },
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: allBorders,
  },
  cell: {
    font: { sz: 10, color: { rgb: C.text } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: allBorders,
  },
  cellRight: {
    font: { sz: 10, color: { rgb: C.text } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: allBorders,
  },
  cellBold: {
    font: { sz: 10, bold: true, color: { rgb: C.text } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: allBorders,
  },
  pct: {
    font: { sz: 10, color: { rgb: C.text } },
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '0.0%',
    border: allBorders,
  },
  totalRow: {
    fill: { patternType: 'solid', fgColor: { rgb: C.alt } },
    font: { sz: 10, bold: true, color: { rgb: C.text } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: allBorders,
  },
  totalRowLeft: {
    fill: { patternType: 'solid', fgColor: { rgb: C.alt } },
    font: { sz: 10, bold: true, color: { rgb: C.text } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: allBorders,
  },
  crewBand: {
    fill: { patternType: 'solid', fgColor: { rgb: C.blueBand } },
    font: { bold: true, sz: 11, color: { rgb: C.navy } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: allBorders,
  },
  footerLabel: {
    font: { bold: true, sz: 10, color: { rgb: C.text } },
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
  },
  footerText: {
    font: { sz: 10, color: { rgb: C.text } },
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
  },
};

// ─── Cell helpers ─────────────────────────────────────────────────────────────

function s(value, style)  { return { v: value, t: 's', s: style }; }
function n(value, style)  { return { v: value, t: 'n', s: style }; }
function blank()          { return { v: '', t: 's' }; }

function addr(r, c) { return XLSX.utils.encode_cell({ r, c }); }

// ─── Main builder ─────────────────────────────────────────────────────────────

function buildAnnualReportXlsx(report) {
  const ws = {};
  const merges = [];
  let rowIdx = 0;

  function setCell(r, c, cellObj) {
    ws[addr(r, c)] = cellObj;
  }
  function setRow(r, cells, fillStyle) {
    cells.forEach((cell, c) => {
      if (cell != null) {
        setCell(r, c, cell);
      } else if (fillStyle) {
        setCell(r, c, { v: '', t: 's', s: fillStyle });
      }
    });
  }
  function mergeCells(r, c1, c2, cell) {
    setCell(r, c1, cell);
    if (c2 > c1) merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });
  }

  // ── Title block ─────────────────────────────────────────────────────────
  mergeCells(rowIdx, 0, COL_COUNT - 1, s('Ardsley Secor Volunteer Ambulance Corps', styles.title));
  rowIdx++;

  mergeCells(rowIdx, 0, COL_COUNT - 1,
    s(`${report.year} Night-Crew Hours Report — 10:00 PM – 6:00 AM Shift`, styles.subtitle));
  rowIdx++;

  const methodologyText =
    'Methodology. Each on-call night is credited as 8 hours (10:00 PM – 6:00 AM) to every active member of the crew assigned to that night, sourced from the public ASVAC Google Calendar. ' +
    'Each daytime ride (start time outside 10 PM–6 AM, sourced from ESO) earns 2 hours of additional credit, summed annually per member. ' +
    'Full Day Crew (FDC) members and members on Medical / Personnel Leave are excluded from night-crew totals; see footer.';
  mergeCells(rowIdx, 0, COL_COUNT - 1, s(methodologyText, styles.methodology));
  rowIdx++; // methodology row gets extra height set below
  const methodologyRow = rowIdx - 1;

  rowIdx++; // blank spacer row

  // ── Calendar coverage section ───────────────────────────────────────────
  mergeCells(rowIdx, 0, COL_COUNT - 1, s('Calendar coverage', styles.sectionH));
  rowIdx++;

  // 4-col coverage table — left-aligned in columns 0..3
  setRow(rowIdx, [
    s('Crew',          styles.thLeft),
    s('Nights on call',styles.th),
    s('Crew-hours',    styles.th),
    s('% of year',     styles.th),
  ]);
  rowIdx++;

  for (const row of report.coverage) {
    const isTotal = row.crew === 'Total';
    setRow(rowIdx, [
      s(row.crew, isTotal ? styles.totalRowLeft : styles.cell),
      n(row.nights, isTotal ? styles.totalRow : styles.cellRight),
      n(row.hours,  isTotal ? styles.totalRow : styles.cellRight),
      n(row.pctOfYear, { ...(isTotal ? styles.totalRow : styles.pct), numFmt: '0.0%' }),
    ]);
    rowIdx++;
  }

  rowIdx++; // spacer

  // ── Hours-by-member section ─────────────────────────────────────────────
  mergeCells(rowIdx, 0, COL_COUNT - 1,
    s('Hours by member — monthly breakdown', styles.sectionH));
  rowIdx++;

  // Header row
  setRow(rowIdx, MEMBER_HEADERS.map((h, i) => s(h, i < 3 ? styles.thLeft : styles.th)));
  rowIdx++;

  for (const crew of report.crews) {
    // Crew band
    mergeCells(rowIdx, 0, COL_COUNT - 1,
      s(`Crew ${crew.number} — ${crew.nights} nights (${crew.hours} hrs of coverage)`,
        styles.crewBand));
    rowIdx++;

    // Sort members by role priority then name (Crew Chief first, etc.)
    const ROLE_ORDER = { 'Crew Chief': 0, 'Driver': 1, 'Non-Driver': 2 };
    const members = [...crew.members].sort((a, b) => {
      const aRole = ROLE_ORDER[a.role] ?? 9;
      const bRole = ROLE_ORDER[b.role] ?? 9;
      if (aRole !== bRole) return aRole - bRole;
      return a.name.localeCompare(b.name);
    });

    for (const m of members) {
      const cells = [
        s(m.name,  styles.cell),
        s(m.rank ?? '', styles.cell),
        s(m.role ?? '', styles.cell),
        ...m.monthly.map(v => v ? n(v, styles.cellRight) : s('', styles.cellRight)),
        n(m.nights, styles.cellRight),
        n(m.daytimeHrs, styles.cellRight),
        n(m.totalHrs, styles.cellBold),
      ];
      setRow(rowIdx, cells);
      rowIdx++;
    }
  }

  rowIdx++; // spacer

  // ── Notes & exclusions footer ───────────────────────────────────────────
  mergeCells(rowIdx, 0, COL_COUNT - 1, s('Notes & exclusions', styles.sectionH));
  rowIdx++;

  function fmtList(items) {
    return items.map(e => `${e.name} (Crew ${e.crew})`).join(', ');
  }

  const fdcLine =
    'Excluded as Full Day Crew (FDC): ' +
    (report.exclusions.fdc.length ? fmtList(report.exclusions.fdc) + '.' : 'none.');
  mergeCells(rowIdx, 0, COL_COUNT - 1, s(fdcLine, styles.footerText));
  rowIdx++;

  const leaveLine =
    'Excluded as Medical / Personnel Leave: ' +
    (report.exclusions.leave.length ? fmtList(report.exclusions.leave) + '.' : 'none.');
  mergeCells(rowIdx, 0, COL_COUNT - 1, s(leaveLine, styles.footerText));
  rowIdx++;

  const cycleLine =
    'Cycle: Crews rotate on a 6-crew, 3-night cycle (each crew on call for 3 consecutive nights every 18 days).';
  mergeCells(rowIdx, 0, COL_COUNT - 1, s(cycleLine, styles.footerText));
  rowIdx++;

  if (report.meta.daytimeRideRowsUnparsed > 0) {
    const warnLine =
      `Note: ${report.meta.daytimeRideRowsUnparsed} ESO ride record(s) lacked a parseable start time and were excluded from the daytime-hours calculation.`;
    mergeCells(rowIdx, 0, COL_COUNT - 1, s(warnLine, styles.footerText));
    rowIdx++;
  }

  // ── Worksheet metadata ──────────────────────────────────────────────────
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: rowIdx - 1, c: COL_COUNT - 1 },
  });
  ws['!merges'] = merges;

  // Column widths: Member wider, Rank/Role moderate, months narrow
  ws['!cols'] = [
    { wch: 22 },  // Member
    { wch: 6 },   // Rank
    { wch: 12 },  // Role
    ...new Array(12).fill({ wch: 6 }), // Months
    { wch: 7 },   // Nights
    { wch: 12 },  // Daytime hrs
    { wch: 10 },  // Total hrs
  ];

  // Row heights: title taller, methodology much taller (it wraps)
  ws['!rows'] = [];
  ws['!rows'][0] = { hpt: 26 };  // title
  ws['!rows'][1] = { hpt: 18 };  // subtitle
  ws['!rows'][methodologyRow] = { hpt: 50 };  // methodology wrap

  // ── Pack into workbook ──────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${report.year} Night Crew`);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
}

module.exports = { buildAnnualReportXlsx };
