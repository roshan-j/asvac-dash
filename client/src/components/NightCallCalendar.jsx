// ─── NightCallCalendar ─────────────────────────────────────────────────────────
// Month calendar of "night calls" — ESO ambulance calls received between 22:00
// and 06:00, bucketed by the calendar day they came in. Renders a 7-column grid
// (Sun..Sat) with each night call shown as its own tinted row inside the day
// cell, listing the riders who covered it. Below the grid: month totals and a
// top-5 night-rider leaderboard. Matches the CorpsOverview card aesthetic.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "23:14" → "11:14 PM". Falls back to the raw string if it doesn't parse.
function formatCallTime(t) {
  if (!t || typeof t !== 'string') return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return t;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

export default function NightCallCalendar({ data, loading, year, month }) {
  // Defensive: loading or no data yet → loading state. Never throw.
  if (loading || !data) {
    return (
      <div style={styles.section}>
        <h2 style={styles.h2}>Night Calls (10pm–6am)</h2>
        <p style={styles.subtle}>
          ESO calls received between 22:00 and 06:00, bucketed by the calendar day they came in.
        </p>
        <p style={styles.loading}>Loading…</p>
      </div>
    );
  }

  const { days = [], topRiders = [], totalNightCalls = 0, totalPersonRides = 0 } = data;

  // First weekday of the month. Compute from numeric parts — NOT an ISO string —
  // to avoid UTC-offset bugs that would shift the column by a day.
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0=Sun..6=Sat
  const leadingBlanks = Array.from({ length: firstWeekday }, (_, i) => i);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div style={styles.section}>
      <h2 style={styles.h2}>Night Calls (10pm–6am)</h2>
      <p style={styles.subtle}>
        ESO calls received between 22:00 and 06:00, bucketed by the calendar day they came in.
      </p>

      {/* Weekday header row */}
      <div style={styles.grid}>
        {WEEKDAYS.map(w => (
          <div key={w} style={styles.weekday}>{w}</div>
        ))}

        {/* Empty leading cells to offset day 1 to its correct column */}
        {leadingBlanks.map(i => (
          <div key={`blank-${i}`} style={styles.blankCell} />
        ))}

        {/* One cell per calendar day */}
        {days.map(d => {
          const hasCalls = (d.nightCallCount || 0) > 0;
          const calls = d.calls || [];
          const cellStyle = hasCalls ? { ...styles.dayCell, ...styles.dayCellNight } : styles.dayCell;
          const numStyle  = hasCalls ? { ...styles.dayNumber, ...styles.dayNumberNight } : styles.dayNumber;
          return (
            <div key={d.day} style={cellStyle}>
              <div style={styles.dayHeader}>
                <span style={numStyle}>
                  {d.day}
                </span>
                {hasCalls && (
                  <span style={styles.countBadge}>
                    {d.nightCallCount} night call{d.nightCallCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              {/* Each call as its own tinted band, with time + rider names */}
              {calls.map((c, i) => {
                const riders = Array.isArray(c.riders) ? c.riders : [];
                return (
                  <div key={c.callNumber ?? i} style={styles.callRow}>
                    <div style={styles.callTime}>{formatCallTime(c.callTime)}</div>
                    <div style={styles.riderList}>
                      {riders.length > 0
                        ? riders.join(', ')
                        : <span style={styles.noRiders}>—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ─── Summary ─────────────────────────────────────────────────────────── */}
      <div style={styles.summary}>
        {totalNightCalls === 0 ? (
          <p style={styles.emptyMsg}>
            No night calls (10pm–6am) recorded this month.
          </p>
        ) : (
          <div style={styles.summaryGrid}>
            {/* Big stat */}
            <div style={styles.bigStat}>
              <div style={styles.bigValue}>{totalNightCalls}</div>
              <div style={styles.bigLabel}>Total night calls ridden</div>
              <div style={styles.bigSub}>{totalPersonRides} person-rides</div>
            </div>

            {/* Top-5 night riders leaderboard */}
            <div style={styles.ridersBlock}>
              <div style={styles.ridersHeader}>Top 5 night riders</div>
              {topRiders.length === 0 ? (
                <p style={styles.subtle}>No riders recorded.</p>
              ) : (
                <ol style={styles.ridersList}>
                  {topRiders.map((r, i) => (
                    <li key={r.name ?? i} style={styles.riderRow}>
                      <span style={styles.riderRank}>{medals[i] ?? `#${i + 1}`}</span>
                      <span style={styles.riderName}>{r.name}</span>
                      <span style={styles.riderCount}>
                        {r.nightCalls} night call{r.nightCalls === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  // Card — matches CorpsOverview styles.section exactly.
  section:  { background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 24 },
  h2:       { fontSize: 18, fontWeight: 700, color: '#1a3a6b', marginBottom: 8 },
  subtle:   { fontSize: 12, color: '#888', marginTop: 0, marginBottom: 16, lineHeight: 1.5 },
  loading:  { color: '#888', textAlign: 'center', padding: 40 },

  // Calendar grid
  grid:     { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 },
  weekday:  { fontSize: 12, fontWeight: 700, color: '#1a3a6b', textAlign: 'center', padding: '6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' },
  blankCell:{ minHeight: 96, borderRadius: 8, background: 'transparent' },

  // Plain day (no night calls)
  dayCell:  { minHeight: 96, borderRadius: 8, border: '1px solid #eee', background: '#fafbfc', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 },
  // Night-toned day (has night calls) — deep indigo border + tinted fill
  dayCellNight: { border: '1px solid #2c2c6b', background: '#eceaf6' },

  dayHeader:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  dayNumber:    { fontSize: 13, fontWeight: 700, color: '#999' },
  dayNumberNight: { color: '#2c2c6b' },
  countBadge:   { fontSize: 10, fontWeight: 700, color: '#fff', background: '#2c2c6b', borderRadius: 99, padding: '2px 7px', whiteSpace: 'nowrap' },

  // Individual call band inside a day
  callRow:  { background: '#dcd8f0', border: '1px solid #c4bee6', borderRadius: 6, padding: '4px 6px' },
  callTime: { fontSize: 11, fontWeight: 700, color: '#3a2c6b' },
  riderList:{ fontSize: 11, color: '#333', lineHeight: 1.35, marginTop: 1 },
  noRiders: { color: '#999' },

  // Summary
  summary:      { marginTop: 24, paddingTop: 20, borderTop: '1px solid #f0f0f0' },
  emptyMsg:     { fontSize: 14, color: '#888', textAlign: 'center', padding: '12px 0', margin: 0 },
  summaryGrid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, alignItems: 'start' },

  bigStat:  { background: '#fafbfc', border: '1px solid #eee', borderRadius: 8, padding: '18px 20px' },
  bigValue: { fontSize: 40, fontWeight: 800, color: '#2c2c6b', lineHeight: 1.05 },
  bigLabel: { fontSize: 13, color: '#444', marginTop: 6, fontWeight: 600 },
  bigSub:   { fontSize: 11, color: '#888', marginTop: 4 },

  ridersBlock:  { background: '#fafbfc', border: '1px solid #eee', borderRadius: 8, padding: '14px 18px' },
  ridersHeader: { fontSize: 13, fontWeight: 700, color: '#1a3a6b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' },
  ridersList:   { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  riderRow:     { display: 'flex', alignItems: 'center', gap: 10 },
  riderRank:    { fontSize: 15, fontWeight: 700, color: '#333', minWidth: 26, textAlign: 'center' },
  riderName:    { fontSize: 14, color: '#333', fontWeight: 600, flex: 1 },
  riderCount:   { fontSize: 13, color: '#666', fontWeight: 700, whiteSpace: 'nowrap' },
};
