import { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import { getCorpsTrend, getCorpsMonth, getLeaderboard, getPeriods } from '../api/client';
import CorpsTrendChart from '../components/Charts/CorpsTrendChart';
import RidesHistogramChart from '../components/Charts/RidesHistogramChart';
import AttendanceUploadModal from '../components/AttendanceUploadModal';
import { formatPeriod } from '../utils/format';

function StatCard({ label, value, sub, color = '#1a3a6b' }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color }}>{value ?? '—'}</div>
      <div style={styles.statLabel}>{label}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  );
}

// Columns config: key = field in board row, label = header text, align = left|right
const COLUMNS = [
  { key: 'rank',             label: 'Rank',       align: 'left'  },
  { key: 'name',             label: 'Member',     align: 'left'  },
  { key: 'ridingPoints',     label: 'Riding Pts', align: 'right' },
  { key: 'nonridingClockIns',label: 'Clock-Ins',  align: 'right' },
  { key: 'shiftSignups',     label: 'Shifts',     align: 'right' },
  { key: 'totalPoints',      label: 'Total Pts',  align: 'right' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function CorpsOverview() {
  const now = new Date();
  const [year,        setYear]        = useState(now.getFullYear());
  const [month,       setMonth]       = useState(now.getMonth() + 1);
  const [sortCol,     setSortCol]     = useState('totalPoints');
  const [sortDir,     setSortDir]     = useState('desc');
  const [downloading,   setDownloading]   = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/reports/monthly-print?year=${year}&month=${month}&adultOnly=1`);
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });
      a.href     = url;
      a.download = `ASVAC_${monthName}_${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  const { data: trend,   loading: tl } = useApi(getCorpsTrend, [24], []);
  const { data: monthly, loading: ml } = useApi(getCorpsMonth,  [year, month], [year, month]);
  const { data: board,   loading: bl } = useApi(getLeaderboard, [year, month], [year, month]);

  // Sort leaderboard client-side based on clicked column
  const sortedBoard = useMemo(() => {
    if (!board) return [];
    return [...board].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [board, sortCol, sortDir]);

  function handleSort(key) {
    if (key === 'rank') return; // rank is derived — not sortable independently
    if (key === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(key); setSortDir('desc'); }
  }

  const sortIndicator = (key) => {
    if (key === sortCol) return sortDir === 'asc' ? ' ↑' : ' ↓';
    return '';
  };

  const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <>
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
            onClick={handleDownload}
            disabled={downloading}
            style={styles.downloadBtn}
            title={`Download ${new Date(year, month-1).toLocaleString('en-US', { month: 'long' })} ${year} report`}
          >
            {downloading ? '⏳' : '📥'} {downloading ? 'Downloading…' : 'Download Sheet'}
          </button>
          <button
            onClick={() => setShowAttendance(true)}
            style={{ ...styles.downloadBtn, background: '#2a6b3a' }}
            title="Upload meeting or training attendance CSV"
          >
            📋 Upload Attendance
          </button>
        </div>
      </div>

      {/* Monthly stat cards */}
      <div style={styles.cards}>
        <StatCard label="Total Riding Points"    value={monthly?.riding.totalPoints}   color="#1a3a6b" />
        <StatCard label="Total Non-Riding Points" value={monthly?.nonriding.totalPoints} color="#4a90d9" />
        <StatCard label="Active Riders"           value={monthly?.riding.activeMembers}  color="#2e7d32" />
        <StatCard label="Avg Points / Member"
          value={monthly?.combinedAvgPerMember?.toFixed(1)}
          sub="combined riding + non-riding"
          color="#e63946"
        />
        <StatCard label="Shift Sign-Ups"         value={monthly?.shifts.total}          color="#f4a261" />
        <StatCard label="Total Active Members"   value={monthly?.totalMembers}           color="#555" />
      </div>

      {/* 12-month trend chart — selected month highlighted */}
      <div style={styles.section}>
        <h2 style={styles.h2}>12-Month Corps Trend</h2>
        {tl ? <p style={styles.loading}>Loading…</p>
            : <CorpsTrendChart data={trend} selectedYear={year} selectedMonth={month} />}
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
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{row.totalPoints}</td>
                  </tr>
                ))}
                {sortedBoard.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#888' }}>No data for this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>

    {showAttendance && (
      <AttendanceUploadModal onClose={() => setShowAttendance(false)} />
    )}
    </>
  );
}

const styles = {
  page:     { padding: '24px 32px', maxWidth: 1200, margin: '0 auto' },
  header:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  h1:       { fontSize: 26, fontWeight: 800, color: '#1a3a6b', margin: 0 },
  h2:       { fontSize: 18, fontWeight: 700, color: '#1a3a6b', marginBottom: 16 },
  controls:     { display: 'flex', gap: 10, alignItems: 'center' },
  select:       { padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, background: '#fff' },
  downloadBtn:  { padding: '8px 14px', borderRadius: 6, border: 'none', background: '#1a3a6b', color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' },
  cards:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 28 },
  statCard: { background: '#fff', borderRadius: 10, padding: '20px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', textAlign: 'center' },
  statValue:{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 },
  statLabel:{ fontSize: 12, color: '#666', marginTop: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  statSub:  { fontSize: 11, color: '#aaa', marginTop: 4 },
  section:  { background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 24 },
  loading:  { color: '#888', textAlign: 'center', padding: 40 },
  tableWrap:{ overflowX: 'auto' },
  table:    { width: '100%', borderCollapse: 'collapse' },
  th:       { background: '#1a3a6b', color: '#fff', padding: '10px 14px', textAlign: 'left', fontSize: 13 },
  row:      { borderBottom: '1px solid #f0f0f0' },
  td:       { padding: '10px 14px', fontSize: 14 },
};
