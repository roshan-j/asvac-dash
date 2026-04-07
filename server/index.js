require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cron    = require('node-cron');

const dataRoutes    = require('./routes/data');
const emailRoutes   = require('./routes/email');
const sheetsRoutes  = require('./routes/sheets');
const reportsRoutes    = require('./routes/reports');
const attendanceRoutes = require('./routes/attendance');
const { syncDutyboard }       = require('./services/sheetsService');
const { syncPersonnelTypes }  = require('./services/personnelSyncService');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/data',    dataRoutes);
app.use('/api/email',   emailRoutes);
app.use('/api/sheets',  sheetsRoutes);
app.use('/api/reports',    reportsRoutes);
app.use('/api/attendance', attendanceRoutes);

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Serve React build in production ──────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '../client/dist');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

// ─── Dutyboard auto-sync ───────────────────────────────────────────────────────
// Default: sync every hour. Override with SHEETS_SYNC_CRON in .env.
// Set SHEETS_SYNC_CRON=disabled to turn off auto-sync entirely.
const SYNC_CRON = process.env.SHEETS_SYNC_CRON || '0 * * * *';

async function runSync(label = 'scheduled') {
  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_API_KEY) return;
  try {
    const result = await syncDutyboard();
    console.log(`[sheets:${label}] ${result.synced} signups synced across ${result.tabs.length} tabs`);
    if (result.errors.length) console.warn('[sheets] Errors:', result.errors);
  } catch (err) {
    console.error(`[sheets:${label}] Sync failed:`, err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`ASVAС Dashboard server running on http://localhost:${PORT}`);

  // Sync personnel types from PERSONNEL sheets
  await syncPersonnelTypes();

  // Sync once immediately on startup
  await runSync('startup');

  // Then schedule recurring sync
  if (SYNC_CRON !== 'disabled') {
    if (cron.validate(SYNC_CRON)) {
      cron.schedule(SYNC_CRON, () => runSync('cron'));
      console.log(`[sheets] Auto-sync scheduled: "${SYNC_CRON}"`);
    } else {
      console.warn(`[sheets] Invalid SHEETS_SYNC_CRON value: "${SYNC_CRON}" — auto-sync disabled`);
    }
  }
});
