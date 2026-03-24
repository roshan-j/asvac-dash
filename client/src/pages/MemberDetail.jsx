import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi, useMutation } from '../hooks/useApi';
import { getMemberSummary, getMemberTrend, getCorpsTrend, updateMember, sendMemberEmail } from '../api/client';
import MemberTrendChart from '../components/Charts/MemberTrendChart';
import { formatPeriod, vsAvg } from '../utils/format';

function CompareBar({ label, memberVal, corpsAvg }) {
  const diff = memberVal - corpsAvg;
  const color = diff >= 0 ? '#2e7d32' : '#e63946';
  return (
    <div style={styles.compareRow}>
      <span style={styles.compareLabel}>{label}</span>
      <span style={styles.compareMember}>{memberVal}</span>
      <span style={{ ...styles.compareDiff, color }}>
        {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)} vs avg {corpsAvg.toFixed(1)}
      </span>
    </div>
  );
}

export default function MemberDetail() {
  const { id } = useParams();
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [editing, setEditing] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSent,  setEmailSent]  = useState(null);

  const { data: summary,  loading: sl, refetch: refetchSummary }
    = useApi(getMemberSummary, [id, year, month], [id, year, month]);
  const { data: trend,    loading: tl }
    = useApi(getMemberTrend,  [id, 12],          [id]);
  const { data: corpsTrend }
    = useApi(getCorpsTrend,   [12],               []);

  const { mutate: saveEmail, loading: saving } = useMutation(updateMember);
  const { mutate: sendEmail, loading: sending } = useMutation(sendMemberEmail);

  async function handleSaveEmail() {
    await saveEmail(id, { email: emailInput });
    setEditing(false);
    refetchSummary();
  }

  async function handleSendEmail() {
    try {
      const res = await sendEmail(Number(id), year, month);
      setEmailSent({ success: true, msg: `Sent to ${res.to}` });
    } catch (err) {
      setEmailSent({ success: false, msg: err.message });
    }
  }

  if (sl) return <p style={styles.loading}>Loading…</p>;
  if (!summary) return <p style={styles.error}>Member not found.</p>;

  const { member, stats: s, corpsAvg, rank } = summary;
  const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div style={styles.page}>
      {/* Back + Header */}
      <Link to="/members" style={styles.back}>← All Members</Link>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>{member.name}</h1>
          <span style={styles.statusBadge}>{member.status}</span>
          {member.email
            ? <span style={styles.email}>{member.email}</span>
            : <span style={styles.noEmail}>No email on file</span>
          }
        </div>
        <div style={styles.controls}>
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
        </div>
      </div>

      {/* Edit email */}
      <div style={styles.emailSection}>
        {!editing ? (
          <button style={styles.secondaryBtn} onClick={() => { setEditing(true); setEmailInput(member.email || ''); }}>
            ✏️ {member.email ? 'Edit Email' : 'Add Email Address'}
          </button>
        ) : (
          <div style={styles.emailForm}>
            <input
              type="email"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              placeholder="member@example.com"
              style={styles.input}
            />
            <button style={styles.primaryBtn} onClick={handleSaveEmail} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button style={styles.secondaryBtn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        )}
        {member.email && (
          <button style={{ ...styles.primaryBtn, marginLeft: 10 }} onClick={handleSendEmail} disabled={sending}>
            {sending ? '📨 Sending…' : `📧 Email ${formatPeriod(year, month)} Report`}
          </button>
        )}
        {emailSent && (
          <span style={{ ...styles.emailFeedback, color: emailSent.success ? '#2e7d32' : '#b71c1c' }}>
            {emailSent.success ? '✅' : '❌'} {emailSent.msg}
          </span>
        )}
      </div>

      {/* Stats for period */}
      <div style={styles.cards}>
        {[
          { label: 'Riding Points',    value: s.ridingPoints,    color: '#1a3a6b' },
          { label: 'Non-Riding Points', value: s.nonridingPoints, color: '#4a90d9' },
          { label: 'Shift Sign-Ups',   value: s.shiftSignups,    color: '#2e7d32' },
          { label: 'Total Points',     value: s.totalPoints,     color: '#e63946' },
        ].map(c => (
          <div key={c.label} style={styles.card}>
            <div style={{ ...styles.cardVal, color: c.color }}>{c.value}</div>
            <div style={styles.cardLabel}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Ranking + Corps comparison */}
      <div style={styles.section}>
        <h2 style={styles.h2}>Corps Comparison — {formatPeriod(year, month)}</h2>
        {rank && (
          <p style={styles.rankBadge}>
            Ranked <strong>#{rank.position}</strong> of {rank.outOf} members this month
          </p>
        )}
        <CompareBar label="Riding Points"    memberVal={s.ridingPoints}  corpsAvg={corpsAvg.ridingPoints}   />
        <CompareBar label="Total Points"     memberVal={s.totalPoints}   corpsAvg={corpsAvg.combinedPoints} />
      </div>

      {/* 12-month trend chart */}
      <div style={styles.section}>
        <h2 style={styles.h2}>12-Month Trend</h2>
        {tl ? <p style={styles.loading}>Loading…</p> : <MemberTrendChart data={trend} corpsTrend={corpsTrend} />}
      </div>
    </div>
  );
}

const styles = {
  page:          { padding: '24px 32px', maxWidth: 1100, margin: '0 auto' },
  back:          { color: '#1a3a6b', textDecoration: 'none', fontSize: 13, display: 'inline-block', marginBottom: 12 },
  header:        { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  h1:            { fontSize: 26, fontWeight: 800, color: '#1a3a6b', margin: '0 0 6px' },
  h2:            { fontSize: 17, fontWeight: 700, color: '#1a3a6b', marginBottom: 14 },
  statusBadge:   { background: '#e8f5e9', color: '#2e7d32', borderRadius: 99, padding: '2px 10px', fontSize: 12, fontWeight: 700, marginRight: 10 },
  email:         { fontSize: 13, color: '#555' },
  noEmail:       { fontSize: 13, color: '#aaa', fontStyle: 'italic' },
  controls:      { display: 'flex', gap: 8 },
  select:        { padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14 },
  emailSection:  { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  emailForm:     { display: 'flex', gap: 8, alignItems: 'center' },
  input:         { padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, width: 240 },
  primaryBtn:    { background: '#1a3a6b', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn:  { background: '#f0f4fa', color: '#1a3a6b', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  emailFeedback: { fontSize: 13 },
  cards:         { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 22 },
  card:          { background: '#fff', borderRadius: 10, padding: '18px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.07)', textAlign: 'center' },
  cardVal:       { fontSize: 30, fontWeight: 800 },
  cardLabel:     { fontSize: 12, color: '#666', marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' },
  section:       { background: '#fff', borderRadius: 10, padding: 22, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginBottom: 20 },
  rankBadge:     { background: '#fff8e1', borderRadius: 6, padding: '8px 14px', fontSize: 14, display: 'inline-block', marginBottom: 14, color: '#f57f17' },
  compareRow:    { display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '1px solid #f0f0f0' },
  compareLabel:  { width: 160, fontSize: 13, color: '#555', fontWeight: 600 },
  compareMember: { fontSize: 18, fontWeight: 800, color: '#1a3a6b', width: 50 },
  compareDiff:   { fontSize: 13, fontWeight: 600 },
  loading:       { color: '#888', textAlign: 'center', padding: 40 },
  error:         { color: '#b71c1c' },
};
