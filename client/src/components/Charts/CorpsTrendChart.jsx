import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { formatMonthLabel } from '../../utils/format';

export default function CorpsTrendChart({ data }) {
  if (!data || data.length === 0) return <p style={styles.empty}>No data yet.</p>;

  const chartData = data.map(d => ({
    name:         formatMonthLabel(d.year, d.month),
    'Riding Pts': d.riding.totalPoints,
    'Non-Riding': d.nonriding.totalPoints,
    'Avg/Member': parseFloat(d.combinedAvgPerMember.toFixed(1)),
    'Active Members': d.riding.activeMembers,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="points" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="avg" orientation="right" tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar yAxisId="points" dataKey="Riding Pts"  stackId="a" fill="#1a3a6b" radius={[0,0,0,0]} />
        <Bar yAxisId="points" dataKey="Non-Riding"  stackId="a" fill="#4a90d9" radius={[4,4,0,0]} />
        <Line yAxisId="avg"   dataKey="Avg/Member"  stroke="#e63946" strokeWidth={2} dot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const styles = { empty: { color: '#888', textAlign: 'center', padding: 40 } };
