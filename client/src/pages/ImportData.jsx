import { useApi } from '../hooks/useApi';
import { getImportHistory } from '../api/client';
import FileUploader from '../components/Upload/FileUploader';
import { formatDate } from '../utils/format';

export default function ImportData() {
  const { data: history, loading, refetch } = useApi(getImportHistory, []);

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Import Data</h1>

      <div style={styles.info}>
        <strong>Column mapping:</strong> The importer uses flexible column name matching.
        If your exports use non-standard headers, edit <code>COLUMN_MAP</code> in
        <code> server/services/esoParser.js</code> or <code>clockinParser.js</code>.
        Re-importing the same file is safe — duplicate records are automatically skipped.
      </div>

      <FileUploader onSuccess={refetch} />

      {/* Import History */}
      <div style={styles.section}>
        <h2 style={styles.h2}>Import History</h2>
        {loading ? <p style={styles.loading}>Loading…</p> : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Type', 'Batch', 'Date Range', 'Records'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(history || []).map((h, i) => (
                  <tr key={i} style={styles.row}>
                    <td style={styles.td}>
                      <span style={{ ...styles.typeBadge, background: h.type === 'eso' ? '#e3f2fd' : '#f3e5f5', color: h.type === 'eso' ? '#1565c0' : '#6a1b9a' }}>
                        {h.type === 'eso' ? 'ESO Riding' : 'Clock-In'}
                      </span>
                    </td>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12 }}>{h.import_batch}</td>
                    <td style={styles.td}>{formatDate(h.from_date)} → {formatDate(h.to_date)}</td>
                    <td style={styles.td}>{h.records}</td>
                  </tr>
                ))}
                {(!history || history.length === 0) && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#888' }}>No imports yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page:      { padding: '24px 32px', maxWidth: 1100, margin: '0 auto' },
  h1:        { fontSize: 26, fontWeight: 800, color: '#1a3a6b', marginBottom: 16 },
  h2:        { fontSize: 18, fontWeight: 700, color: '#1a3a6b', marginBottom: 14 },
  info:      { background: '#e3f2fd', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#1565c0', marginBottom: 24, lineHeight: 1.7 },
  section:   { background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', marginTop: 28 },
  loading:   { color: '#888', textAlign: 'center', padding: 40 },
  tableWrap: { overflowX: 'auto' },
  table:     { width: '100%', borderCollapse: 'collapse' },
  th:        { background: '#1a3a6b', color: '#fff', padding: '10px 14px', textAlign: 'left', fontSize: 13 },
  row:       { borderBottom: '1px solid #f0f0f0' },
  td:        { padding: '10px 14px', fontSize: 14 },
  typeBadge: { padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 },
};
