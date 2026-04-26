/**
 * Google OAuth2 auth routes
 *
 * GET /api/auth/google          — start consent flow
 * GET /api/auth/google/callback — exchange code → store tokens → redirect to client
 * GET /api/auth/google/status   — check whether tokens are stored
 */

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');

const TOKENS_PATH    = path.join(__dirname, '..', '.google-oauth-tokens.json');
const CLIENT_ORIGIN  = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const REDIRECT_URI   = `${process.env.SERVER_ORIGIN || 'http://localhost:3001'}/api/auth/google/callback`;

function buildOAuth2Client() {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    REDIRECT_URI
  );
}

// GET /api/auth/google — redirect to consent screen
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return res.status(503).send('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set in .env');
  }
  const oauth2Client = buildOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
    prompt: 'consent',            // force refresh_token on every consent
  });
  res.redirect(url);
});

// GET /api/auth/google/callback — exchange code, save tokens, redirect to client
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`${CLIENT_ORIGIN}?sheetsAuthError=1`);
  }
  try {
    const oauth2Client  = buildOAuth2Client();
    const { tokens }    = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
    console.log('[auth] Google OAuth2 tokens stored — Drive access granted');
    res.redirect(`${CLIENT_ORIGIN}?sheetsAuthDone=1`);
  } catch (err) {
    console.error('[auth] Token exchange failed:', err.message);
    res.redirect(`${CLIENT_ORIGIN}?sheetsAuthError=1`);
  }
});

// GET /api/auth/google/status — { connected: bool }
router.get('/google/status', (req, res) => {
  const connected = fs.existsSync(TOKENS_PATH);
  res.json({ connected });
});

module.exports = { router, TOKENS_PATH, buildOAuth2Client };
