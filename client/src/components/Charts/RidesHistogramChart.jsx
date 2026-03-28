import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const COLORS = ['#1a3a6b', '#1f4d8c', '#2461ad', '#2e7d32', '#388e3c'];

export default function RidesHistogramChart({ data }) {
  // Filter to riders only, sorted highest → lowest
  const riders = (data || [])
    .filter(d => d.ridingPoints > 0)
    .sort((a, b) => b.ridingPoints - a.ridingPoints);

  if (riders.length === 0) return <p style={styles.empty}>No rides recorded for this period.</p>;

  const total = riders.reduce((s, d) => s + d.ridingPoints, 0);

  const chartData = riders.map(d => ({
    name:   d.name.split(' ').slice(-1)[0], // last name for brevity on axis
    full:   d.name,
    points: d.ridingPoints,
    pct:    ((d.ridingPoints / total) * 100).toFixed(1),
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={styles.tooltip}>
        <div style={styles.tooltipName}>{d.full}</div>
        <div><strong>{d.points}</strong> riding pts</div>
        <div style={{ color: '#888' }}>{d.pct}% of total</div>
      </div>
    );
  };

  return (
    <div>
      <p style={styles.sub}>
        {riders.length} active rider{riders.length !== 1 ? 's' : ''} · {total} total riding points
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11 }}
            angle={-45}
            textAnchor="end"
            interval={0}
          />
          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="points" radius={[3, 3, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const styles = {
  empty:       { color: '#888', textAlign: 'center', padding: 40 },
  sub:         { fontSize: 12, color: '#888', margin: '0 0 8px' },
  tooltip:     { background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 12px', fontSize: 13 },
  tooltipName: { fontWeight: 700, marginBottom: 4, color: '#1a3a6b' },
};
