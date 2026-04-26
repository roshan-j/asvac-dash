/**
 * Annual Night-Crew Report — XLSX renderer (ExcelJS)
 *
 * Consumes the data structure from annualReportService.buildAnnualReport()
 * and produces a styled .xlsx buffer that mirrors the original PDF report.
 *
 * Uses ExcelJS for parity with reports.js's buildMonthlyWorkbook.
 */

const ExcelJS = require('exceljs');

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const HEADER_LABELS = [
  'Member', 'Rank', 'Role',
  ...MONTH_LABELS,
  'Nights', 'Daytime rides', 'Daytime hrs', 'Total hrs',
];

const COL_COUNT = HEADER_LABELS.length; // 19

// ─── Style palette (matches the PDF and the monthly report's blue ramp) ──────
const NAVY        = 'FF1F4E79';
const BLUE_BAND   = 'FFD9E2F3';  // light blue for crew separator rows
const ALT_ROW     = 'FFF8F9FA';  // alternating row tint
const TEXT        = 'FF1A1A2E';
const MUTED       = 'FF666666';
const SPACER_BG   = 'FFD8D8D8';

const fill  = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const fnt   = (bold = false, argb = TEXT, size = 10) =>
  ({ name: 'Calibri', size, bold, color: { argb } });
const thinBorder = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

const HIDE_ZERO = '#,##0;-#,##0;;@';
const PCT_1     = '0.0%';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function styleCell(cell, { font, fillArgb, alignment, numFmt, border }) {
  if (font)      cell.font      = font;
  if (fillArgb)  cell.fill      = fill(fillArgb);
  if (alignment) cell.alignment = alignment;
  if (numFmt)    cell.numFmt    = numFmt;
  if (border)    cell.border    = border;
}

function mergeAndStyle(ws, row, c1, c2, value, style) {
  ws.mergeCells(row, c1, row, c2);
  const cell = ws.getCell(row, c1);
  cell.value = value;
  styleCell(cell, style);
}

// ─── Main builder ────────────────────────────────────────────────────────────

async function buildAnnualReportXlsxBuffer(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASVAC Dashboard';
  const ws = wb.addWorksheet(`${report.year} Night Crew`);

  // Column widths: Member wider, Rank/Role moderate, months narrow
  ws.columns = [
    { width: 22 }, // A  Member
    { width: 6  }, // B  Rank
    { width: 12 }, // C  Role
    ...new Array(12).fill({ width: 6 }), // D-O  Jan-Dec
    { width: 7  }, // P  Nights
    { width: 13 }, // Q  Daytime rides
    { width: 12 }, // R  Daytime hrs
    { width: 10 }, // S  Total hrs
  ];

  let rowIdx = 1;

  // ── Title block ────────────────────────────────────────────────────────────
  mergeAndStyle(ws, rowIdx, 1, COL_COUNT,
    'Ardsley Secor Volunteer Ambulance Corps',
    {
      font: fnt(true, TEXT, 18),
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
  ws.getRow(rowIdx).height = 26;
  rowIdx++;

  mergeAndStyle(ws, rowIdx, 1, COL_COUNT,
    `${report.year} Crew Hours Report — Including Daytime Rides and Night shifts`,
    {
      font: fnt(false, MUTED, 11),
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
  ws.getRow(rowIdx).height = 18;
  rowIdx++;

  const methodologyText =
    'Methodology. Each on-call night is credited as 8 hours (10:00 PM – 6:00 AM) to every active member of the crew assigned to that night, sourced from the public ASVAC Google Calendar. ' +
    'Each daytime ride (start time outside 10 PM–6 AM, sourced from ESO) earns 2 hours of additional credit, summed annually per member. ' +
    'Full Day Crew (FDC) members and members on Medical / Personnel Leave are excluded from night-crew totals; see footer.';
  mergeAndStyle(ws, rowIdx, 1, COL_COUNT, methodologyText, {
    font: fnt(false, MUTED, 9),
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
  });
  ws.getRow(rowIdx).height = 50;
  rowIdx++;

  rowIdx++; // blank spacer

  // ── Calendar coverage section ─────────────────────────────────────────────
  mergeAndStyle(ws, rowIdx, 1, COL_COUNT, 'Calendar coverage', {
    font: fnt(true, NAVY, 13),
    alignment: { horizontal: 'left' },
  });
  rowIdx++;

  // Coverage header row (4 columns)
  const covHeaders = ['Crew', 'Nights on call', 'Crew-hours', '% of year'];
  covHeaders.forEach((h, i) => {
    const cell = ws.getCell(rowIdx, i + 1);
    cell.value = h;
    styleCell(cell, {
      font: fnt(true, 'FFFFFFFF'),
      fillArgb: NAVY,
      alignment: { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle' },
      border: allBorders,
    });
  });
  rowIdx++;

  for (const row of report.coverage) {
    const isTotal = row.crew === 'Total';
    const nameCell = ws.getCell(rowIdx, 1);
    nameCell.value = row.crew;
    styleCell(nameCell, {
      font: fnt(isTotal, TEXT),
      fillArgb: isTotal ? ALT_ROW : null,
      alignment: { horizontal: 'left', vertical: 'middle' },
      border: allBorders,
    });

    const nightsCell = ws.getCell(rowIdx, 2);
    nightsCell.value = row.nights;
    styleCell(nightsCell, {
      font: fnt(isTotal, TEXT),
      fillArgb: isTotal ? ALT_ROW : null,
      alignment: { horizontal: 'right', vertical: 'middle' },
      border: allBorders,
    });

    const hoursCell = ws.getCell(rowIdx, 3);
    hoursCell.value = row.hours;
    styleCell(hoursCell, {
      font: fnt(isTotal, TEXT),
      fillArgb: isTotal ? ALT_ROW : null,
      alignment: { horizontal: 'right', vertical: 'middle' },
      border: allBorders,
    });

    const pctCell = ws.getCell(rowIdx, 4);
    pctCell.value = row.pctOfYear;
    styleCell(pctCell, {
      font: fnt(isTotal, TEXT),
      fillArgb: isTotal ? ALT_ROW : null,
      alignment: { horizontal: 'right', vertical: 'middle' },
      numFmt: PCT_1,
      border: allBorders,
    });
    rowIdx++;
  }

  rowIdx++; // spacer

  // ── Hours-by-member section ───────────────────────────────────────────────
  mergeAndStyle(ws, rowIdx, 1, COL_COUNT, 'Hours by member — monthly breakdown', {
    font: fnt(true, NAVY, 13),
    alignment: { horizontal: 'left' },
  });
  rowIdx++;

  // Header row
  HEADER_LABELS.forEach((label, i) => {
    const cell = ws.getCell(rowIdx, i + 1);
    cell.value = label;
    styleCell(cell, {
      font: fnt(true, 'FFFFFFFF'),
      fillArgb: NAVY,
      alignment: { horizontal: i < 3 ? 'left' : 'center', vertical: 'middle' },
      border: allBorders,
    });
  });
  rowIdx++;

  // Per-crew section
  const ROLE_ORDER = { 'Crew Chief': 0, 'Driver': 1, 'Non-Driver': 2 };

  for (const crew of report.crews) {
    // Crew band row (merged across all columns)
    mergeAndStyle(ws, rowIdx, 1, COL_COUNT,
      `Crew ${crew.number} — ${crew.nights} nights (${crew.hours} hrs of coverage)`,
      {
        font: fnt(true, NAVY, 11),
        fillArgb: BLUE_BAND,
        alignment: { horizontal: 'left', vertical: 'middle' },
        border: allBorders,
      });
    rowIdx++;

    // Sort members: Crew Chief, Driver, Non-Driver, by name within
    const members = [...crew.members].sort((a, b) => {
      const aRole = ROLE_ORDER[a.role] ?? 9;
      const bRole = ROLE_ORDER[b.role] ?? 9;
      if (aRole !== bRole) return aRole - bRole;
      return a.name.localeCompare(b.name);
    });

    members.forEach((m, idx) => {
      const evenRow = idx % 2 === 0;
      const rowFill = evenRow ? ALT_ROW : null;

      // Member, Rank, Role
      [m.name, m.rank ?? '', m.role ?? ''].forEach((v, i) => {
        const cell = ws.getCell(rowIdx, i + 1);
        cell.value = v;
        styleCell(cell, {
          font: fnt(false, TEXT),
          fillArgb: rowFill,
          alignment: { horizontal: 'left', vertical: 'middle', indent: i === 0 ? 1 : 0 },
          border: allBorders,
        });
      });

      // Months Jan-Dec
      m.monthly.forEach((v, i) => {
        const cell = ws.getCell(rowIdx, i + 4);
        cell.value = v || null;
        styleCell(cell, {
          font: fnt(false, TEXT),
          fillArgb: rowFill,
          alignment: { horizontal: 'right', vertical: 'middle' },
          numFmt: HIDE_ZERO,
          border: allBorders,
        });
      });

      // Nights
      const nCell = ws.getCell(rowIdx, 16);
      nCell.value = m.nights;
      styleCell(nCell, {
        font: fnt(false, TEXT),
        fillArgb: rowFill,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: HIDE_ZERO,
        border: allBorders,
      });

      // Daytime rides (count) — multiplied by 2 to give Daytime hrs
      const drCell = ws.getCell(rowIdx, 17);
      drCell.value = m.daytimeRides;
      styleCell(drCell, {
        font: fnt(false, TEXT),
        fillArgb: rowFill,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: HIDE_ZERO,
        border: allBorders,
      });

      // Daytime hrs (= Daytime rides × 2)
      const dCell = ws.getCell(rowIdx, 18);
      dCell.value = m.daytimeHrs;
      styleCell(dCell, {
        font: fnt(false, TEXT),
        fillArgb: rowFill,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: HIDE_ZERO,
        border: allBorders,
      });

      // Total hrs (bold)
      const tCell = ws.getCell(rowIdx, 19);
      tCell.value = m.totalHrs;
      styleCell(tCell, {
        font: fnt(true, TEXT),
        fillArgb: rowFill,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: HIDE_ZERO,
        border: allBorders,
      });

      rowIdx++;
    });
  }

  // ── FDC daytime contributions ─────────────────────────────────────────────
  // Full Day Crew members don't take night shifts but DO ride during the day.
  // Show their daytime credit on its own line so it's visible alongside the
  // night-crew totals. Only members with at least one daytime ride appear.
  if (report.fdcContributions && report.fdcContributions.length > 0) {
    rowIdx++; // spacer

    mergeAndStyle(ws, rowIdx, 1, COL_COUNT,
      'Full Day Crew — daytime contributions (no night-shift hours)', {
        font: fnt(true, NAVY, 11),
        fillArgb: BLUE_BAND,
        alignment: { horizontal: 'left', vertical: 'middle' },
        border: allBorders,
      });
    rowIdx++;

    report.fdcContributions.forEach((m, idx) => {
      const evenRow = idx % 2 === 0;
      const rowFill = evenRow ? ALT_ROW : null;

      // Member, Rank, Role columns (with crew number appended to role for context)
      const roleWithCrew = m.role ? `${m.role} (Crew ${m.crew})` : `Crew ${m.crew}`;
      [m.name, m.rank ?? '', roleWithCrew].forEach((v, i) => {
        const cell = ws.getCell(rowIdx, i + 1);
        cell.value = v;
        styleCell(cell, {
          font: fnt(false, TEXT),
          fillArgb: rowFill,
          alignment: { horizontal: 'left', vertical: 'middle', indent: i === 0 ? 1 : 0 },
          border: allBorders,
        });
      });

      // Months Jan-Dec — empty for FDC (they don't have night hours)
      for (let i = 0; i < 12; i++) {
        const cell = ws.getCell(rowIdx, i + 4);
        cell.value = null;
        styleCell(cell, {
          font: fnt(false, TEXT),
          fillArgb: rowFill,
          alignment: { horizontal: 'right', vertical: 'middle' },
          numFmt: HIDE_ZERO,
          border: allBorders,
        });
      }

      // Nights = 0
      const nCell = ws.getCell(rowIdx, 16);
      nCell.value = null;
      styleCell(nCell, {
        font: fnt(false, TEXT),
        fillArgb: rowFill,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: HIDE_ZERO,
        border: allBorders,
      });

      // Daytime rides
      const drCell = ws.getCell(rowIdx, 17);
      drCell.value = m.daytimeRides;
      styleCell(drCell, {
        font: fnt(false, TEXT),
        fillArgb: rowFill,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: HIDE_ZERO,
        border: allBorders,
      });

      // Daytime hrs
      const dCell = ws.getCell(rowIdx, 18);
      dCell.value = m.daytimeHrs;
      styleCell(dCell, {
        font: fnt(false, TEXT),
        fillArgb: rowFill,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: HIDE_ZERO,
        border: allBorders,
      });

      // Total hrs (= daytime hrs only)
      const tCell = ws.getCell(rowIdx, 19);
      tCell.value = m.totalHrs;
      styleCell(tCell, {
        font: fnt(true, TEXT),
        fillArgb: rowFill,
        alignment: { horizontal: 'right', vertical: 'middle' },
        numFmt: HIDE_ZERO,
        border: allBorders,
      });

      rowIdx++;
    });
  }

  rowIdx++; // spacer

  // ── Notes & exclusions footer ─────────────────────────────────────────────
  mergeAndStyle(ws, rowIdx, 1, COL_COUNT, 'Notes & exclusions', {
    font: fnt(true, NAVY, 13),
    alignment: { horizontal: 'left' },
  });
  rowIdx++;

  const fmtList = items => items.map(e => `${e.name} (Crew ${e.crew})`).join(', ');

  const fdcLine = 'Excluded as Full Day Crew (FDC): ' +
    (report.exclusions.fdc.length ? fmtList(report.exclusions.fdc) + '.' : 'none.');
  mergeAndStyle(ws, rowIdx, 1, COL_COUNT, fdcLine, {
    font: fnt(false, TEXT, 10),
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
  });
  rowIdx++;

  const leaveLine = 'Excluded as Medical / Personnel Leave: ' +
    (report.exclusions.leave.length ? fmtList(report.exclusions.leave) + '.' : 'none.');
  mergeAndStyle(ws, rowIdx, 1, COL_COUNT, leaveLine, {
    font: fnt(false, TEXT, 10),
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
  });
  rowIdx++;

  if (report.exclusions.probationary && report.exclusions.probationary.length > 0) {
    const probLine = 'Probationary members (no line items — not yet eligible for full night-crew totals): ' +
      fmtList(report.exclusions.probationary) + '.';
    mergeAndStyle(ws, rowIdx, 1, COL_COUNT, probLine, {
      font: fnt(false, TEXT, 10),
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
    });
    ws.getRow(rowIdx).height = 28;
    rowIdx++;
  }

  const cycleLine = 'Cycle: Crews rotate on a 6-crew, 3-night cycle (each crew on call for 3 consecutive nights every 18 days).';
  mergeAndStyle(ws, rowIdx, 1, COL_COUNT, cycleLine, {
    font: fnt(false, TEXT, 10),
    alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
  });
  rowIdx++;

  if (report.meta.daytimeRideRowsUnparsed > 0) {
    const warnLine =
      `Note: ${report.meta.daytimeRideRowsUnparsed} ESO ride record(s) lacked a parseable start time and were excluded from the daytime-hours calculation.`;
    mergeAndStyle(ws, rowIdx, 1, COL_COUNT, warnLine, {
      font: fnt(false, MUTED, 10),
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true },
    });
    rowIdx++;
  }

  // Freeze the title rows + header so scrolling keeps them visible
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 5 }];

  return wb.xlsx.writeBuffer();
}

module.exports = { buildAnnualReportXlsxBuffer };
