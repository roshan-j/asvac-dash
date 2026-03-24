/**
 * Email Service — Gmail / Nodemailer
 *
 * Sends periodic member activity emails via Gmail.
 *
 * Setup options (set in .env):
 *
 *   Option A — App Password (simpler, recommended for internal use):
 *     EMAIL_METHOD=password
 *     EMAIL_USER=your-gmail@gmail.com
 *     EMAIL_PASSWORD=your-app-password  (16-char Google App Password)
 *
 *   Option B — OAuth2:
 *     EMAIL_METHOD=oauth2
 *     EMAIL_USER=your-gmail@gmail.com
 *     EMAIL_CLIENT_ID=...
 *     EMAIL_CLIENT_SECRET=...
 *     EMAIL_REFRESH_TOKEN=...
 *
 * See README.md for full setup instructions.
 */

const nodemailer = require('nodemailer');
const db = require('../db/database');
const stats = require('./statsService');

function createTransport() {
  const method = process.env.EMAIL_METHOD || 'password';

  if (method === 'oauth2') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type:         'OAuth2',
        user:         process.env.EMAIL_USER,
        clientId:     process.env.EMAIL_CLIENT_ID,
        clientSecret: process.env.EMAIL_CLIENT_SECRET,
        refreshToken: process.env.EMAIL_REFRESH_TOKEN,
      },
    });
  }

  // Default: App Password
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
}

// ─── Email template ────────────────────────────────────────────────────────────

function buildEmailHtml(summary) {
  const { member, period, stats: s, corpsAvg, rank, trend } = summary;

  const monthName = new Date(period.year, period.month - 1).toLocaleString('default', {
    month: 'long', year: 'numeric',
  });

  const comparedRiding    = s.ridingPoints   >= corpsAvg.ridingPoints   ? '✅ above' : '⚠️ below';
  const comparedCombined  = s.totalPoints    >= corpsAvg.combinedPoints  ? '✅ above' : '⚠️ below';

  const trendRows = trend.slice(-6).map(t => `
    <tr>
      <td style="padding:4px 8px">${t.year}-${String(t.month).padStart(2,'0')}</td>
      <td style="padding:4px 8px;text-align:right">${t.ridingPoints}</td>
      <td style="padding:4px 8px;text-align:right">${t.nonridingPoints}</td>
      <td style="padding:4px 8px;text-align:right"><strong>${t.totalPoints}</strong></td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; }
    h1   { color: #1a3a6b; border-bottom: 2px solid #1a3a6b; padding-bottom: 8px; }
    h2   { color: #1a3a6b; font-size: 1rem; margin-top: 24px; }
    .card { background: #f4f7fb; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .stat { display: inline-block; margin: 8px 16px 8px 0; }
    .stat .value { font-size: 2rem; font-weight: bold; color: #1a3a6b; }
    .stat .label { font-size: 0.75rem; color: #666; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
    th    { background: #1a3a6b; color: white; padding: 6px 8px; text-align: left; }
    tr:nth-child(even) { background: #f0f4fa; }
    .footer { font-size: 0.75rem; color: #888; margin-top: 24px; border-top: 1px solid #ddd; padding-top: 12px; }
  </style>
</head>
<body>
  <h1>🚑 ASVAС Activity Report — ${monthName}</h1>
  <p>Hi ${member.name},</p>
  <p>Here's your activity summary for ${monthName}.</p>

  <div class="card">
    <div class="stat">
      <div class="value">${s.ridingPoints}</div>
      <div class="label">Riding Points</div>
    </div>
    <div class="stat">
      <div class="value">${s.nonridingPoints}</div>
      <div class="label">Non-Riding Points</div>
    </div>
    <div class="stat">
      <div class="value">${s.shiftSignups}</div>
      <div class="label">Shift Sign-Ups</div>
    </div>
    <div class="stat">
      <div class="value">${s.totalPoints}</div>
      <div class="label">Total Points</div>
    </div>
  </div>

  <h2>How You Compare to the Corps</h2>
  <div class="card">
    <p>Riding points: ${s.ridingPoints} vs. corps avg ${corpsAvg.ridingPoints.toFixed(1)} — ${comparedRiding} average</p>
    <p>Total points: ${s.totalPoints} vs. corps avg ${corpsAvg.combinedPoints.toFixed(1)} — ${comparedCombined} average</p>
    ${rank ? `<p>Your rank this month: <strong>#${rank.position} of ${rank.outOf} members</strong></p>` : ''}
  </div>

  <h2>Your 6-Month Trend</h2>
  <table>
    <thead>
      <tr>
        <th>Month</th>
        <th style="text-align:right">Riding</th>
        <th style="text-align:right">Non-Riding</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${trendRows}</tbody>
  </table>

  <p class="footer">
    This report was generated automatically by the ASVAС Activity Dashboard.<br>
    To view the full dashboard, visit your internal dashboard URL.<br>
    Questions? Contact your corps administrator.
  </p>
</body>
</html>
  `.trim();
}

// ─── Send single member email ──────────────────────────────────────────────────

async function sendMemberEmail(memberId, year, month) {
  const summary = stats.getMemberSummary(memberId, year, month);
  if (!summary.member.email) {
    throw new Error(`Member ${summary.member.name} has no email address on file.`);
  }

  const transport = createTransport();
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  await transport.sendMail({
    from: `"ASVAС Dashboard" <${process.env.EMAIL_USER}>`,
    to:   summary.member.email,
    subject: `Your ASVAС Activity Summary — ${monthName}`,
    html: buildEmailHtml(summary),
  });

  // Log it
  db.prepare(`
    INSERT INTO email_logs (member_id, period, success) VALUES (?, ?, 1)
  `).run(memberId, `${year}-${String(month).padStart(2,'0')}`);

  return { sent: true, to: summary.member.email, member: summary.member.name };
}

// ─── Send to all active members ────────────────────────────────────────────────

async function sendAllMemberEmails(year, month) {
  const members = stats.getAllMembers().filter(m => m.email);
  const results = [];

  for (const member of members) {
    try {
      const result = await sendMemberEmail(member.id, year, month);
      results.push({ ...result, success: true });
    } catch (err) {
      db.prepare(`
        INSERT INTO email_logs (member_id, period, success, error_msg) VALUES (?, ?, 0, ?)
      `).run(member.id, `${year}-${String(month).padStart(2,'0')}`, err.message);
      results.push({ member: member.name, success: false, error: err.message });
    }
  }

  return results;
}

module.exports = { sendMemberEmail, sendAllMemberEmails, buildEmailHtml };
