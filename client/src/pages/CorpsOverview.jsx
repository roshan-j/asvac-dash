import { useState, useMemo, useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import { getCorpsTrend, getCorpsMonth, getLeaderboard, getPeriods, getDispatchReport } from '../api/client';
import CorpsTrendChart from '../components/Charts/CorpsTrendChart';
import RidesHistogramChart from '../components/Charts/RidesHistogramChart';
import CrewPerCallChart from '../components/Charts/CrewPerCallChart';
import { formatPeriod } from '../utils/format';

// ─── StatCard with hover tooltip ──────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#1a3a6b', tooltip }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{ ...styles.statCard, position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ ...styles.statValue, color }}>{value ?? '—'}</div>
      <div style={styles.statLabel}>{label}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
      {tooltip && hovered && (
        <div style={styles.tooltip}>
          {tooltip.map((line, i) => (
            <div key={i} style={styles.tooltipLine}>
              <span style={styles.tooltipKey}>{line.label}</span>
              <span style={styles.tooltipVal}>{line.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dispatch response panel ───────────────────────────────────────────────────
// Renders the result of /api/data/dispatches/match-report. The user said
// address match rate is the confidence signal, so this surfaces both the
// match rate AND the confidence-band distribution + monthly breakdown.
function DispatchPanel({ report }) {
  const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
  const matchedPct = report.total > 0 ? report.matched / report.total : 0;
  const inAreaPct  = report.total > 0 ? report.inAreaGap / report.total : 0;
  const outPct     = report.total > 0 ? report.outOfArea / report.total : 0;
  const unparsePct = report.total > 0 ? report.unparseable / report.total : 0;

  return (
    <div>
      {/* Top-line: the in-area gap is the operationally important number. */}
      <div style={dispatchStyles.topRow}>
        <div style={{ ...dispatchStyles.bigStat, borderColor: '#c34a4a' }}>
          <div style={{ ...dispatchStyles.bigValue, color: '#c34a4a' }}>{report.inAreaGap}</div>
          <div style={dispatchStyles.bigLabel}>In-area coverage gap</div>
          <div style={dispatchStyles.bigSub}>
            Dispatched to our area, no ESO record — went to another agency<br/>
            {pct(report.inAreaGap, report.total)} of {report.total} dispatches
          </div>
        </div>
        <div style={{ ...dispatchStyles.bigStat, borderColor: '#1a7f4b' }}>
          <div style={{ ...dispatchStyles.bigValue, color: '#1a7f4b' }}>{report.matched}</div>
          <div style={dispatchStyles.bigLabel}>Responded</div>
          <div style={dispatchStyles.bigSub}>
            Matched to an ESO call ({pct(report.matched, report.total)})
          </div>
        </div>
        <div style={{ ...dispatchStyles.bigStat, borderColor: '#aaa' }}>
          <div style={{ ...dispatchStyles.bigValue, color: '#666' }}>{report.outOfArea + report.unparseable}</div>
          <div style={dispatchStyles.bigLabel}>Other-agency / highway</div>
          <div style={dispatchStyles.bigSub}>
            {report.outOfArea} explicit aid-out, {report.unparseable} highway/MVA<br/>
            Never expected to be ours
          </div>
        </div>
      </div>

      {/* Horizontal proportion bar — 4 segments */}
      <div style={dispatchStyles.proportionBar} title="Responded / In-area gap / Out-of-area / Unparseable">
        <div style={{ ...dispatchStyles.barSegment, width: `${matchedPct * 100}%`, background: '#1a7f4b' }} title={`Responded: ${report.matched}`} />
        <div style={{ ...dispatchStyles.barSegment, width: `${inAreaPct * 100}%`,  background: '#c34a4a' }} title={`In-area gap: ${report.inAreaGap}`} />
        <div style={{ ...dispatchStyles.barSegment, width: `${outPct * 100}%`,     background: '#aaaaaa' }} title={`Out-of-area: ${report.outOfArea}`} />
        <div style={{ ...dispatchStyles.barSegment, width: `${unparsePct * 100}%`, background: '#cccccc' }} title={`Unparseable: ${report.unparseable}`} />
      </div>

      <div style={dispatchStyles.dist}>
        <strong>Match confidence:</strong>{' '}
        ≥0.95: <code>{report.distribution.bucket_95_100}</code>
        {' · '}0.90–0.95: <code>{report.distribution.bucket_90_95}</code>
        {' · '}0.85–0.90: <code>{report.distribution.bucket_85_90}</code>
        {'  ·  '}<strong>ESO scene-address coverage:</strong> {Math.round(report.esoAddressCoverage * 100)}%
      </div>

      {/* Monthly breakdown */}
      <div style={dispatchStyles.monthlyWrap}>
        <table style={dispatchStyles.monthlyTable}>
          <thead>
            <tr>
              {['Month', 'Total', 'Responded', 'In-area gap', 'Out-of-area', 'Unparseable'].map(h =>
                <th key={h} style={dispatchStyles.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {report.byMonth.map(m => (
              <tr key={m.month} style={dispatchStyles.tr}>
                <td style={dispatchStyles.td}>{new Date(2000, m.month - 1).toLocaleString('default', { month: 'long' })}</td>
                <td style={{ ...dispatchStyles.td, textAlign: 'right' }}>{m.total}</td>
                <td style={{ ...dispatchStyles.td, textAlign: 'right', color: '#1a7f4b', fontWeight: 600 }}>{m.matched}</td>
                <td style={{ ...dispatchStyles.td, textAlign: 'right', color: '#c34a4a', fontWeight: 700 }}>{m.inAreaGap}</td>
                <td style={{ ...dispatchStyles.td, textAlign: 'right', color: '#666' }}>{m.outOfArea}</td>
                <td style={{ ...dispatchStyles.td, textAlign: 'right', color: '#888' }}>{m.unparseable}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Spot-check samples — collapsed by default */}
      <details style={dispatchStyles.samples}>
        <summary style={dispatchStyles.summary}>
          Spot-check samples ({report.samples.matched.length} matched, {report.samples.unmatched.length} unmatched)
        </summary>
        <div style={dispatchStyles.sampleBlock}>
          <h4 style={dispatchStyles.sampleHeader}>Highest-confidence matches</h4>
          <table style={dispatchStyles.monthlyTable}>
            <thead><tr>{['Date', 'Time', 'Dispatch address', 'ESO scene address', 'Score'].map(h => <th key={h} style={dispatchStyles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {report.samples.matched.slice(0, 8).map((s, i) => (
                <tr key={i} style={dispatchStyles.tr}>
                  <td style={dispatchStyles.td}>{s.dispatch_date}</td>
                  <td style={dispatchStyles.td}>{s.dispatch_time}</td>
                  <td style={{ ...dispatchStyles.td, fontSize: 12 }}>{(s.dispatchAddress || '').replace(/\n/g, ' / ')}</td>
                  <td style={{ ...dispatchStyles.td, fontSize: 12 }}>{s.esoAddress}</td>
                  <td style={{ ...dispatchStyles.td, textAlign: 'right' }}>{s.score?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={dispatchStyles.sampleBlock}>
          <h4 style={dispatchStyles.sampleHeader}>Recent unmatched (in-area gaps shown first)</h4>
          <table style={dispatchStyles.monthlyTable}>
            <thead><tr>{['Date', 'Time', 'Category', 'Dispatch address', 'Description'].map(h => <th key={h} style={dispatchStyles.th}>{h}</th>)}</tr></thead>
            <tbody>
              {report.samples.unmatched.slice(0, 12).map((s, i) => {
                const tag = s.aidCategory === 'in_area_gap'
                  ? { label: 'In-area gap', color: '#c34a4a', bg: '#fde2e2' }
                  : s.aidCategory === 'out_of_area'
                  ? { label: 'Other agency',  color: '#666',    bg: '#eee' }
                  : { label: 'Unparseable',  color: '#888',    bg: '#f0f0f0' };
                return (
                  <tr key={i} style={dispatchStyles.tr}>
                    <td style={dispatchStyles.td}>{s.dispatch_date}</td>
                    <td style={dispatchStyles.td}>{s.dispatch_time}</td>
                    <td style={dispatchStyles.td}>
                      <span style={{ background: tag.bg, color: tag.color, padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                        {tag.label}
                      </span>
                    </td>
                    <td style={{ ...dispatchStyles.td, fontSize: 12 }}>{(s.dispatchAddress || '').replace(/\n/g, ' / ')}</td>
                    <td style={{ ...dispatchStyles.td, fontSize: 12, color: '#666' }}>{s.description?.slice(0, 80)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const dispatchStyles = {
  topRow:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 16 },
  bigStat:       { padding: '14px 18px', borderRadius: 8, background: '#fafbfc', border: '1px solid #eee' },
  bigValue:      { fontSize: 32, fontWeight: 800, lineHeight: 1.1 },
  bigLabel:      { fontSize: 13, color: '#444', marginTop: 4, fontWeight: 600 },
  bigSub:        { fontSize: 11, color: '#888', marginTop: 2 },
  proportionBar: { display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: '#eee', marginBottom: 16 },
  barSegment:    { height: '100%' },
  dist:          { fontSize: 13, color: '#444', marginBottom: 16 },
  monthlyWrap:   { overflowX: 'auto' },
  monthlyTable:  { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:            { background: '#f0f2f5', padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#333' },
  tr:            { borderBottom: '1px solid #f0f0f0' },
  td:            { padding: '7px 12px' },
  samples:       { marginTop: 16, background: '#fafbfc', borderRadius: 8, padding: 12 },
  summary:       { cursor: 'pointer', fontWeight: 600, color: '#1a3a6b' },
  sampleBlock:   { marginTop: 14 },
  sampleHeader:  { fontSize: 13, fontWeight: 700, color: '#444', margin: '12px 0 6px' },
};

// ─── Columns config ────────────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'rank',             label: 'Rank',       align: 'left'  },
  { key: 'name',             label: 'Member',     align: 'left'  },
  { key: 'ridingPoints',     label: 'Riding Pts', align: 'right' },
  { key: 'nonridingClockIns',label: 'Clock-Ins',  align: 'right' },
  { key: 'shiftSignups',     label: 'Shifts',     align: 'right' },
  { key: 'attendance',       label: 'Attendance', align: 'center' },
  { key: 'totalPoints',      label: 'Total Pts',  align: 'right' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function CorpsOverview() {
  const now = new Date();
  const [year,        setYear]    = useState(now.getFullYear());
  const [month,       setMonth]   = useState(now.getMonth() + 1);
  const [sortCol,     setSortCol] = useState('totalPoints');
  const [sortDir,     setSortDir] = useState('desc');
  const [openingSheets,       setOpeningSheets]       = useState(false);
  const [openingAnnualSheets, setOpeningAnnualSheets] = useState(false);
  const [sheetsToast,         setSheetsToast]         = useState(''); // '' | 'connected' | 'error' | 'authorizing'

  // Detect OAuth callback redirect — show contextual toast
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let timer;
    if (params.has('sheetsAuthDone')) {
      setSheetsToast('connected');
      window.history.replaceState({}, '', window.location.pathname);
      timer = setTimeout(() => setSheetsToast(''), 8000);
    } else if (params.has('sheetsAuthError')) {
      setSheetsToast('error');
      window.history.replaceState({}, '', window.location.pathname);
      timer = setTimeout(() => setSheetsToast(''), 6000);
    }
    return () => clearTimeout(timer);
  }, []);

  async function openInSheets(endpoint, setBusy, errorLabel) {
    setBusy(true);
    try {
      const resp = await fetch(`${API_BASE}${endpoint}`, { method: 'POST' });
      const data = await resp.json().catch(() => ({}));

      if (resp.status === 401 && data.needsAuth) {
        // First-time (or re-auth): open consent screen in new tab
        window.open(data.authUrl, '_blank', 'noopener');
        setSheetsToast('authorizing');
        setTimeout(() => setSheetsToast(''), 12000);
        return;
      }
      if (!resp.ok) throw new Error(data.error || resp.statusText);

      window.open(data.url, '_blank', 'noopener');
    } catch (err) {
      alert(`${errorLabel}: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function handleOpenInSheets() {
    return openInSheets(
      `/api/reports/open-in-sheets?year=${year}&month=${month}&adultOnly=1`,
      setOpeningSheets,
      'Could not open monthly report in Sheets',
    );
  }

  // Annual Report always reports on the last completed calendar year —
  // decoupled from the month/year selector (which controls monthly data).
  // The button label spells the year out so the scope is unambiguous.
  const lastFullYear = now.getFullYear() - 1;

  function handleOpenAnnualInSheets() {
    return openInSheets(
      `/api/reports/annual-in-sheets?year=${lastFullYear}`,
      setOpeningAnnualSheets,
      'Could not open annual report in Sheets',
    );
  }

  const { data: dispatch, loading: dl } = useApi(getDispatchReport, [year], [year]);
  const { data: trend,    loading: tl } = useApi(getCorpsTrend, [24], []);
  const { data: monthly, loading: ml } = useApi(getCorpsMonth,  [year, month], [year, month]);
  const { data: board,   loading: bl } = useApi(getLeaderboard, [year, month], [year, month]);

  // Sort leaderboard client-side; "attendance" sorts by meeting+training combined
  const sortedBoard = useMemo(() => {
    if (!board) return [];
    return [...board].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (sortCol === 'attendance') {
        av = (a.meetingAttendance || 0) + (a.trainingAttendance || 0);
        bv = (b.meetingAttendance || 0) + (b.trainingAttendance || 0);
      }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [board, sortCol, sortDir]);

  function handleSort(key) {
    if (key === 'rank') return;
    if (key === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(key); setSortDir('desc'); }
  }

  const sortIndicator = (key) => sortCol === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => i + 1);

  // ─── Stat card tooltip data (derived from monthly) ─────────────────────────
  const rAvg = monthly && monthly.riding.activeMembers > 0
    ? (monthly.riding.totalPoints / monthly.riding.activeMembers).toFixed(1) : '—';
  const nrAvg = monthly && monthly.nonriding.activeMembers > 0
    ? (monthly.nonriding.totalPoints / monthly.nonriding.activeMembers).toFixed(1) : '—';
  const shiftAvg = monthly && monthly.shifts.activeMembers > 0
    ? (monthly.shifts.total / monthly.shifts.activeMembers).toFixed(1) : '—';
  const riderPct = monthly && monthly.totalMembers > 0
    ? Math.round((monthly.riding.activeMembers / monthly.totalMembers) * 100) : '—';
  const avgCrew = monthly && monthly.riding.avgCrewPerCall
    ? monthly.riding.avgCrewPerCall.toFixed(1) : '—';

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Corps Overview</h1>
        <div style={styles.controls}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={styles.select}>
            {MONTH_OPTS.map(m => (
              <option key={m} value={m}>{new Date(2000, m-1).toLocaleString('default', { month: 'long' })}</option>
            ))}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={styles.select}>
            {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={handleOpenInSheets}
            disabled={openingSheets}
            style={styles.sheetsBtn}
            title={`Upload ${new Date(year, month-1).toLocaleString('en-US', { month: 'long' })} ${year} monthly report to Google Sheets`}
          >
            {openingSheets ? '⏳' : '📊'} {openingSheets ? 'Opening…' : 'Open in Sheets'}
          </button>
          <button
            onClick={handleOpenAnnualInSheets}
            disabled={openingAnnualSheets}
            style={styles.annualBtn}
            title={`Upload the full ${lastFullYear} night-crew hours report to Google Sheets`}
          >
            {openingAnnualSheets ? '⏳' : '📅'} {openingAnnualSheets ? 'Opening…' : `Annual Report (${lastFullYear})`}
          </button>
        </div>
      </div>

      {/* OAuth toast banner */}
      {sheetsToast && (() => {
        const t = { authorizing: { bg: '#fff3cd', border: '#ffc107', color: '#856404', msg: <>🔑 Google sign-in opened — complete it, then click <strong>Open in Sheets</strong> again.</> },
                    connected:   { bg: '#e6f4ea', border: '#34a853', color: '#1a5c33', msg: <>✅ Google Drive connected! Click <strong>Open in Sheets</strong> to continue.</> },
                    error:       { bg: '#fdecea', border: '#ea4335', color: '#7a1c11', msg: <>❌ Google sign-in failed or was cancelled. Try again.</> } }[sheetsToast];
        return t ? (
          <div style={{ ...styles.toast, background: t.bg, borderColor: t.border, color: t.color }}>
            <span>{t.msg}</span>
            <button style={styles.toastClose} onClick={() => setSheetsToast('')}>✕</button>
          </div>
        ) : null;
      })()}

      {/* Monthly stat cards */}
      <div style={styles.cards}>
        <StatCard
          label="Total Rides" value={monthly?.riding.uniqueCalls} color="#0d4f8b"
          sub="unique calls covered"
          tooltip={[
            { label: 'Avg crew / call',   value: avgCrew },
            { label: 'Person-rides',      value: monthly?.riding.totalCalls ?? '—' },
            { label: 'Active riders',     value: monthly?.riding.activeMembers ?? '—' },
          ]}
        />
        <StatCard
          label="Total Riding Points" value={monthly?.riding.totalPoints} color="#1a3a6b"
          tooltip={[
            { label: 'Active riders',   value: monthly?.riding.activeMembers ?? '—' },
            { label: 'Person-rides',    value: monthly?.riding.totalCalls ?? '—' },
            { label: 'Avg / rider',     value: rAvg },
          ]}
        />
        <StatCard
          label="Total Non-Riding Points" value={monthly?.nonriding.totalPoints} color="#4a90d9"
          tooltip={[
            { label: 'Active members',  value: monthly?.nonriding.activeMembers ?? '—' },
            { label: 'Avg / member',    value: nrAvg },
          ]}
        />
        <StatCard
          label="Active Riders" value={monthly?.riding.activeMembers} color="#2e7d32"
          tooltip={[
            { label: 'Total members',   value: monthly?.totalMembers ?? '—' },
            { label: '% of corps',      value: riderPct !== '—' ? `${riderPct}%` : '—' },
            { label: 'Riding points',   value: monthly?.riding.totalPoints ?? '—' },
          ]}
        />
        <StatCard
          label="Avg Points / Member" value={monthly?.combinedAvgPerMember?.toFixed(1)}
          sub="combined riding + non-riding" color="#e63946"
          tooltip={[
            { label: 'Riding avg',      value: rAvg },
            { label: 'Non-riding avg',  value: nrAvg },
            { label: 'Active members',  value: monthly?.totalMembers ?? '—' },
          ]}
        />
        <StatCard
          label="Shift Sign-Ups" value={monthly?.shifts.total} color="#f4a261"
          tooltip={[
            { label: 'Members w/ shifts', value: monthly?.shifts.activeMembers ?? '—' },
            { label: 'Avg / member',      value: shiftAvg },
          ]}
        />
        <StatCard
          label="Total Active Members" value={monthly?.totalMembers} color="#555"
          tooltip={[
            { label: 'With riding pts',   value: monthly?.riding.activeMembers ?? '—' },
            { label: 'With non-riding',   value: monthly?.nonriding.activeMembers ?? '—' },
            { label: 'With shifts',       value: monthly?.shifts.activeMembers ?? '—' },
          ]}
        />
      </div>

      {/* 12-month trend chart */}
      <div style={styles.section}>
        <h2 style={styles.h2}>12-Month Corps Trend</h2>
        {tl ? <p style={styles.loading}>Loading…</p>
            : <CorpsTrendChart data={trend} selectedYear={year} selectedMonth={month} />}
      </div>

      {/* Avg crew per call trend */}
      <div style={styles.section}>
        <h2 style={styles.h2}>Average Crew per Call — 12-Month Trend</h2>
        <p style={styles.subtle}>
          Each unique call is covered by 1 ambulance with multiple responders. This shows the
          average number of crew members credited per call, across calls in the month.
        </p>
        {tl ? <p style={styles.loading}>Loading…</p>
            : <CrewPerCallChart data={trend} selectedYear={year} selectedMonth={month} />}
      </div>

      {/* Dispatch response — matched ESO calls vs. mutual-aid losses */}
      <div style={styles.section}>
        <h2 style={styles.h2}>Dispatch Response — {year}</h2>
        <p style={styles.subtle}>
          Police dispatches from iamresponding.com matched against ESO call
          records. The headline number is the <strong>in-area coverage gap</strong>:
          dispatches to our service area with no corresponding ESO record —
          meaning the run went to another agency because we couldn't field a
          crew. Out-of-area dispatches (explicit mutual aid out, neighbor-town
          calls) and highway/MVA dispatches without parseable addresses are
          listed separately since those were never primarily ours.
        </p>
        {dl ? (
          <p style={styles.loading}>Loading…</p>
        ) : !dispatch || dispatch.total === 0 ? (
          <p style={styles.subtle}>
            No dispatches imported for {year}. Upload an IAR dispatch export
            from the Import Data page to see the breakdown.
          </p>
        ) : (
          <DispatchPanel report={dispatch} />
        )}
      </div>

      {/* Rides-per-member histogram */}
      <div style={styles.section}>
        <h2 style={styles.h2}>Riding Contribution — {formatPeriod(year, month)}</h2>
        {bl ? <p style={styles.loading}>Loading…</p> : <RidesHistogramChart data={board} />}
      </div>

      {/* Leaderboard */}
      <div style={styles.section}>
        <h2 style={styles.h2}>Leaderboard — {formatPeriod(year, month)}</h2>
        {bl ? <p style={styles.loading}>Loading…</p> : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      style={{
                        ...styles.th,
                        textAlign: col.align,
                        cursor: col.key === 'rank' ? 'default' : 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}{sortIndicator(col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedBoard.map((row, i) => (
                  <tr key={row.id} style={styles.row}>
                    <td style={{ ...styles.td, fontWeight: 700, color: i < 3 && sortCol === 'totalPoints' && sortDir === 'desc' ? '#e63946' : '#333' }}>
                      {i < 3 && sortCol === 'totalPoints' && sortDir === 'desc'
                        ? ['🥇','🥈','🥉'][i]
                        : `#${i + 1}`}
                    </td>
                    <td style={styles.td}>{row.name}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{row.ridingPoints}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{row.nonridingClockIns}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{row.shiftSignups}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      {row.meetingAttendance > 0 && (
                        <span style={styles.badgeM} title="Meeting attended">M</span>
                      )}
                      {row.trainingAttendance > 0 && (
                        <span style={styles.badgeT} title="Training attended">T</span>
                      )}
                      {!row.meetingAttendance && !row.trainingAttendance && (
                        <span style={{ color: '#ccc' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{row.totalPoints}</td>
                  </tr>
                ))}
                {sortedBoard.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#888' }}>No data for this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page:     { padding: '24px 32px', maxWidth: 1200, margin: '0 auto' },
  header:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  h1:       { fontSize: 26, fontWeight: 800, color: '#1a3a6b', margin: 0 },
  h2:       { fontSize: 18, fontWeight: 700, color: '#1a3a6b', marginBottom: 16 },
  subtle:   { fontSize: 12, color: '#888', marginTop: -8, marginBottom: 16, lineHeight: 1.5 },
  controls:     { display: 'flex', gap: 10, alignItems: 'center' },
  select:       { padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, background: '#fff' },
  sheetsBtn:    { padding: '8px 14px', borderRadius: 6, border: '2px solid #1a7f4b', background: '#fff', color: '#1a7f4b', fontSize: 14, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' },
  annualBtn:    { padding: '8px 14px', borderRadius: 6, border: '2px solid #5b3a8c', background: '#fff', color: '#5b3a8c', fontSize: 14, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' },
  toast:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid', borderRadius: 8, padding: '10px 16px', fontSize: 13, marginBottom: 12 },
  toastClose:   { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px', marginLeft: 12 },
  cards:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 28, overflow: 'visible' },
  statCard: { background: '#fff', borderRadius: 10, padding: '20px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', textAlign: 'center', cursor: 'default' },
  statValue:{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 },
  statLabel:{ fontSize: 12, color: '#666', marginTop: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  statSub:  { fontSize: 11, color: '#aaa', marginTop: 4 },
  tooltip:  {
    position: 'absolute', top: 'calc(100% + 8px)', left: '50%',
    transform: 'translateX(-50%)',
    background: '#1a3a6b', color: '#fff', borderRadius: 8,
    padding: '10px 14px', minWidth: 180, zIndex: 9999,
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  tooltipLine:  { display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4, fontSize: 13 },
  tooltipKey:   { color: '#a8c4e8', fontWeight: 500 },
  tooltipVal:   { fontWeight: 700 },
  section:  { background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 24 },
  loading:  { color: '#888', textAlign: 'center', padding: 40 },
  tableWrap:{ overflowX: 'auto' },
  table:    { width: '100%', borderCollapse: 'collapse' },
  th:       { background: '#1a3a6b', color: '#fff', padding: '10px 14px', textAlign: 'left', fontSize: 13 },
  row:      { borderBottom: '1px solid #f0f0f0' },
  td:       { padding: '10px 14px', fontSize: 14 },
  badgeM:   { display: 'inline-block', background: '#1a3a6b22', color: '#1a3a6b', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 800, marginRight: 3 },
  badgeT:   { display: 'inline-block', background: '#2e7d3222', color: '#2e7d32', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 800 },
};
