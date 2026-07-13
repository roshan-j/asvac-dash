import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { getCoverageReport } from '../api/client';

// ─── Color scale for miss% (green = covered, red = losing calls) ──────────────
// Anchored 10%→35% so the heatmap spreads across the real data range.
function heatColor(pct) {
  if (pct == null) return '#eef1f5';
  const t = Math.max(0, Math.min(1, (pct - 10) / 25));
  const stops = [
    [26, 152, 80],   // green
    [166, 217, 106], // light green
    [254, 224, 139], // yellow
    [244, 165, 130], // orange
    [215, 48, 39],   // red
  ];
  const seg = t * (stops.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const textOn = (pct) => (pct != null && (pct < 16 || pct > 30) ? '#fff' : '#1a2a3a');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function Coverage() {
  const [season, setSeason] = useState(null);   // null = all months, else {key, months}
  const params = season ? { months: season.months.join(',') } : {};
  const { data, loading, error } = useApi(getCoverageReport, [params], [season]);

  if (loading && !data) return <div style={styles.page}><p style={styles.muted}>Loading coverage data…</p></div>;
  if (error) return <div style={styles.page}><p style={{ color: '#c0392b' }}>Error: {error}</p></div>;

  const { overall, grid, worstCells, breadth, blocks, seasonDetection } = data;
  const blockKeys = blocks.map(b => b.key);
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const cell = (dow, block) => grid.find(c => c.dowLabel === dow && c.block === block);
  const latestYear = overall.byYear[overall.byYear.length - 1];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Coverage Gap — the Patchwork Quilt</h1>
        <p style={styles.sub}>
          When do our own 911 calls slip to mutual aid? Every cell is a call that was
          dispatched to our area. Red = the holes in the quilt.
        </p>
      </div>

      {/* Headline stats */}
      <div style={styles.statRow}>
        <StatCard
          value={`${overall.missPct}%`}
          label="of our calls lost to mutual aid"
          sub={`${overall.missed.toLocaleString()} of ${overall.ours.toLocaleString()} calls, ${overall.firstDate?.slice(0,4)}–${overall.lastDate?.slice(0,4)}`}
          color="#c0392b"
        />
        <StatCard
          value={`${latestYear.missPct}%`}
          label={`${latestYear.year} year-to-date`}
          sub={`Trending ${latestYear.missPct > overall.missPct ? 'up ▲ worse' : 'down ▼ better'} vs. long-run avg`}
          color={latestYear.missPct > overall.missPct ? '#c0392b' : '#1a7f4b'}
        />
        <StatCard
          value={breadth ? `${breadth.top10Share}%` : '—'}
          label="of rides carried by the top 10"
          sub={breadth ? `${breadth.activeAdultsRode} of ${breadth.activeAdults} active adults ride · top 5 alone carry ${breadth.top5Share}%` : ''}
          color="#8e44ad"
        />
      </div>

      {/* The heatmap */}
      <div style={styles.card}>
        <div style={styles.cardHead}>
          <h2 style={styles.h2}>Where the quilt has holes</h2>
          <div style={styles.seasonToggle}>
            <SeasonChip active={!season} onClick={() => setSeason(null)}>All year</SeasonChip>
            {seasonDetection.seasons.map(s => (
              <SeasonChip key={s.key} active={season?.key === s.key} onClick={() => setSeason(s)}>
                {s.name}
              </SeasonChip>
            ))}
          </div>
        </div>
        {season && (
          <p style={styles.cardSub}>
            Showing {season.name.replace(/^(High|Low)-miss /, '')} · {season.missPct}% miss over {season.ours.toLocaleString()} calls.
          </p>
        )}
        {!season && (
          <p style={styles.cardSub}>
            {seasonDetection.meaningful
              ? `Seasonal signal: ${seasonDetection.gapPp}pp gap between seasons — filter above.`
              : `Weak seasonality (only ${seasonDetection.gapPp}pp between the best high/low split). The dominant pattern is day × time-block — Saturday evening loses ~2× the weekday-day rate. Season chips are for exploring; the day/time holes are the lever.`}
          </p>
        )}
        <div style={styles.heatWrap}>
          <table style={styles.heat}>
            <thead>
              <tr>
                <th style={styles.corner}></th>
                {blocks.map(b => (
                  <th key={b.key} style={styles.colHead}>
                    {b.label}<br /><span style={styles.range}>{b.range}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dows.map(dow => {
                const isWeekend = dow === 'Sat' || dow === 'Sun';
                return (
                  <tr key={dow}>
                    <th style={{ ...styles.rowHead, fontWeight: isWeekend ? 800 : 600 }}>{dow}</th>
                    {blockKeys.map(bk => {
                      const c = cell(dow, bk);
                      const pct = c?.missPct;
                      return (
                        <td key={bk} style={{ ...styles.heatCell, background: heatColor(pct), color: textOn(pct) }}
                            title={c ? `${dow} ${bk}: ${c.missed}/${c.ours} calls missed` : ''}>
                          <div style={styles.cellPct}>{pct != null ? `${Math.round(pct)}%` : '—'}</div>
                          <div style={styles.cellN}>{c ? `${c.missed}/${c.ours}` : ''}</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={styles.legend}>
            <span style={styles.muted}>Lower</span>
            <div style={styles.legendBar}>
              {[10,16,22,28,34].map(p => <div key={p} style={{ flex: 1, background: heatColor(p) }} />)}
            </div>
            <span style={styles.muted}>Higher miss %</span>
          </div>
        </div>
      </div>

      <div style={styles.twoCol}>
        {/* Target list */}
        <div style={styles.card}>
          <h2 style={styles.h2}>Stitch these first</h2>
          <p style={styles.cardSub}>Highest-loss slots with real volume (≥40 calls). Point named asks here.</p>
          <ol style={styles.targetList}>
            {worstCells.map((c, i) => (
              <li key={i} style={styles.targetItem}>
                <span style={styles.targetRank}>{i + 1}</span>
                <span style={styles.targetSlot}>{c.dowLabel} {c.blockLabel} <span style={styles.range}>({c.blockRange})</span></span>
                <span style={{ ...styles.targetPct, color: heatColor(c.missPct) }}>{Math.round(c.missPct)}%</span>
                <span style={styles.targetN}>{c.missed} of {c.ours} lost</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Breadth / heroes */}
        {breadth && (
          <div style={styles.card}>
            <h2 style={styles.h2}>Who's holding it up</h2>
            <p style={styles.cardSub}>
              Of <strong>{breadth.activeAdults}</strong> active adults, <strong>{breadth.activeAdultsRode}</strong> ride
              and <strong>{breadth.activeAdultsZero}</strong> don't. The problem isn't activation — it's load: top 5 carry{' '}
              <strong>{breadth.top5Share}%</strong>, top 10 carry <strong>{breadth.top10Share}%</strong> of
              all {breadth.totalRides.toLocaleString()} rides. Spread the weekend/evening slots off the heroes.
            </p>
            <div style={styles.heroList}>
              {breadth.topRiders.map((r, i) => {
                const max = breadth.topRiders[0].rides;
                return (
                  <div key={i} style={styles.heroRow}>
                    <span style={styles.heroName}>{r.activeAdult ? '✓ ' : ''}{r.name}</span>
                    <div style={styles.heroBarTrack}>
                      <div style={{ ...styles.heroBarFill, width: `${(r.rides / max) * 100}%` }} />
                    </div>
                    <span style={styles.heroRides}>{r.rides}</span>
                  </div>
                );
              })}
            </div>
            <p style={styles.muted}>
              ✓ = current active-adult roster (May 2026 crew list). {breadth.ridersInWindow} total people rode in 12mo (incl. college).
            </p>
          </div>
        )}
      </div>

      {/* Seasonality */}
      <div style={styles.card}>
        <h2 style={styles.h2}>Seasonality — miss % by month</h2>
        <div style={styles.monthRow}>
          {overall.byMonth.map(m => (
            <div key={m.month} style={styles.monthCol} title={`${m.missed}/${m.ours} calls`}>
              <div style={styles.monthBarTrack}>
                <div style={{ ...styles.monthBarFill, height: `${(m.missPct / 40) * 100}%`, background: heatColor(m.missPct) }} />
              </div>
              <div style={styles.monthPct}>{Math.round(m.missPct)}</div>
              <div style={styles.monthLbl}>{MONTHS[m.month - 1]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Honest caveats */}
      <div style={styles.caveat}>
        <strong>How to read this.</strong> "Our calls" = dispatches we responded to (matched an ESO
        record) plus in-area calls with no crew fielded. Out-of-area, highway/parkway, and
        unparseable dispatches are excluded — they were never ours. The miss rate is an upper bound:
        some "misses" may be calls we rode where the address didn't match. Address matching is high-confidence
        (≥0.85 similarity). Dispatch data spans 2020–2026 continuously.
      </div>
    </div>
  );
}

function SeasonChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }}>
      {children}
    </button>
  );
}

function StatCard({ value, label, sub, color }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  );
}

const styles = {
  page: { padding: '28px 32px', maxWidth: 1180, margin: '0 auto' },
  header: { marginBottom: 20 },
  h1: { fontSize: 26, fontWeight: 800, color: '#1a2a3a', margin: 0, letterSpacing: '-0.5px' },
  sub: { color: '#5a6b7b', fontSize: 14, marginTop: 6, maxWidth: 720 },
  muted: { color: '#8a97a5', fontSize: 12 },

  statRow: { display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  statCard: { flex: '1 1 240px', background: '#fff', borderRadius: 12, padding: '18px 20px', boxShadow: '0 1px 4px rgba(20,40,70,0.08)' },
  statValue: { fontSize: 34, fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: 13, fontWeight: 600, color: '#3a4a5a', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.3px' },
  statSub: { fontSize: 12, color: '#8a97a5', marginTop: 4 },

  card: { background: '#fff', borderRadius: 12, padding: '20px 22px', boxShadow: '0 1px 4px rgba(20,40,70,0.08)', marginBottom: 20 },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  seasonToggle: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { border: '1px solid #d4dce6', background: '#fff', color: '#3a4a5a', borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  chipActive: { background: '#1a3a6b', color: '#fff', border: '1px solid #1a3a6b' },
  h2: { fontSize: 17, fontWeight: 700, color: '#1a2a3a', margin: '0 0 4px' },
  cardSub: { fontSize: 13, color: '#5a6b7b', margin: '0 0 14px' },

  heatWrap: { overflowX: 'auto' },
  heat: { borderCollapse: 'separate', borderSpacing: 4, width: '100%', minWidth: 520 },
  corner: { width: 52 },
  colHead: { fontSize: 12, fontWeight: 700, color: '#3a4a5a', padding: '4px 2px', textAlign: 'center' },
  range: { fontSize: 10, color: '#9aa7b5', fontWeight: 400 },
  rowHead: { fontSize: 13, color: '#3a4a5a', textAlign: 'right', paddingRight: 8, width: 46 },
  heatCell: { borderRadius: 8, textAlign: 'center', padding: '10px 4px', minWidth: 92 },
  cellPct: { fontSize: 18, fontWeight: 800, lineHeight: 1 },
  cellN: { fontSize: 11, opacity: 0.85, marginTop: 3 },
  legend: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, justifyContent: 'flex-end' },
  legendBar: { display: 'flex', width: 160, height: 10, borderRadius: 5, overflow: 'hidden' },

  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 0, alignItems: 'start' },

  targetList: { listStyle: 'none', margin: 0, padding: 0 },
  targetItem: { display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid #eef1f5' },
  targetRank: { fontSize: 13, fontWeight: 700, color: '#fff', background: '#8a97a5', borderRadius: '50%', width: 22, height: 22, display: 'grid', placeItems: 'center' },
  targetSlot: { fontSize: 14, fontWeight: 600, color: '#1a2a3a' },
  targetPct: { fontSize: 16, fontWeight: 800, textAlign: 'right' },
  targetN: { gridColumn: '2 / 4', fontSize: 12, color: '#8a97a5' },

  heroList: { display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 },
  heroRow: { display: 'grid', gridTemplateColumns: '130px 1fr 34px', alignItems: 'center', gap: 8 },
  heroName: { fontSize: 13, color: '#1a2a3a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  heroBarTrack: { background: '#eef1f5', borderRadius: 4, height: 14, overflow: 'hidden' },
  heroBarFill: { background: '#8e44ad', height: '100%', borderRadius: 4 },
  heroRides: { fontSize: 13, fontWeight: 700, color: '#3a4a5a', textAlign: 'right' },

  monthRow: { display: 'flex', gap: 8, alignItems: 'flex-end', height: 150 },
  monthCol: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' },
  monthBarTrack: { flex: 1, width: '70%', display: 'flex', alignItems: 'flex-end', minHeight: 0 },
  monthBarFill: { width: '100%', borderRadius: '3px 3px 0 0', minHeight: 2 },
  monthPct: { fontSize: 12, fontWeight: 700, color: '#3a4a5a', marginTop: 4 },
  monthLbl: { fontSize: 11, color: '#8a97a5' },

  caveat: { fontSize: 12.5, color: '#5a6b7b', background: '#f4f7fb', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', lineHeight: 1.6, marginTop: 20 },
};
