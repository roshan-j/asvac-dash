/**
 * Print View — opens in a new tab, prints cleanly.
 * URL: /print?year=2025&month=2
 * Designed to be printed as a PDF or paper report.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCorpsMonth, getLeaderboard, getCorpsTrend } from '../api/client';
import { formatPeriod, formatMonthLabel } from '../utils/format';

export default function PrintView() {
  const [params] = useSearchParams();
  const now   = new Date();
  const year  = parseInt(params.get('year')  || now.getFullYear());
  const month = parseInt(params.get('month') || now.getMonth() + 1);

  const [monthly,   setMonthly]   = useState(null);
  const [board,     setBoard]     = useState(null);
  const [trend,     setTrend]     = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([
      getCorpsMonth(year, month),
      getLeaderboard(year, month),
      getCorpsTrend(6),
    ]).then(([m, b, t]) => {
      setMonthly(m);
      setBoard(b);
      setTrend(t);
      setLoading(false);
    });
  }, [year, month]);

  useEffect(() => {
    if (!loading) {
      setTimeout(() => window.print(), 500);
    }
  }, [loading]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 80, fontFamily: 'sans-serif' }}>
      Preparing print view…
    </div>
  );

  const period = formatPeriod(year, month);
  const generated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div style={print.page}>
      {/* Header */}
      <div style={print.header}>
        <div>
          <h1 style={print.h1}>🚑 Ardsley Secor Volunteer Ambulance Corps</h1>
          <h2 style={print.h2}>Member Activity Report — {period}</h2>
        </div>
        <div style={print.meta}>Generated {generated}</div>
      </div>

      {/* Corps summary */}
      <div style={print.summaryGrid}>
        {[
          { label: 'Total Riding Points',    val: monthly?.riding.totalPoints      },
          { label: 'Total Non-Riding Points', val: monthly?.nonriding.totalPoints  },
          { label: 'Active Riders',           val: monthly?.riding.activeMembers   },
          { label: 'Avg Points / Member',     val: monthly?.combinedAvgPerMember?.toFixed(1) },
          { label: 'Shift Sign-Ups',          val: monthly?.shifts.total           },
          { label: 'Total Active Members',    val: monthly?.totalMembers           },
        ].map(s => (
          <div key={s.label} style={print.statCard}>
            <div style={print.statVal}>{s.val ?? '—'}</div>
            <div style={print.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 6-month trend table */}
      <h3 style={print.sectionTitle}>6-Month Trend</h3>
      <table style={print.table}>
        <thead>
          <tr style={print.thead}>
            {['Month', 'Total Calls', 'Riding Pts', 'Non-Riding Pts', 'Active Riders', 'Avg/Member'].map(h => (
              <th key={h} style={print.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(trend || []).map((t, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : '#fff' }}>
              <td style={print.td}>{formatMonthLabel(t.year, t.month)}</td>
              <td style={print.td}>{t.riding.totalCalls}</td>
              <td style={print.td}>{t.riding.totalPoints}</td>
              <td style={print.td}>{t.nonriding.totalPoints}</td>
              <td style={print.td}>{t.riding.activeMembers}</td>
              <td style={print.td}>{t.combinedAvgPerMember?.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Leaderboard */}
      <h3 style={{ ...print.sectionTitle, marginTop: 28 }}>Member Standings — {period}</h3>
      <table style={print.table}>
        <thead>
          <tr style={print.thead}>
            {['Rank', 'Member', 'Riding Points', 'Non-Riding Points', 'Total Points'].map(h => (
              <th key={h} style={print.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(board || []).map((row, i) => (
            <tr key={row.id} style={{ background: i % 2 === 0 ? '#f9f9f9' : '#fff' }}>
              <td style={print.td}>#{row.rank}</td>
              <td style={{ ...print.td, fontWeight: 600 }}>{row.name}</td>
              <td style={print.td}>{row.ridingPoints}</td>
              <td style={print.td}>{row.nonridingPoints}</td>
              <td style={{ ...print.td, fontWeight: 700 }}>{row.totalPoints}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={print.footer}>
        ASVAС Activity Dashboard &bull; Confidential — For Internal Use Only &bull; {generated}
      </div>

      {/* Print styles injected inline */}
      <style>{`
        @media print {
          @page { size: letter; margin: 0.6in; }
          body   { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

const print = {
  page:        { fontFamily: 'Arial, sans-serif', color: '#222', maxWidth: 900, margin: '0 auto', padding: 24 },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1a3a6b', paddingBottom: 12, marginBottom: 20 },
  h1:          { fontSize: 18, margin: 0, color: '#1a3a6b' },
  h2:          { fontSize: 14, margin: '4px 0 0', color: '#555', fontWeight: 400 },
  meta:        { fontSize: 11, color: '#888' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 24 },
  statCard:    { border: '1px solid #ddd', borderRadius: 6, padding: '10px 8px', textAlign: 'center' },
  statVal:     { fontSize: 22, fontWeight: 800, color: '#1a3a6b' },
  statLabel:   { fontSize: 9, color: '#666', marginTop: 4, textTransform: 'uppercase', fontWeight: 600 },
  sectionTitle:{ fontSize: 14, fontWeight: 700, color: '#1a3a6b', margin: '0 0 8px', borderBottom: '1px solid #ddd', paddingBottom: 6 },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  thead:       { background: '#1a3a6b' },
  th:          { color: '#fff', padding: '7px 10px', textAlign: 'left', fontWeight: 600 },
  td:          { padding: '6px 10px', borderBottom: '1px solid #eee' },
  footer:      { marginTop: 32, textAlign: 'center', fontSize: 10, color: '#aaa', borderTop: '1px solid #ddd', paddingTop: 10 },
};
