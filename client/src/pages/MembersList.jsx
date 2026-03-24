import { useApi } from '../hooks/useApi';
import { getMembers } from '../api/client';
import MemberTable from '../components/Members/MemberTable';

export default function MembersList() {
  const { data: members, loading, error, refetch } = useApi(getMembers, []);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Members</h1>
        <div style={styles.meta}>
          {members && <span style={styles.count}>{members.length} active members</span>}
        </div>
      </div>

      <div style={styles.info}>
        <strong>Note:</strong> Members are created automatically when you import ESO or clock-in data.
        Click any member to view their detailed activity history and trend charts.
        Use the Edit function on a member's page to add their email address for periodic email reports.
      </div>

      {loading && <p style={styles.loading}>Loading members…</p>}
      {error   && <p style={styles.error}>Error: {error}</p>}
      {members && <MemberTable members={members} />}
    </div>
  );
}

const styles = {
  page:   { padding: '24px 32px', maxWidth: 1200, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  h1:     { fontSize: 26, fontWeight: 800, color: '#1a3a6b', margin: 0 },
  meta:   { display: 'flex', alignItems: 'center', gap: 12 },
  count:  { fontSize: 14, color: '#666', background: '#f0f4fa', padding: '4px 12px', borderRadius: 99, fontWeight: 600 },
  info:   { background: '#e3f2fd', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#1565c0', marginBottom: 20, lineHeight: 1.6 },
  loading:{ color: '#888', textAlign: 'center', padding: 40 },
  error:  { color: '#b71c1c', background: '#ffebee', padding: 16, borderRadius: 8 },
};
