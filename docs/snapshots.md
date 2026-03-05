# Data snapshots

Snapshots store a year’s Salesforce metrics and calculator data as JSON so the app can serve that year without calling the Salesforce API.

## When to create a snapshot

Create a snapshot when a year is **finalized** (e.g. 2025 is closed and you no longer need live SF data for it). After that, the app will read that year from `backend/data/snapshots/` instead of Salesforce.

## How to create a snapshot

### Option 1: Admin UI (recommended)

1. Log in as an admin.
2. Open **Admin** → **Snapshot Years**.
3. Choose the year (e.g. 2025) and click **Create snapshot**.
4. Ensure that year is in `SNAPSHOT_YEARS` in `.env` (e.g. `SNAPSHOT_YEARS=2025` or `2025,2026`). The registry is updated automatically when you create from the UI.

### Option 2: Export script

From the repo root:

```bash
node backend/scripts/export-year-snapshot.js 2025
```

From the `backend` directory:

```bash
node scripts/export-year-snapshot.js 2025
```

This writes `backend/data/snapshots/2025-metrics.json` and `2025-calculator.json` and adds 2025 to the snapshot registry. Then set `SNAPSHOT_YEARS=2025` (or include 2025) in `.env` so the app knows to serve that year from snapshots.

## Adding a new year later (e.g. 2027)

1. Add report IDs for that year in config (and env if needed); add goals in `backend/src/config/salesforce.js` if you use them.
2. When the year is finalized, create the snapshot via **Admin → Snapshot Years** or the export script.
3. Add the year to `SNAPSHOT_YEARS` in `.env` if it isn’t there.

No code change is required for the snapshot mechanism—only new snapshot files and config/env for the new year.
