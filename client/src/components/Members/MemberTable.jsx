import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function MemberTable({ members, year, month }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <input
        type="text"
        placeholder="Search members…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={styles.search}
      />
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Name', 'Email', 'Status', 'Actions'].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => (
              <tr key={m.id} style={styles.row} onClick={() => navigate(`/members/${m.id}`)}>
                <td style={styles.td}><strong>{m.name}</strong></td>
                <td style={styles.td}>{m.email || <span style={styles.noEmail}>No email</span>}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.badge, background: m.status === 'active' ? '#e8f5e9' : '#fafafa', color: m.status === 'active' ? '#2e7d32' : '#888' }}>
                    {m.status}
                  </span>
                </td>
                <td style={styles.td}>
                  <button
                    style={styles.viewBtn}
                    onClick={e => { e.stopPropagation(); navigate(`/members/${m.id}`); }}
                  >
                    View →
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#888' }}>No members found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles = {
  search: {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd',
    fontSize: 14, marginBottom: 16, outline: 'none',
  },
  tableWrap: { overflowX: 'auto', borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff' },
  th: {
    background: '#1a3a6b', color: '#fff',
    padding: '12px 16px', textAlign: 'left', fontSize: 13, fontWeight: 600,
  },
  row: { borderBottom: '1px solid #f0f0f0', cursor: 'pointer', transition: 'background 0.1s' },
  td: { padding: '12px 16px', fontSize: 14 },
  noEmail: { color: '#aaa', fontStyle: 'italic', fontSize: 13 },
  badge: { padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600 },
  viewBtn: {
    background: '#f0f4fa', border: 'none', borderRadius: 6,
    padding: '6px 14px', fontSize: 13, cursor: 'pointer', color: '#1a3a6b', fontWeight: 600,
  },
};
