import { useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CONFIDENCE_LABELS = {
  exact:      { label: 'Exact',       color: '#2a7' },
  first_name: { label: 'First name',  color: '#e90' },
  partial:    { label: 'Partial',     color: '#e90' },
  fuzzy:      { label: 'Fuzzy',       color: '#e50' },
};

export default function AttendanceUploadModal({ onClose }) {
  const fileRef   = useRef(null);
  const [preview, setPreview]   = useState(null);   // parse result from /preview
  const [loading, setLoading]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState(null);
  const [done,    setDone]      = useState(null);   // commit result

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      const form = new FormData();
      form.append('file', file);
      const resp = await fetch(`${API_BASE}/api/attendance/preview`, { method: 'POST', body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Preview failed');
      setPreview({ ...data, filename: file.name });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/attendance/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year:       preview.year,
          month:      preview.month,
          type:       preview.type,
          mappings:   preview.matched.map(m => ({ memberId: m.memberId })),
          sourceFile: preview.filename,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Commit failed');
      setDone(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const styles = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    modal: {
      background: '#fff', borderRadius: 10, padding: '28px 32px',
      width: 560, maxWidth: '95vw', maxHeight: '85vh',
      overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
    },
    title: { margin: '0 0 18px', fontSize: 18, color: '#1a3a6b', fontWeight: 700 },
    dropzone: {
      border: '2px dashed #aac', borderRadius: 8, padding: '28px 16px',
      textAlign: 'center', cursor: 'pointer', color: '#557', background: '#f6f8fc',
      marginBottom: 16,
    },
    section: { marginTop: 18 },
    sectionTitle: { fontWeight: 700, color: '#1a3a6b', marginBottom: 8, fontSize: 14 },
    row: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 13 },
    pill: (color) => ({
      background: color + '22', color, borderRadius: 4,
      padding: '1px 7px', fontSize: 11, fontWeight: 700,
    }),
    btn: (primary) => ({
      padding: '9px 22px', borderRadius: 6, border: 'none', cursor: 'pointer',
      fontWeight: 700, fontSize: 14,
      background: primary ? '#1a3a6b' : '#eee',
      color: primary ? '#fff' : '#333',
    }),
    btnRow: { display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' },
    error: { background: '#fee', color: '#c00', padding: '8px 12px', borderRadius: 6, marginTop: 12, fontSize: 13 },
    success: { background: '#efe', color: '#272', padding: '12px 16px', borderRadius: 8, textAlign: 'center', fontSize: 15 },
    meta: { fontSize: 13, color: '#555', marginBottom: 10 },
  };

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <h2 style={styles.title}>📋 Upload Attendance CSV</h2>

        {/* Done state */}
        {done ? (
          <>
            <div style={styles.success}>
              ✅ Saved {done.saved} attendance record{done.saved !== 1 ? 's' : ''}
              {done.saved < done.total && ` (${done.total - done.saved} already existed)`}
            </div>
            <div style={styles.btnRow}>
              <button style={styles.btn(true)} onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            {/* File picker */}
            {!preview && (
              <div style={styles.dropzone} onClick={() => fileRef.current?.click()}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>📂</div>
                {loading ? 'Parsing…' : 'Click to choose a CSV or Excel attendance export'}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleFile}
                />
              </div>
            )}

            {/* Preview results */}
            {preview && (
              <>
                <div style={styles.meta}>
                  <strong>File:</strong> {preview.filename}<br />
                  <strong>Detected:</strong> Format {preview.format} —{' '}
                  {preview.type === 'meeting' ? '📅 Meeting' : '🎓 Training'},{' '}
                  {MONTH_NAMES[preview.month] || '?'} {preview.year}<br />
                  <strong>Names found:</strong> {preview.totalNames} &nbsp;·&nbsp;
                  <span style={{ color: '#2a7', fontWeight: 600 }}>{preview.matched.length} matched</span>
                  {preview.unmatched.length > 0 && (
                    <span style={{ color: '#c60', fontWeight: 600 }}>
                      {' '}· {preview.unmatched.length} unmatched
                    </span>
                  )}
                </div>

                {/* Matched list */}
                <div style={styles.section}>
                  <div style={styles.sectionTitle}>✅ Matched ({preview.matched.length})</div>
                  {preview.matched.map((m, i) => (
                    <div key={i} style={styles.row}>
                      <span style={{ flex: 1 }}>{m.rawName}</span>
                      <span style={{ color: '#888', fontSize: 12 }}>→</span>
                      <span style={{ flex: 1, fontWeight: 600 }}>{m.memberName}</span>
                      {CONFIDENCE_LABELS[m.confidence] && (
                        <span style={styles.pill(CONFIDENCE_LABELS[m.confidence].color)}>
                          {CONFIDENCE_LABELS[m.confidence].label}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Unmatched list */}
                {preview.unmatched.length > 0 && (
                  <div style={styles.section}>
                    <div style={styles.sectionTitle}>⚠️ Unmatched — will be skipped ({preview.unmatched.length})</div>
                    {preview.unmatched.map((u, i) => (
                      <div key={i} style={styles.row}>
                        <span style={{ flex: 1, color: '#a33', fontWeight: 600 }}>{u.rawName}</span>
                        {u.suggestions?.length > 0 && (
                          <span style={{ fontSize: 11, color: '#888' }}>
                            Did you mean: {u.suggestions.map(s => s.name).join(' / ')}?
                          </span>
                        )}
                      </div>
                    ))}
                    <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                      Add these as aliases in the DB to auto-match next time.
                    </div>
                  </div>
                )}
              </>
            )}

            {error && <div style={styles.error}>⚠️ {error}</div>}

            <div style={styles.btnRow}>
              <button style={styles.btn(false)} onClick={onClose}>Cancel</button>
              {preview && (
                <button style={styles.btn(true)} onClick={handleCommit} disabled={saving}>
                  {saving ? 'Saving…' : `Save ${preview.matched.length} attendance records`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
