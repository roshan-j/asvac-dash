import { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import { getCoverageReport, getNamedAsks } from '../api/client';

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BLOCKS = [
  { key: 'overnight', label: 'Overnight (10pm–6am)' },
  { key: 'morning',   label: 'Morning (6–10am)' },
  { key: 'day',       label: 'Day (10am–6pm)' },
  { key: 'evening',   label: 'Evening (6–10pm)' },
];
const TIER_COLOR = { spread: '#1a7f4b', fallback: '#8e44ad', cold: '#8a97a5' };

const fmtPhone = (p) => {
  if (!p) return null;
  const d = p.replace(/\D/g, '').replace(/^1/, '');
  return d.length === 10 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : p;
};
const firstName = (full) => full.split(' ')[0];

function smsText(person, slot) {
  const day = DOWS_FULL[slot.dow];
  const when = `${day} ${slot.blockRange}`;
  return `Hi ${firstName(person.name)} — we're short on ${when} coverage and you've come through for it before. Any chance you can grab that shift this week? Even 2 hours keeps our own calls from sliding to mutual aid. Thanks! — Roshan`;
}
const DOWS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function NamedAsks() {
  const { data: report } = useApi(getCoverageReport, [{}], []);
  const worst = report?.worstCells?.[0];
  const [slot, setSlot] = useState(null);        // {dow, block}
  const active = slot || (worst ? { dow: worst.dow, block: worst.block } : { dow: 6, block: 'evening' });

  const { data, loading, error } = useApi(getNamedAsks, [active.dow, active.block], [active.dow, active.block]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Named Asks</h1>
        <p style={styles.sub}>
          Pick a hole in the quilt. Get a ranked, tiered list of exactly who to text — spread-the-load
          candidates first, heroes as backup. Broadcast asks make heroes; named asks build breadth.
        </p>
      </div>

      {/* Quick-picks from the worst cells */}
      {report?.worstCells && (
        <div style={styles.quickWrap}>
          <span style={styles.quickLabel}>Worst slots:</span>
          {report.worstCells.slice(0, 6).map((c, i) => {
            const on = active.dow === c.dow && active.block === c.block;
            return (
              <button key={i} onClick={() => setSlot({ dow: c.dow, block: c.block })}
                      style={{ ...styles.quick, ...(on ? styles.quickOn : {}) }}>
                {c.dowLabel} {c.blockLabel} <span style={styles.quickPct}>{Math.round(c.missPct)}%</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Manual slot selectors */}
      <div style={styles.selectors}>
        <select value={active.dow} onChange={e => setSlot({ dow: +e.target.value, block: active.block })} style={styles.select}>
          {DOWS.map((d, i) => <option key={i} value={i}>{DOWS_FULL[i]}</option>)}
        </select>
        <select value={active.block} onChange={e => setSlot({ dow: active.dow, block: e.target.value })} style={styles.select}>
          {BLOCKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </div>

      {loading && !data && <p style={styles.muted}>Building ask list…</p>}
      {error && <p style={{ color: '#c0392b' }}>Error: {error}</p>}

      {data && (
        <>
          <div style={styles.slotBanner}>
            Target: <strong>{data.slot.dowLabel} {data.slot.blockLabel}</strong> ({data.slot.blockRange})
          </div>
          {data.tiers.map(tier => (
            <div key={tier.key} style={styles.tierCard}>
              <div style={styles.tierHead}>
                <span style={{ ...styles.tierDot, background: TIER_COLOR[tier.key] }} />
                <h2 style={styles.tierTitle}>{tier.title}</h2>
                <span style={styles.tierSub}>{tier.subtitle}</span>
              </div>
              {tier.people.length === 0 && <p style={styles.muted}>No candidates in this tier.</p>}
              {tier.people.map(p => (
                <PersonRow key={p.id} p={p} slot={data.slot} tierKey={tier.key} />
              ))}
            </div>
          ))}
          <p style={styles.foot}>
            Affinity = times they rode this slot (last 24mo) + times they signed up for it. Hero =
            top-10 active-adult rider ({data.heroCut}+ rides/yr). Everyone shown is on the current active-adult roster.
          </p>
        </>
      )}
    </div>
  );
}

function PersonRow({ p, slot, tierKey }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(smsText(p, slot));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={styles.person}>
      <div style={styles.personMain}>
        <span style={styles.personName}>{p.name}</span>
        <span style={styles.personMeta}>
          {p.crew > 0 ? `Crew ${p.crew}` : 'Day/Admin'} · rode this slot {p.slotRides}× · signed up {p.slotSignups}×
          {p.hero && <span style={styles.heroTag}>hero</span>}
        </span>
      </div>
      <div style={styles.personContact}>
        {p.phone && <a href={`sms:${p.phone.replace(/\D/g,'')}`} style={styles.contactLink}>{fmtPhone(p.phone)}</a>}
        {p.email && <a href={`mailto:${p.email}`} style={styles.contactEmail}>{p.email}</a>}
      </div>
      <button onClick={copy} style={{ ...styles.copyBtn, ...(copied ? styles.copyOn : {}) }}>
        {copied ? '✓ copied' : 'copy text'}
      </button>
    </div>
  );
}

const styles = {
  page: { padding: '28px 32px', maxWidth: 1000, margin: '0 auto' },
  header: { marginBottom: 18 },
  h1: { fontSize: 26, fontWeight: 800, color: '#1a2a3a', margin: 0, letterSpacing: '-0.5px' },
  sub: { color: '#5a6b7b', fontSize: 14, marginTop: 6, maxWidth: 720 },
  muted: { color: '#8a97a5', fontSize: 13 },

  quickWrap: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  quickLabel: { fontSize: 12, fontWeight: 700, color: '#8a97a5', textTransform: 'uppercase' },
  quick: { border: '1px solid #d4dce6', background: '#fff', color: '#3a4a5a', borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  quickOn: { background: '#1a3a6b', color: '#fff', border: '1px solid #1a3a6b' },
  quickPct: { opacity: 0.7, fontWeight: 700, marginLeft: 4 },

  selectors: { display: 'flex', gap: 10, marginBottom: 18 },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #d4dce6', fontSize: 14, background: '#fff', color: '#1a2a3a' },

  slotBanner: { fontSize: 15, color: '#1a2a3a', background: '#eef4ff', border: '1px solid #d4e2ff', borderRadius: 8, padding: '10px 14px', marginBottom: 16 },

  tierCard: { background: '#fff', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 4px rgba(20,40,70,0.08)', marginBottom: 14 },
  tierHead: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  tierDot: { width: 10, height: 10, borderRadius: '50%' },
  tierTitle: { fontSize: 16, fontWeight: 700, color: '#1a2a3a', margin: 0 },
  tierSub: { fontSize: 12.5, color: '#8a97a5' },

  person: { display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #eef1f5' },
  personMain: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  personName: { fontSize: 14, fontWeight: 600, color: '#1a2a3a' },
  personMeta: { fontSize: 12, color: '#8a97a5' },
  heroTag: { marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#8e44ad', background: '#f3e9fb', borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase' },
  personContact: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 },
  contactLink: { fontSize: 13, color: '#1a3a6b', textDecoration: 'none', fontWeight: 600 },
  contactEmail: { fontSize: 11.5, color: '#8a97a5', textDecoration: 'none' },
  copyBtn: { border: '1px solid #1a3a6b', background: '#fff', color: '#1a3a6b', borderRadius: 6, padding: '6px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  copyOn: { background: '#1a7f4b', color: '#fff', border: '1px solid #1a7f4b' },

  foot: { fontSize: 12, color: '#8a97a5', marginTop: 8, lineHeight: 1.5 },
};
