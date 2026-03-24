import { useState } from 'react';
import { useApi, useMutation } from '../hooks/useApi';
import { getMembers, getEmailLogs, sendAllEmails, sendMemberEmail } from '../api/client';
import { formatDate, formatPeriod } from '../utils/format';

export default function EmailReports() {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [result, setResult] = useState(null);

  const { data: members } = useApi(getMembers, []);
  const { data: logs, refetch: refetchLogs } = useApi(getEmailLogs, []);
  const { mutate: sendAll, loading: sending } = useMutation(sendAllEmails);

  const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => i + 1);

  async function handleSendAll() {
    if (!window.confirm(`Send email reports for ${formatPeriod(year, month)} to ALL members with emails on file?`)) return;
    try {
      const res = await sendAll(year, month);
      setResult(res);
      refetchLogs();
    } catch (err) {
      setResult({ error: err.message });
    }
  }

  const membersWithEmail    = (members || []).filter(m => m.email);
  const membersWithoutEmail = (members || []).filter(m => !m.email);

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Email Reports</h1>

      {/* Period selector + bulk send */}
      <div style={styles.section}>
        <h2 style={styles.h2}>Send Monthly Reports</h2>
        <p style={styles.desc}>
          Send each member a personalized email with their activity stats, corps comparison,
          and 6-month trend for the selected period. Only members with an email address on file will receive an email.
        </p>
        <div style={styles.row}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={styles.select}>
            {MONTH_OPTS.map(m => (
              <option key={m} value={m}>{new Date(2000, m-1).toLocaleString('default', { month: 'long' })}</option>
            ))}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={styles.select}>
            {[now.getFullYear(), now.getFullYear()-1, now.getFullYear()-2].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button style={styles.primaryBtn} onClick={handleSendAll} disabled={sending}>
            {sending ? '📨 Sending…' : `📧 Send to All (${membersWithEmail.length} members)`}
          </button>
        </div>

        {result && !result.error && (
          <div style={styles.success}>
            ✅ Sent: <strong>{result.sent}</strong> &nbsp;|&nbsp;
            Failed: <strong>{result.failed}</strong>
            {result.details?.filter(d => !d.success).map((d, i) => (
              <div key={i} style={styles.failRow}>❌ {d.member}: {d.error}</div>
            ))}
          </div>
        )}
        {result?.error && <div style={styles.error}>❌ {result.error}</div>}
      </div>

      {/* Members without email */}
      {membersWithoutEmail.length > 0 && (
        <div style={styles.warnSection}>
          <h3 style={styles.warnTitle}>⚠️ {membersWithoutEmail.length} members have no email address</h3>
          <p style={styles.warnDesc}>Go to each member's page to add their email.</p>
          <div style={styles.noEmailList}>
            {membersWithoutEmail.map(m => (
              <span key={m.id} style={styles.noEmailChip}>{m.name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Email logs */}
      <div style={styles.section}>
        <h2 style={styles.h2}>Recent Email Log</h2>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Member', 'Period', 'Sent At', 'Status'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(logs || []).map(log => (
                <tr key={log.id} style={styles.row}>
                  <td style={styles.td}>{log.member_name || '—'}</td>
                  <td style={styles.td}>{log.period}</td>
                  <td style={styles.td}>{formatDate(log.sent_at)}</td>
                  <td style={styles.td}>
                    <span style={{ color: log.success ? '#2e7d32' : '#b71c1c', fontWeight: 700 }}>
                      {log.success ? '✅ Sent' : '❌ Failed'}
                    </span>
                    {log.error_msg && <span style={{ fontSize: 12, color: '#b71c1c', marginLeft: 8 }}>{log.error_msg}</span>}
                  </td>
                </tr>
              ))}
              {(!logs || logs.length === 0) && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#888' }}>No emails sent yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page:       { padding: '24px 32px', maxWidth: 1100, margin: '0 auto' },
  h1:         { fontSize: 26, fontWeight: 800, color: '#1a3a6b', marginBottom: 24 },
  h2:         { fontSize: 18, fontWeight: 700, color: '#1a3a6b', marginBottom: 12 },
  desc:       { fontSize: 14, color: '#555', marginBottom: 16, lineHeight: 1.6 },
  section:    { background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 20 },
  warnSection:{ background: '#fff8e1', borderRadius: 10, padding: 20, marginBottom: 20, border: '1px solid #ffe082' },
  warnTitle:  { margin: '0 0 6px', fontSize: 15, color: '#f57f17' },
  warnDesc:   { margin: '0 0 12px', fontSize: 13, color: '#795548' },
  noEmailList:{ display: 'flex', flexWrap: 'wrap', gap: 8 },
  noEmailChip:{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 99, padding: '3px 12px', fontSize: 13, color: '#e65100' },
  row2:       { display: 'flex', alignItems: 'center', gap: 12 },
  row:        { borderBottom: '1px solid #f0f0f0' },
  select:     { padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14 },
  primaryBtn: { background: '#1a3a6b', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  success:    { marginTop: 14, padding: 12, background: '#e8f5e9', borderRadius: 6, fontSize: 13, color: '#1b5e20' },
  error:      { marginTop: 14, padding: 12, background: '#ffebee', borderRadius: 6, fontSize: 13, color: '#b71c1c' },
  failRow:    { marginTop: 6, fontSize: 12 },
  tableWrap:  { overflowX: 'auto' },
  table:      { width: '100%', borderCollapse: 'collapse' },
  th:         { background: '#1a3a6b', color: '#fff', padding: '10px 14px', textAlign: 'left', fontSize: 13 },
  td:         { padding: '10px 14px', fontSize: 14 },
};

// Also add missing `row` in styles — it's defined, just in a later position
Object.assign(styles, {
  row: { ...styles.row },
});
