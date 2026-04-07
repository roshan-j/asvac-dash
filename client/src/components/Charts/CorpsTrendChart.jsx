import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceArea,
} from 'recharts';
import { formatMonthLabel } from '../../utils/format';

// Custom tooltip — shows current + prior year side by side
function YoYTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const get = key => payload.find(p => p.dataKey === key)?.value ?? null;

  const riding    = get('Riding Pts');
  const nonRiding = get('Non-Riding');
  const avg       = get('Avg/Member');
  const prior     = get('Prior Year');
  const total     = riding != null && nonRiding != null ? riding + nonRiding : null;

  return (
    <div style={tt.box}>
      <div style={tt.label}>{label}</div>
      {riding    != null && <div style={{ color: '#1a3a6b'  }}>Riding: {riding}</div>}
      {nonRiding != null && <div style={{ color: '#4a90d9'  }}>Non-Riding: {nonRiding}</div>}
      {total     != null && <div style={{ color: '#333', fontWeight: 700 }}>Total: {total}</div>}
      {avg       != null && <div style={{ color: '#e63946'  }}>Avg/Member: {avg}</div>}
      {prior     != null && (
        <div style={{ color: '#aaa', borderTop: '1px solid #eee', marginTop: 4, paddingTop: 4 }}>
          Prior year total: {prior}
          {total != null && prior > 0 && (
            <span style={{ marginLeft: 6, color: total >= prior ? '#2e7d32' : '#c62828' }}>
              ({total >= prior ? '+' : ''}{Math.round(((total - prior) / prior) * 100)}%)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const tt = {
  box:   { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.6 },
  label: { fontWeight: 700, marginBottom: 4, color: '#1a3a6b' },
};

export default function CorpsTrendChart({ data, selectedYear, selectedMonth }) {
  if (!data || data.length === 0) return <p style={styles.empty}>No data yet.</p>;

  const selectedLabel = selectedYear && selectedMonth
    ? formatMonthLabel(selectedYear, selectedMonth)
    : null;

  // Split: prior year = first half, current year = second half
  const half    = Math.floor(data.length / 2);
  const prior12 = data.slice(0, half);
  const curr12  = data.slice(data.length - half);

  const chartData = curr12.map((d, i) => {
    const py = prior12[i];
    const priorTotal = py ? py.riding.totalPoints + py.nonriding.totalPoints : null;
    return {
      name:           formatMonthLabel(d.year, d.month),
      'Riding Pts':   d.riding.totalPoints,
      'Non-Riding':   d.nonriding.totalPoints,
      'Avg/Member':   parseFloat(d.combinedAvgPerMember.toFixed(1)),
      'Prior Year':   priorTotal,
    };
  });

  // Check if there's any prior year data worth showing
  const hasPriorData = chartData.some(d => d['Prior Year'] != null && d['Prior Year'] > 0);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="points" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="avg" orientation="right" tick={{ fontSize: 12 }} />
        <Tooltip content={<YoYTooltip />} />
        <Legend />
        {selectedLabel && (
          <ReferenceArea
            yAxisId="points"
            x1={selectedLabel}
            x2={selectedLabel}
            fill="#e63946"
            fillOpacity={0.12}
            stroke="#e63946"
            strokeOpacity={0.4}
          />
        )}
        <Bar yAxisId="points" dataKey="Riding Pts" stackId="a" fill="#1a3a6b" radius={[0,0,0,0]} />
        <Bar yAxisId="points" dataKey="Non-Riding" stackId="a" fill="#4a90d9" radius={[4,4,0,0]} />
        <Line yAxisId="avg" dataKey="Avg/Member" stroke="#e63946" strokeWidth={2} dot={{ r: 4 }} />
        {hasPriorData && (
          <Line
            yAxisId="points"
            dataKey="Prior Year"
            stroke="#aaa"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={{ r: 3, fill: '#aaa' }}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const styles = { empty: { color: '#888', textAlign: 'center', padding: 40 } };
