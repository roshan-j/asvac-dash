import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, LabelList,
} from 'recharts';
import { formatMonthLabel } from '../../utils/format';

// Custom tooltip — shows unique rides + person-rides + avg crew
function CrewTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={tt.box}>
      <div style={tt.label}>{label}</div>
      <div style={{ color: '#1a3a6b' }}>Unique rides: <strong>{d.uniqueRides}</strong></div>
      <div style={{ color: '#4a90d9' }}>Total person-rides: <strong>{d.personRides}</strong></div>
      <div style={{ color: '#e63946', fontWeight: 700, marginTop: 4 }}>
        Avg crew / call: {d['Avg Crew/Call']}
      </div>
    </div>
  );
}

const tt = {
  box:   { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.6 },
  label: { fontWeight: 700, marginBottom: 4, color: '#1a3a6b' },
};

export default function CrewPerCallChart({ data, selectedYear, selectedMonth }) {
  if (!data || data.length === 0) return <p style={styles.empty}>No data yet.</p>;

  const selectedLabel = selectedYear && selectedMonth
    ? formatMonthLabel(selectedYear, selectedMonth)
    : null;

  // Show only the most recent 12 months (data may be 24 to support YoY in the
  // sibling chart; here we only need the current year window).
  const recent = data.slice(-12);

  const chartData = recent.map(d => ({
    name:           formatMonthLabel(d.year, d.month),
    'Avg Crew/Call': parseFloat((d.riding.avgCrewPerCall || 0).toFixed(2)),
    uniqueRides:    d.riding.uniqueCalls || 0,
    personRides:    d.riding.totalCalls || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 18, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} domain={[0, dataMax => Math.max(4, Math.ceil(dataMax + 0.5))]} />
        <Tooltip content={<CrewTooltip />} cursor={{ fill: 'rgba(230, 57, 70, 0.06)' }} />
        {selectedLabel && (
          <ReferenceArea
            x1={selectedLabel}
            x2={selectedLabel}
            fill="#e63946"
            fillOpacity={0.10}
            stroke="#e63946"
            strokeOpacity={0.4}
          />
        )}
        <Bar dataKey="Avg Crew/Call" fill="#e63946" radius={[4, 4, 0, 0]}>
          <LabelList
            dataKey="Avg Crew/Call"
            position="top"
            style={{ fill: '#444', fontSize: 11, fontWeight: 600 }}
            formatter={v => v > 0 ? v.toFixed(1) : ''}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const styles = { empty: { color: '#888', textAlign: 'center', padding: 40 } };
