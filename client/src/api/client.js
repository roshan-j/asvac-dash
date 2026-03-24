import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({ baseURL: BASE_URL });

// ── Data / Stats ──────────────────────────────────────────────────────────────
export const getPeriods         = ()            => api.get('/api/data/periods').then(r => r.data);
export const getMembers         = ()            => api.get('/api/data/members').then(r => r.data);
export const updateMember       = (id, body)    => api.put(`/api/data/members/${id}`, body).then(r => r.data);
export const getCorpsTrend      = (months = 12) => api.get(`/api/data/corps/trend?months=${months}`).then(r => r.data);
export const getCorpsMonth      = (year, month) => api.get(`/api/data/corps/month?year=${year}&month=${month}`).then(r => r.data);
export const getLeaderboard     = (year, month) => api.get(`/api/data/leaderboard?year=${year}&month=${month}`).then(r => r.data);
export const getMemberTrend     = (id, months)  => api.get(`/api/data/members/${id}/trend?months=${months}`).then(r => r.data);
export const getMemberSummary   = (id, y, m)    => api.get(`/api/data/members/${id}/summary?year=${y}&month=${m}`).then(r => r.data);
export const getImportHistory   = ()            => api.get('/api/data/import-history').then(r => r.data);

// ── File Upload ───────────────────────────────────────────────────────────────
export const uploadEso = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/api/data/upload/eso', form).then(r => r.data);
};
export const uploadClockin = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/api/data/upload/clockin', form).then(r => r.data);
};

// ── Sheets ────────────────────────────────────────────────────────────────────
export const syncSheets = () => api.post('/api/sheets/sync').then(r => r.data);
export const getShifts  = (params) => api.get('/api/sheets/shifts', { params }).then(r => r.data);

// ── Email ─────────────────────────────────────────────────────────────────────
export const sendMemberEmail = (memberId, year, month) =>
  api.post('/api/email/send-member', { memberId, year, month }).then(r => r.data);
export const sendAllEmails = (year, month) =>
  api.post('/api/email/send-all', { year, month }).then(r => r.data);
export const getEmailLogs = () => api.get('/api/email/logs').then(r => r.data);
