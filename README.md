# SalesWolf

A comprehensive toolkit for sales engineers with ratio estimation capabilities, featuring a React frontend and Express.js backend.

## 🏗️ Project Structure

```
sales-engineer-toolkit/
├── backend/                    # Express.js API server
│   ├── src/
│   │   ├── index.js           # Main server file
│   │   ├── routes/            # API routes
│   │   │   ├── api.js         # Main API router
│   │   │   └── health.js      # Health check routes
│   │   ├── services/          # Shared services
│   │   │   └── openaiService.js
│   │   ├── middleware/        # Custom middleware
│   │   ├── projects/          # Project-specific modules
│   │   │   └── ratio-estimator/
│   │   │       └── routes/    # Project routes with business logic
│   │   ├── helpers.js         # Utility functions
│   │   └── prompts.js         # AI prompts
│   └── package.json
├── frontend/                   # React application
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── styles/
│   │   └── utils/
│   └── package.json
├── scripts/                    # Helper scripts
│   └── setup-env.sh           # Environment setup
├── package.json               # Root dependencies and scripts
└── .env.example               # Environment template
```

## 🚀 Quick Start

### Prerequisites

Ensure you are using Node version 24.16.0 or the npm packages will not install.
If you need to update or install Node v24.16.0 you may follow the instructions below or get them from this doc: https://nodejs.org/en/download

#### Option 1: Instructions for Mac

1. **Download and install nvm:**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
```

2. **In lieu of restarting the shell:**

```bash
\. "$HOME/.nvm/nvm.sh"
```

3. **Download and install Node.js:**

```bash
nvm install 24
```

4. **Verify the Node.js version:**

```bash
node -v # Should print "v24.16.0".
```

5. **Verify npm version:**

```bash
npm -v # Should print "11.13.0".
```

#### Option 2: Instructions for Windows

1. **Download and install Chocolatey:**

```bash
powershell -c "irm https://community.chocolatey.org/install.ps1|iex"
```

2. **Download and install Node.js:**

```bash
choco install nodejs --version="24.16.0"
```

3. **Verify the Node.js version:**

```bash
node -v # Should print "v24.16.0".
```

4. **Verify npm version:**

```bash
npm -v # Should print "11.13.0".
```

### Installation

Once opperating on Node v24.16.0 run the following from the root directory:

```bash
# Install all dependencies (root, backend, and frontend)
npm run install:all
```

### Environment Setup

#### Option 1: Using 1Password CLI (Recommended)

This project is configured to use 1Password CLI for secure environment variable management.

1. **Install 1Password CLI** (if not already installed):

   ```bash
   brew install --cask 1password-cli
   ```

2. **Sign in to 1Password**:

   ```bash
   eval $(op signin)
   ```

3. **Set up environment variables** (one-time setup):

   ```bash
   npm run env:setup
   ```

   Or to refresh existing environment variables:

   ```bash
   npm run env:refresh
   ```

This will automatically inject the API keys from your 1Password vault into a `.env` file.

#### Option 2: Manual Setup

Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PORT=7071
```

**Note**: The app will work without an OpenAI API key, but ratio estimation features will be disabled.

### Development

```bash
# Run both backend and frontend in development mode
npm run dev

# Or run them separately:
npm run dev:backend  # Backend API on port 7071
npm run dev:frontend # Frontend on port 5173
```

### Production

```bash
# Build the frontend
npm run build

# Start the backend server
npm start
```

## 📜 Available Scripts

### Development

- **`dev`** – Runs both backend and frontend concurrently
- **`dev:backend`** – Runs only the backend API server
- **`dev:frontend`** – Runs only the frontend development server

### Production

- **`start`** – Starts the backend server in production mode
- **`build`** – Builds the frontend for production
- **`preview`** – Previews the built frontend

### Testing

- **`test`** – Runs frontend unit tests
- **`test:ui`** – Opens Vitest UI for interactive testing
- **`test:coverage`** – Runs tests with coverage report
- **`test:a11y`** – Runs accessibility tests
- **`test:visual`** – Runs visual regression tests
- **`test:e2e`** – Runs end-to-end tests with Playwright
- **`test:ci`** – Runs tests suitable for CI environments
- **`test:all`** – Runs all test suites

### Code Quality

- **`format`** – Formats all files with Prettier
- **`format:check`** – Checks file formatting without modifying files
- **`lint`** – Runs ESLint across the entire project
- **`lint:fix`** – Runs ESLint and automatically fixes issues

## 🛠️ Backend API

The backend provides a REST API for ratio estimation:

### Health Check

- **GET** `/api/health` – Basic health check
- **GET** `/api/health/detailed` – Detailed health information

### Ratio Estimator

- **GET** `/api/ratio-estimator` – Project information
- **POST** `/api/ratio-estimator/estimate/initial` – Initial AI estimation
- **POST** `/api/ratio-estimator/estimate/postprocess` – Post-processing
- **POST** `/api/ratio-estimator/estimate/fix-rejections` – Fix rejections (planned)

### Maintenance Dashboard (Bone Pile)

A view of every customer's open QA Wolf maintenance reports, ranked by age and by how many tests
each customer has parked. The page changes nothing in QA Wolf or Task Wolf; claims (see below) are
the one thing it writes, to this app's own database. Backed by one background scan of every
workspace on QA Wolf's public API, using `QAW_BEARER_TOKEN`: one
`GET /api/v0/identity/organizations` for the workspace list, then the tRPC procedure
`public.issue.find` per workspace. The key must be a QA Wolf admin's or employee's, since
only that reach lists every customer's workspace. Cached in memory for
`MAINTENANCE_DASHBOARD_CACHE_TTL_MINUTES` (default 6 h).

- **GET** `/api/maintenance-dashboard` – `{ status: 'ready', snapshot, builtAt, stale, refreshing, refreshError, rescanAvailableAt }`
  from the cache, or `{ status: 'building', progress, refreshError }` while the first scan runs
  (poll until ready). `?refresh=1` asks for a rescan in the background (see rescan limits below). A scan that fails outright
  is not restarted by the next GET: with no snapshot the route answers
  `{ status: 'error', error, code, failedAt, rescanAvailableAt, taskWolfToken }` (500 `QAW_CONFIG` for a missing key, 401 `QAW_AUTH` for a
  rejected one, 502 when QA Wolf is unreachable or answers 403, `QAW_FORBIDDEN`); with one,
  the stale snapshot keeps answering and `refreshError` (`{ code, message, failedAt }`) says
  why the rebuild failed. A plain GET retries after
  `MAINTENANCE_DASHBOARD_RETRY_COOLDOWN_SECONDS` (default 60), and so does `?refresh=1`; a
  rescan asked for before then is refused, and `rescanAvailableAt` says when one may start, with
  or without a snapshot.
  While the retry runs, the failure stays in `refreshError` (beside `building` when there is no
  snapshot yet) and the page says a retry is running; a retry that fails replaces it, and it
  clears once a scan publishes a snapshot.
  One workspace failing, a 403 included, is tallied in `snapshot.errors` and the scan goes on.
  A scan in which every workspace failed, or the first 20 to answer all did, or whose workspace
  list has no workspace carrying an id, fails outright (502) and leaves the last
  snapshot in place. Every answer, ready, building or error, carries `taskWolfToken` (see the
  Task Wolf token below).
- **GET** `/api/maintenance-dashboard/status` – what the page polls while a scan runs:
  `{ status, builtAt, stale, refreshing, progress, refreshError, rescanAvailableAt, taskWolfToken, error }`, never the snapshot.
  Always 200, a failed scan included (`error` is `{ code, message, failedAt }`), and it never
  starts a scan. Fetch the full payload when `builtAt` moves or `refreshing` turns false.
- **POST** `/api/maintenance-dashboard/refresh` – start a rescan, or join the one running (202).
  Asked for too soon after the last scan it answers 429 `RESCAN_TOO_SOON` with `Retry-After`.

Rescan limits: each full scan is about 2,000 QA Wolf calls, so a forced rescan (the Rescan
button, `?refresh=1`, `POST /refresh`) starts only once
`MAINTENANCE_DASHBOARD_MIN_RESCAN_MINUTES` (default 15) have passed since the last snapshot and,
while a failure stands, the retry cool-down since it. Only one scan runs per process at a time; a
request made during one joins it. `rescanAvailableAt` in `GET /` and `/status` says when the
next forced rescan may start (null when it may start now), a failed scan's answer included, and
the page disables Rescan until then, beside a snapshot or on the page that says the scan failed.
A `?refresh=1` that is refused is still a GET: a snapshot past the cache window is rebuilt as a
plain GET would rebuild it, which happens when `MAINTENANCE_DASHBOARD_CACHE_TTL_MINUTES` is
shorter than the minimum gap.

- **GET** `/api/maintenance-dashboard/taskwolf` (admin only) – is Task Wolf connected, and
  which tools (with input schemas) its MCP offers. `?refresh=1` re-reads the tool list.
  `tokenExpiry` (`{ expiresOn, daysLeft, state, message }`, beside a failure too) says where the
  token stands against `TASK_WOLF_MCP_TOKEN_EXPIRES_ON`, and `message` says when that setting is
  missing or not a date.
- **GET** `/api/maintenance-dashboard/taskwolf/customer/:workspaceId` (admin only) – live probe
  for one customer: each tool's input schema, the arguments it is sent, the raw answer and the
  normalized reading side by side.

`MAINTENANCE_DASHBOARD_EXCLUDED_SLUGS` (default `figma`, comma-separated, matched by slug only)
drops workspaces from the backlog entirely: they are not scanned. A workspace with no slug is
never dropped, whatever its name. Set it to `none` to leave nothing out. Demo/sandbox
workspaces are flagged and hidden by a toggle on the page.

A workspace's open reports are read 100 at a time, for at most 50 pages (5,000 reports). When
QA Wolf still hands back a cursor after the 50th, the scan asks for one report behind it. If
none comes back, the 5,000 are the whole list. If one does, the workspace is cut short. If that
question fails (other than on a rejected key, which fails the scan), the scan cannot tell, and
treats the workspace as cut short too: QA Wolf may have no more reports for it, but what was read
is a lower bound either way, and the page and the Slack digest below still say it has more. A
workspace cut short is not a failure: what was read counts, its customer row carries
`reportsTruncated: true`, and it is listed in `snapshot.truncatedWorkspaces`
(`{ workspaceId, workspaceName, reportsRead }`) and counted in
`snapshot.totals.workspacesTruncated`. The page warns that its other reports are not listed, so
its counts and its oldest age are lower bounds, and its row among the culprits marks each of
them "+" (flows, reports and oldest age). The Slack digest says the same, and marks the same,
wherever that customer has a report on screen.

**Task Wolf.** With `TASK_WOLF_MCP_TOKEN` set (a `twmcp_…` token from
[Task Wolf → Settings → Connect Claude](https://www.task-wolf.com/settings/connect-claude),
90-day life; see the Task Wolf token below for whose it should be), the scan makes a second
pass over every customer with backlog through the
[Task Wolf MCP](https://www.task-wolf.com/docs/users/automation/mcp/user-guide.html):
`get_maintenance_status` (open maintenance with real blocked status) and `find_tasks` (open
maintenance tasks and their QAE). Task Wolf answers per open maintenance report, each with its
blocked flag, its blocker, the QAEs on its tasks and the flows it parks, and each is matched to
its QA Wolf report by issue id (then by report number). Each report then reads **blocked**,
**actionable**, or unknown, with the blocker and the QAEs already on it, and the page can filter
to actionable bones only. The arguments are fixed: `get_maintenance_status` is sent
`{ customer: <workspace id> }` and `find_tasks` is sent
`{ customer: <workspace id>, types: ["testMaintenance"] }`. The workspace id is Task Wolf's
`qawId`, which its `customer` argument takes. Each tool's published schema is checked once per
pass. A tool whose schema no longer declares `customer` (or, for `find_tasks`, `types`) is
treated as one the server does not offer: it is asked about no customer,
`snapshot.taskWolf.tools` marks it `false`, and `snapshot.taskWolf.schemaDrift`
(`[{ tool, message }]`) names it once, with the properties its schema does declare; the page
says what that leaves unknown. With neither tool left to ask, the pass fails under `TW_TOOLS`.
The probe endpoint checks each schema the same way for the one customer it asks. A
customer Task Wolf has no record of ("No customer matched", a former customer most often) is
counted in `snapshot.taskWolf.customersNotInTaskWolf`, not treated as a failure, and its reports
stay unknown; when that is most of the customers asked, the page warns instead of hinting, since
that many former customers is unlikely. The answers are read by tolerant key lookup
(`backend/src/projects/maintenance-dashboard/taskWolfShape.js`); if the Task Wolf column looks
wrong, hit the probe endpoint above and compare `raw` with `normalized`. Without a token, or
with an expired one, the platform data still stands and the page says what is missing.

What Task Wolf did not say stays unknown: a `null` in the snapshot is never a zero, and a report
Task Wolf does not list reads `taskWolf.blocked: null`, whatever the customer's counts say. (An
answer that lists flows rather than reports is read flow by flow: there a report whose flows it
did not list is settled only by the customer's own counts, when they are exact rather than floors,
about more than zero flows, and say none of the customer's flows are blocked, or none are free,
and a report that parks no flows reads `null` too.) An answer with no count and no items in it puts the
customer in `snapshot.taskWolf.errors` instead of giving a verdict.
When a list came back cut short (flagged `truncated` / `hasMore`, or shorter than the total
stated beside it) and Task Wolf stated no blocked or actionable count, the customer's
`taskWolf.partial` is `true` and its `blockedFlows` / `actionableFlows` are floors ("at least",
a floor of zero being `null`); `snapshot.taskWolf.customersPartial` counts those customers.
The customer's `taskWolf.truncated` is `true` when those counts are floors or Task Wolf flagged a
list as cut short (a task list shorter than its stated total counts as flagged), so it can be
`true` beside exact counts. A report's `taskWolf.blockedFlowIds` / `freeFlowIds` name which of
its own flows Task Wolf listed as blocked / free (`null`, like its counts, when only `find_tasks`
answered). A report's `taskWolf.assignees`
are the QAEs on that report only (on its own tasks, or its own flows in an answer by flow); the
QAEs with an open maintenance task for the customer,
which may be about another report, are in `taskWolf.customerAssignees`.

The pass never holds the backlog back. On the first scan the platform snapshot is published
before the pass starts, with `snapshot.taskWolf.pending: true`, and replaced when the pass
ends; a rescan keeps the snapshot already there until the new one is complete. One customer
failing, a 403 included, is listed in `snapshot.taskWolf.errors` and the pass goes on (only a
401 stops it on sight, under `TW_AUTH`, keeping every answer already given). When Task Wolf
stops answering, the pass stops too, keeps what it
gathered and says so in `snapshot.taskWolf.error` (`TW_ABORTED`): after
`TASK_WOLF_MAX_CONSECUTIVE_FAILURES` customers in a row (default 8) got nothing but network errors,
timeouts, unreadable answers or error statuses other than 401 (5xx, 429 and 403 included), or
once it has run for `TASK_WOLF_PASS_BUDGET_MINUTES` (default 15). A pass that
ran to its end without an answer for a single customer, those Task Wolf has no record of aside,
is reported under the same code, and so is one in which Task Wolf had no record of any of the
customers asked (more than one): that is a customer argument it no longer takes, and the error
names the first customer and the argument it was sent.

**The Task Wolf token.** Task Wolf answers the server as whoever owns `TASK_WOLF_MCP_TOKEN`, so
the token's owner decides what the Task Wolf column can see. Production should run on a team or
service token, not one person's; until one exists it runs on a personal token. Tokens last 90
days from minting. Set `TASK_WOLF_MCP_TOKEN_EXPIRES_ON` to the day the token expires, as
`YYYY-MM-DD`: 90 days after it was minted (a token minted on 2026-01-01 expires on 2026-04-01).
From 14 days before that date the page warns when the token expires and in how many days, and
tells whoever runs the server to mint a new one and update both settings; from the day after,
it says the token has expired. The date is a calendar day counted in UTC, and the token counts
as working through it. `GET /` (ready, building or error) and `/status` carry `taskWolfToken`:
`{ expiresOn, daysLeft, state }`, with `state` one of `ok`, `expiring`, `expired` or `invalid`,
or null when no date or no token is set. A value that is not a real `YYYY-MM-DD` date is
`invalid`: the page ignores it and `GET /taskwolf` reports it. The page warns beside a snapshot,
while the first scan runs, and on the page that says a scan failed. Once Task Wolf has rejected
the token (`TW_AUTH`), the page gives that notice alone, telling whoever runs the server the
same and naming both settings, `TASK_WOLF_MCP_TOKEN_EXPIRES_ON` whether or not it is set, with
no expiry warning beside it.

**Claims.** An SE claims a customer so the team can see it is taken. Several SEs may claim the same
customer, each with their own claim and an optional one-line note of up to 140 characters
("Rebuilding checkout flows"). A claim lapses `MAINTENANCE_DASHBOARD_CLAIM_DAYS` (default 14, at
most 90) days after it was made or last renewed; renewing restarts the count. Changing the setting
affects only new claims and renewals, since each claim stores when it lapses. Claims are stored in
the `maintenance_claims` table, not in the snapshot, so they survive restarts and deploys; lapsed
ones stop counting on every read and are deleted on the next write, so nothing runs on a schedule.
Only a customer in the current snapshot can be claimed. A workspace whose reports the scan could not
read is missing from the snapshot too, though its backlog may not have cleared, so a claim already
on it can still be renewed, and a new one waits for a scan that reads it. Releasing always works,
after a restart and for a customer that has since left the backlog. The server starts no scan when
it restarts, so until someone asks for the backlog nothing can be claimed; a page left open that is
refused for this asks for the backlog itself, which starts the scan, and you claim once it has
finished. Any signed-in user can claim. A user releases only their own claim, and an admin anyone's.
Names show as first name plus last initial ("Robin V."), never an email. A deactivated user's claims
are hidden, and a deleted user's are removed with them. The page asks for claims every minute while
the tab is visible and at once when you come back to it, and never rescans for them. It shows them
on the culprits, in the report table and in the focused customer's card, where they are claimed,
renewed and released, and it reminds you of your own claims that are about to lapse, whose workspace
this scan could not read, or whose customer has left the snapshot. The Claims filter (all /
unclaimed only / mine only) narrows the culprits and the table alike, and never hides the customer
in focus, so claiming it under "unclaimed only" or releasing it under "mine only" leaves it on
screen. Claims are not in the CSV export or the Slack digest.

- **GET** `/api/maintenance-dashboard/claims` – every live claim, on every customer, as the caller
  sees it: `{ claims, claimDays, noteMaxLength }`, each claim
  `{ workspaceId, workspaceName, userId, claimer, note, claimedAt, expiresAt, mine, canRelease }`,
  oldest first; `mine` and `canRelease` are worked out for the caller. Claims on customers no
  longer in the snapshot are listed too. It reads the database and never starts a scan.
- **PUT** `/api/maintenance-dashboard/claims/:workspaceId` – claim the customer, or renew the
  caller's own claim on it, for `claimDays` from now. Body `{ note? }`: left out, the note stays as
  it is (none on a new claim); `null` or blank clears it; text replaces it, put on one line. Answers
  the list with the caller's `claim` and `renewed`. 400 `CLAIM_NOTE_INVALID` for a note over 140
  characters or not text; 409 `CLAIM_NO_SNAPSHOT` while the server has no snapshot (after a
  restart, until a GET of `/api/maintenance-dashboard` has started a scan and it has published
  one; this route starts none); 404 `CLAIM_UNKNOWN_CUSTOMER` for a workspace not in the snapshot;
  409 `CLAIM_CUSTOMER_UNREAD` for a new claim on a workspace whose reports the scan could not read
  (a claim already on it is renewed).
- **DELETE** `/api/maintenance-dashboard/claims/:workspaceId/:userId` – release a claim: the
  caller's own, or anyone's for an admin (403 `CLAIM_NOT_YOURS` otherwise). Releasing a claim that
  is not there (released or lapsed) answers 200 with `released: false`.

A database failure on any of the three answers 500 `CLAIMS_UNAVAILABLE` with a fixed message; the
details are logged, not sent. Deploying: the release phase (`prisma migrate deploy`) creates the
table. Locally, run `npx prisma generate` and `npx prisma migrate deploy` in `backend/`, which adds
the table to `backend/prisma/dev.db` (the SQLite schema's one database). That file is tracked, so
leave the change out of your commits; `git checkout -- backend/prisma/dev.db`, with the backend
stopped, puts it back as committed, without the table.

### Environment Variables

The backend looks for environment variables in this order:

1. `backend/.env`
2. Root `.env`
3. System environment variables

Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PORT=7071
```

**Note**: If no OpenAI API key is provided, the app will still start but ratio estimation endpoints will return a 503 error.

## 🎨 Frontend

The frontend is a React application built with Vite, featuring:

- Modern UI with theme support (light/dark)
- CSV file upload and processing
- Real-time data visualization
- Responsive design
- Comprehensive testing suite

## 🚀 Deployment

### Heroku Deployment

This project is configured for Heroku deployment:

1. **Build Process**: The `build` script installs all dependencies and builds the frontend
2. **Start Command**: Uses `npm start` to run the backend server
3. **Static Files**: The backend serves the built frontend files from `frontend/dist`
4. **Environment**: Set `OPENAI_API_KEY` in Heroku config vars

**Deploy to Heroku:**

```bash
# Login to Heroku
heroku login

# Create a new app (if needed)
heroku create your-app-name

# Set environment variables
heroku config:set OPENAI_API_KEY=your_key_here

# Deploy
git push heroku main
```

### Production Notes

- The app uses Node.js 18+ and npm 8+
- Frontend is built with Vite and served as static files
- Backend uses Express.js with CORS enabled
- All API routes are prefixed (e.g., `/estimate/initial`)
- Non-API routes serve the React app
- The Bone Pile's Task Wolf column sees what the owner of `TASK_WOLF_MCP_TOKEN` can see, so set a
  team or service token there, not one person's, and set `TASK_WOLF_MCP_TOKEN_EXPIRES_ON` each
  time the token is replaced (tokens last 90 days; see the Task Wolf token above)

## 🧹 Pre-Commit Automation

This project uses **Husky** + **lint-staged** to maintain code quality:

- **Prettier** formats staged files automatically
- **ESLint** lints and fixes JavaScript files
- Commits are blocked if code doesn't meet quality standards

## 🔧 Troubleshooting

### Common Issues

**"Application Error" on Heroku:**

- Check Heroku logs: `heroku logs --app your-app-name`
- Ensure all dependencies are installed: `npm run install:all`
- Verify the build process: `npm run build`

**Frontend not loading:**

- The backend serves static files from `frontend/dist`
- Ensure the frontend is built: `npm run build`
- Check that the `frontend/dist` directory exists

**OpenAI API errors:**

- Verify your API key is set correctly
- Check that the model name is valid (e.g., `gpt-4o-mini`)
- The app will work without an API key but estimation features will be disabled

**Build failures:**

- Clear node_modules and reinstall: `rm -rf node_modules package-lock.json && npm run install:all`
- Check Node.js version: `node --version` (should be 18+)

## 📦 Dependencies

- **Backend**: Express.js, OpenAI API, CORS, Socket.io, serve-static
- **Frontend**: React, Vite, Less, Testing Library, Playwright
- **Development**: ESLint, Prettier, Husky, Concurrently

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:all`
5. Commit your changes (pre-commit hooks will run automatically)
6. Push to your branch and create a Pull Request

## 📄 License

ISC
