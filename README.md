# 🚑 ASVAС Activity Dashboard

A volunteer activity tracking dashboard for the **Ardsley Secor Volunteer Ambulance Corps**.

Tracks riding points (from ESO), non-riding points (from your clock-in system), and shift signups (from Google Sheets) — with charts, a print view, and periodic member email reports.

---

## Features

- **Corps Overview** — monthly stat cards, 12-month trend chart, leaderboard
- **Per-Member View** — individual stats vs. corps averages, 12-month trend chart
- **CSV/Excel Import** — drag-and-drop upload for ESO call records and clock-in exports
- **Google Sheets Sync** — pulls shift signups from all tabs of your configured sheet
- **Print View** — clean printable/PDF report at `/print?year=YYYY&month=M`
- **Email Reports** — sends each member a personalized monthly email via Gmail

---

## Tech Stack

| Layer    | Technology                               |
|----------|------------------------------------------|
| Frontend | React 18 + Vite, Recharts, React Router  |
| Backend  | Node.js + Express                        |
| Database | SQLite (via better-sqlite3)              |
| Email    | Nodemailer + Gmail                       |
| Sheets   | Google Sheets API v4                     |

---

## Quick Start

### 1. Prerequisites

- **Node.js 18+** and npm
- A Google account (for Sheets + Gmail)
- Build tools for native modules: `python3`, `make`, `g++`
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install python3 build-essential`

### 2. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/asvaс-dashboard.git
cd asvaс-dashboard
npm run install:all
```

### 3. Configure environment

```bash
cp .env.example .env
cp client/.env.example client/.env
```

Edit `.env` with your settings (see **Configuration** below).

### 4. Run in development

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

---

## Configuration

### ESO & Clock-In Column Mapping

If your CSV/Excel exports use different column names than the defaults, edit the `COLUMN_MAP` objects at the top of:

- `server/services/esoParser.js` — riding points (ESO call records)
- `server/services/clockinParser.js` — non-riding points (clock-in system)

Each map lists accepted aliases for each field. The importer will match case-insensitively.

**ESO expected columns:**
| Field          | Default aliases                                              |
|----------------|--------------------------------------------------------------|
| Call Number    | incident number, call number, run number                     |
| Date           | incident date, call date, date, run date                     |
| Call Type      | call type, incident type, nature, problem                    |
| Crew Members   | crew members, responding members, personnel, crew            |

The "Crew Members" column can be comma-separated names in one cell (e.g. `Smith, J; Jones, B`) or one name per row — both are handled.

**Clock-In expected columns:**
| Field       | Default aliases                                               |
|-------------|---------------------------------------------------------------|
| Member Name | member name, name, employee, volunteer name                   |
| Date        | date, activity date, clock date, event date                   |
| Activity    | activity, description, event, type, category                  |
| Points      | points, hours, credit, value (optional — defaults to 1)       |

### Google Sheets Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable the **Google Sheets API**
3. Create a **Service Account** → Download the JSON key → save as `credentials.json` in the project root
4. **Share** your Google Sheet with the service account's email address (read-only is fine)
5. Set `GOOGLE_SHEET_ID` in `.env` (find it in the sheet's URL)
6. Each tab should have a row of headers including at minimum: member name and shift date

### Gmail Email Setup

**Option A — App Password (recommended for internal use):**

1. Enable 2FA on your Google account
2. Go to [Google Account → Security → App Passwords](https://myaccount.google.com/apppasswords)
3. Create an app password for "Mail"
4. Set in `.env`:
   ```
   EMAIL_METHOD=password
   EMAIL_USER=your@gmail.com
   EMAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```

**Option B — OAuth2:**

1. Create OAuth2 credentials in Google Cloud Console
2. Set `EMAIL_METHOD=oauth2` and fill in the OAuth fields in `.env`

---

## Usage

### Importing Data

Go to **Import Data** in the nav:

- **ESO Riding Points** — upload your ESO CSV/Excel export. Records are de-duplicated automatically (safe to re-import).
- **Non-Riding Points** — upload your clock-in system export.
- **Shift Signups** — click "Sync from Google Sheets" to pull the latest data.

### Adding Member Emails

Members are created automatically on first import. To add an email:

1. Go to **Members** → click a member
2. Click **Add Email Address** → enter and save
3. The member will now receive email reports

### Sending Reports

Go to **Email Reports**:
- Select the month/year
- Click **Send to All** to email all members who have addresses on file
- Or go to an individual member's page and click **Email [Month] Report**

### Print View

Navigate to `/print?year=2025&month=3` (or click **Print View** in the nav) to open a printer-friendly report. The page auto-triggers the browser print dialog.

---

## Project Structure

```
asvaс-dashboard/
├── client/                     # React frontend (Vite)
│   └── src/
│       ├── api/client.js       # All API calls
│       ├── components/
│       │   ├── Charts/         # Recharts wrappers
│       │   ├── Layout/         # Navbar
│       │   ├── Members/        # Member table
│       │   └── Upload/         # File upload UI
│       ├── hooks/useApi.js     # Data-fetching hooks
│       ├── pages/              # Page components
│       └── utils/format.js     # Formatters
├── server/                     # Node.js + Express backend
│   ├── db/database.js          # SQLite schema & connection
│   ├── routes/                 # Express routes
│   │   ├── data.js             # Upload & stats endpoints
│   │   ├── email.js            # Email send endpoints
│   │   └── sheets.js           # Google Sheets sync
│   └── services/
│       ├── esoParser.js        # ESO CSV/Excel parser
│       ├── clockinParser.js    # Clock-in CSV/Excel parser
│       ├── sheetsService.js    # Google Sheets API integration
│       ├── statsService.js     # All stats computations
│       └── emailService.js     # Gmail / Nodemailer integration
├── sample-data/                # Example CSV files for testing
├── .env.example                # Environment variable template
├── .gitignore
└── package.json                # Root scripts (npm run dev, etc.)
```

---

## Sample Data

See `sample-data/` for example CSV files that match the expected column formats. Use these to test your import setup before connecting real data.

---

## Production Deployment

For internal hosting (e.g. a Mac mini or small server on your network):

```bash
# Build the React app
npm run build

# Set NODE_ENV=production in .env
# Start the server (it will serve the React build)
npm start
```

The server will serve the React app at the root and handle all API routes under `/api`.

---

## License

MIT — for internal ASVAС use.
