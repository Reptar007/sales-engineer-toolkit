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

Read-only view of every customer's open QA Wolf maintenance reports, ranked by
age and by how many tests each customer has parked. Backed by one background
scan of every workspace on QA Wolf's public API, using `QAW_BEARER_TOKEN`: one
`GET /api/v0/identity/organizations` for the workspace list, then the tRPC procedure
`public.issue.find` per workspace. The key must be a QA Wolf admin's or employee's, since
only that reach lists every customer's workspace. Cached in memory for
`MAINTENANCE_DASHBOARD_CACHE_TTL_MINUTES` (default 6 h).

- **GET** `/api/maintenance-dashboard` – `{ status: 'ready', snapshot, builtAt, stale, refreshing, refreshError, rescanAvailableAt }`
  from the cache, or `{ status: 'building', progress, refreshError }` while the first scan runs
  (poll until ready). `?refresh=1` asks for a rescan in the background (see rescan limits below). A scan that fails outright
  is not restarted by the next GET: with no snapshot the route answers
  `{ status: 'error', error, code, failedAt, rescanAvailableAt }` (500 `QAW_CONFIG` for a missing key, 401 `QAW_AUTH` for a
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
  snapshot in place.
- **GET** `/api/maintenance-dashboard/status` – what the page polls while a scan runs:
  `{ status, builtAt, stale, refreshing, progress, refreshError, rescanAvailableAt, error }`, never the snapshot.
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

- **GET** `/api/maintenance-dashboard/taskwolf` (admin only) – is Task Wolf connected, and
  which tools (with input schemas) its MCP offers. `?refresh=1` re-reads the tool list.
- **GET** `/api/maintenance-dashboard/taskwolf/customer/:workspaceId` (admin only) – live probe
  for one customer: the arguments derived from each tool's schema, the raw answer and the
  normalized reading side by side. The workspace id is sent as Task Wolf's `qawId`; `?slug=` /
  `?name=` only matter for a tool that takes a name instead.

`MAINTENANCE_DASHBOARD_EXCLUDED_SLUGS` (default `figma`, comma-separated, matched by slug only)
drops workspaces from the backlog entirely: they are not scanned. A workspace with no slug is
never dropped, whatever its name. Set it to `none` to leave nothing out. Demo/sandbox
workspaces are flagged and hidden by a toggle on the page.

A workspace's open reports are read 100 at a time, for at most 50 pages (5,000 reports). When
QA Wolf still hands back a cursor after the 50th, the scan asks for one report behind it. If
none comes back, the 5,000 are the whole list. If one does, or that question fails, the workspace
is cut short but not a failure: what was read counts, its customer row carries
`reportsTruncated: true`, and it is listed in `snapshot.truncatedWorkspaces`
(`{ workspaceId, workspaceName, reportsRead }`) and counted in
`snapshot.totals.workspacesTruncated`. The page warns that its other reports are not listed, so
its counts and its oldest age are lower bounds, and its row among the culprits marks each of
them "+" (flows, reports and oldest age). The Slack digest says the same, and marks the same,
wherever that customer has a report on screen.

**Task Wolf.** With `TASK_WOLF_MCP_TOKEN` set (a personal `twmcp_…` token from
[Task Wolf → Settings → Connect Claude](https://www.task-wolf.com/settings/connect-claude),
90-day life), the scan makes a second pass over every customer with backlog through the
[Task Wolf MCP](https://www.task-wolf.com/docs/users/automation/mcp/user-guide.html):
`get_maintenance_status` (open maintenance with real blocked status) and `find_tasks` (open
maintenance tasks and their QAE). Task Wolf answers per open maintenance report, each with its
blocked flag, its blocker, the QAEs on its tasks and the flows it parks, and each is matched to
its QA Wolf report by issue id (then by report number). Each report then reads **blocked**,
**actionable**, or unknown, with the blocker and the QAEs already on it, and the page can filter
to actionable bones only. The customer is matched by `qawId`, which is the workspace id: a tool
whose schema takes `qawId`, or whose customer argument says it accepts one (Task Wolf's does), is
sent the workspace id. Otherwise a customer-name argument (`customer` when the tool publishes no
schema) is sent the workspace slug, which Task Wolf resolves by name; an id-shaped one such as
`teamId` is used only when no name argument is offered. A customer Task Wolf has no record of
("No customer matched", a former customer most often) is counted in
`snapshot.taskWolf.customersNotInTaskWolf`, not treated as a failure, and its reports stay
unknown; when that is most of the customers asked, the page warns instead of hinting, since that
many former customers is unlikely. The MCP's input schemas are read live and the answers are
read by tolerant key lookup (`backend/src/projects/maintenance-dashboard/taskWolfShape.js`);
if the Task Wolf column looks wrong, hit the probe endpoint above and compare `raw` with
`normalized`. Without a token, or with an expired one, the platform data still stands and the
page says what is missing.

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
