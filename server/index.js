require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cron    = require('node-cron');

const dataRoutes       = require('./routes/data');
const emailRoutes      = require('./routes/email');
const sheetsRoutes     = require('./routes/sheets');
const reportsRoutes    = require('./routes/reports');
const coverageRoutes   = require('./routes/coverage');
const attendanceRoutes = require('./routes/attendance');
const { router: authRoutes } = require('./routes/auth');
const { syncDutyboard }       = require('./services/sheetsService');
const { syncPersonnelTypes }  = require('./services/personnelSyncService');
const { seedAll }             = require('./services/officerSeedService');
const { syncStandbyEvents }   = require('./services/standbySyncService');
const { seedCrewRoster }      = require('./services/crewRosterService');
const { syncNightShifts }     = require('./services/nightShiftService');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/data',       dataRoutes);
app.use('/api/email',      emailRoutes);
app.use('/api/sheets',     sheetsRoutes);
app.use('/api/reports',    reportsRoutes);
app.use('/api/coverage',   coverageRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/auth',       authRoutes);

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

// ─── Night-crew ICS sync (powers the Annual Report) ───────────────────────────
const NIGHTSHIFT_CRON = process.env.NIGHTSHIFT_SYNC_CRON || '15 3 * * *';

async function runNightSync(label = 'scheduled') {
  try {
    const result = await syncNightShifts();
    console.log(`[nightshift:${label}] ${result.synced} nights synced (${result.eventsScanned} events scanned).`);
  } catch (err) {
    console.error(`[nightshift:${label}] Sync failed:`, err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`ASVAС Dashboard server running on http://localhost:${PORT}`);

  // Seed officer credits, missing members, and one-off credits (idempotent)
  seedAll();

  // Seed night-crew roster from server/config/crew_roster.json (idempotent)
  try { seedCrewRoster(); } catch (err) {
    console.warn('[roster] Seed failed (non-fatal):', err.message);
  }

  // Sync personnel types from PERSONNEL sheets
  await syncPersonnelTypes();

  // Sync standby/event points from events sheet
  try {
    const sbResult = await syncStandbyEvents();
    console.log(`[standby:startup] ${sbResult.synced} event records synced`);
  } catch (err) {
    console.error('[standby:startup] Sync failed:', err.message);
  }

  // Sync once immediately on startup
  await runSync('startup');
  await runNightSync('startup');

  // Then schedule recurring syncs
  if (SYNC_CRON !== 'disabled') {
    if (cron.validate(SYNC_CRON)) {
      cron.schedule(SYNC_CRON, () => runSync('cron'));
      console.log(`[sheets] Auto-sync scheduled: "${SYNC_CRON}"`);
    } else {
      console.warn(`[sheets] Invalid SHEETS_SYNC_CRON value: "${SYNC_CRON}" — auto-sync disabled`);
    }
  }

  if (NIGHTSHIFT_CRON !== 'disabled') {
    if (cron.validate(NIGHTSHIFT_CRON)) {
      cron.schedule(NIGHTSHIFT_CRON, () => runNightSync('cron'));
      console.log(`[nightshift] Auto-sync scheduled: "${NIGHTSHIFT_CRON}"`);
    } else {
      console.warn(`[nightshift] Invalid NIGHTSHIFT_SYNC_CRON value: "${NIGHTSHIFT_CRON}" — auto-sync disabled`);
    }
  }
});
