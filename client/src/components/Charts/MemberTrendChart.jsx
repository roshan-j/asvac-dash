import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { formatMonthLabel } from '../../utils/format';

export default function MemberTrendChart({ data, corpsTrend }) {
  if (!data || data.length === 0) return <p style={styles.empty}>No data yet.</p>;

  const chartData = data.map((d, i) => ({
    name:           formatMonthLabel(d.year, d.month),
    'Riding':       d.ridingPoints,
    'Non-Riding':   d.nonridingPoints,
    'Corps Avg':    corpsTrend?.[i]
      ? parseFloat(corpsTrend[i].combinedAvgPerMember.toFixed(1))
      : undefined,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorRiding" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#1a3a6b" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#1a3a6b" stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="colorNR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#4a90d9" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#4a90d9" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Area type="monotone" dataKey="Riding"     stroke="#1a3a6b" fill="url(#colorRiding)" strokeWidth={2} />
        <Area type="monotone" dataKey="Non-Riding" stroke="#4a90d9" fill="url(#colorNR)"     strokeWidth={2} />
        {corpsTrend && (
          <Area type="monotone" dataKey="Corps Avg" stroke="#e63946" fill="none" strokeWidth={2} strokeDasharray="5 3" dot={false} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

const styles = { empty: { color: '#888', textAlign: 'center', padding: 40 } };
