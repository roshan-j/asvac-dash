import { useState, useRef } from 'react';
import { uploadEso, uploadClockin, syncSheets } from '../../api/client';

const UPLOAD_TYPES = [
  {
    key:    'eso',
    label:  'ESO Call Records',
    desc:   'CSV or Excel export from ESO containing per-call records with responding members',
    accept: '.csv,.xlsx,.xls',
    fn:     uploadEso,
    color:  '#1a3a6b',
  },
  {
    key:    'clockin',
    label:  'Clock-In / Non-Riding',
    desc:   'CSV or Excel export from your clock-in system (meetings, training, maintenance, etc.)',
    accept: '.csv,.xlsx,.xls',
    fn:     uploadClockin,
    color:  '#4a90d9',
  },
];

function UploadCard({ type }) {
  const [status,  setStatus]  = useState(null);   // null | 'uploading' | 'success' | 'error'
  const [result,  setResult]  = useState(null);
  const [message, setMessage] = useState('');
  const inputRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('uploading');
    setResult(null);
    try {
      const res = await type.fn(file);
      setResult(res);
      setStatus('success');
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
      setStatus('error');
    }
    e.target.value = '';
  }

  return (
    <div style={{ ...styles.card, borderTop: `4px solid ${type.color}` }}>
      <h3 style={{ ...styles.cardTitle, color: type.color }}>{type.label}</h3>
      <p style={styles.cardDesc}>{type.desc}</p>

      <button
        style={{ ...styles.btn, background: type.color }}
        onClick={() => inputRef.current?.click()}
        disabled={status === 'uploading'}
      >
        {status === 'uploading' ? '⏳ Uploading…' : '📂 Choose File'}
      </button>
      <input ref={inputRef} type="file" accept={type.accept} onChange={handleFile} style={{ display: 'none' }} />

      {status === 'success' && result && (
        <div style={styles.success}>
          ✅ Imported <strong>{result.inserted}</strong> records
          {result.skipped > 0 && <>, skipped {result.skipped} duplicates</>}
          <br />
          <small>Batch ID: {result.batchId}</small>
        </div>
      )}
      {status === 'error' && (
        <div style={styles.error}>❌ {message}</div>
      )}
    </div>
  );
}

function SheetsSyncCard() {
  const [status,  setStatus]  = useState(null);
  const [result,  setResult]  = useState(null);
  const [message, setMessage] = useState('');

  async function handleSync() {
    setStatus('syncing');
    setResult(null);
    try {
      const res = await syncSheets();
      setResult(res);
      setStatus('success');
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
      setStatus('error');
    }
  }

  return (
    <div style={{ ...styles.card, borderTop: '4px solid #2e7d32' }}>
      <h3 style={{ ...styles.cardTitle, color: '#2e7d32' }}>Google Sheets — Shift Signups</h3>
      <p style={styles.cardDesc}>
        Pulls the latest shift signup data from all tabs of your configured Google Sheet.
        Requires <code>GOOGLE_SHEET_ID</code> and service account credentials to be configured (see README).
      </p>

      <button
        style={{ ...styles.btn, background: '#2e7d32' }}
        onClick={handleSync}
        disabled={status === 'syncing'}
      >
        {status === 'syncing' ? '⏳ Syncing…' : '🔄 Sync from Google Sheets'}
      </button>

      {status === 'success' && result && (
        <div style={styles.success}>
          ✅ Synced <strong>{result.synced}</strong> shift signups across {result.tabs?.length} tabs
          {result.errors?.length > 0 && (
            <ul style={{ marginTop: 8 }}>
              {result.errors.map((e, i) => <li key={i} style={{ color: '#b71c1c' }}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
      {status === 'error' && <div style={styles.error}>❌ {message}</div>}
    </div>
  );
}

export default function FileUploader() {
  return (
    <div>
      <h2 style={styles.sectionTitle}>Import Data</h2>
      <div style={styles.grid}>
        {UPLOAD_TYPES.map(t => <UploadCard key={t.key} type={t} />)}
        <SheetsSyncCard />
      </div>
    </div>
  );
}

const styles = {
  sectionTitle: { fontSize: 22, fontWeight: 700, marginBottom: 20, color: '#1a3a6b' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 },
  card: {
    background: '#fff',
    borderRadius: 10,
    padding: 24,
    boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
  },
  cardTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 8px' },
  cardDesc:  { fontSize: 13, color: '#555', margin: '0 0 16px', lineHeight: 1.5 },
  btn: {
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  success: { marginTop: 14, padding: 12, background: '#e8f5e9', borderRadius: 6, fontSize: 13, color: '#1b5e20' },
  error:   { marginTop: 14, padding: 12, background: '#ffebee', borderRadius: 6, fontSize: 13, color: '#b71c1c' },
};
