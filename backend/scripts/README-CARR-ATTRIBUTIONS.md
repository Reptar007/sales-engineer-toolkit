# Seed CARR-by-SE attributions

Populates `opp_carr_attributions` — the SE credit shown on the **Spoils**
page (`/projects/carr-by-se`) — from the SE handoff log.

## Why a seed and not a data dump

Attributions store a `salesEngineerId`, and those cuids are generated per
database. A dump from local SQLite would point at SE records that do not exist
in production, so the rows would import and then resolve to nobody.

The stored rows are derived data. Both inputs are reproducible:

1. `backend/data/attributions/se-handoffs.csv` — who handed off which client
2. the live **All Closed Won** Salesforce report — which opportunity that is

So the portable form is the derivation, not the result. Re-running the seed in
any environment reproduces identical credit.

## Running it

Dry run first — it prints every add, reassignment and revocation, plus
everything it could not resolve, and writes nothing:

```bash
cd backend
node scripts/seed-carr-attributions.js
```

Then apply:

```bash
node scripts/seed-carr-attributions.js --apply
```

Against production, `DATABASE_URL` selects the database exactly as
`seed-all-teams.js` does:

```bash
heroku run "cd backend && node scripts/seed-carr-attributions.js" --app qa-sales-engineering
heroku run "cd backend && node scripts/seed-carr-attributions.js --apply" --app qa-sales-engineering
```

The migration must be applied first (`opp_carr_attributions` has to exist).

It is idempotent: re-running with an unchanged CSV plans zero writes. It is
also authoritative — if someone changes a picker in the UI and the CSV still
says otherwise, the next run puts it back. Edit the CSV, not the database.

## The credit rule

`se_reply` **and** `has_se_handoff=yes` must both be present. A name attached
to `has_se_handoff=no` is deliberately not a credit — ServiceTitan is the
worked example, where an SE posted congratulations rather than a handoff.
Crediting it would move $421k to the wrong person.

## What it deliberately refuses to do

The seed reports these rather than guessing, because each one would otherwise
attribute real revenue to the wrong person or deal:

- **Ambiguous client names.** `Archer` matches both `Archer` and
  `Revival - Archera`; the row is skipped and named in the output.
- **Repliers who are not active SEs.** Lauren Wurscher and Amanda Morrow run
  through the 2024 log and have no `SalesEngineer` record, so those clients
  stay unattributed. To credit them they need SE records, or the picker needs
  to accept free-text names.
- **Clients with no closed-won opportunity** (`SignaPay`, `Strata Company`,
  `PropertyReach`, `Luma AI`).
- **A truncated report.** The Analytics API caps a synchronous run at 2000
  detail rows; past that the seed aborts rather than silently dropping credits.

## Adding to the log

Append a row to the CSV and re-run. Match `client` to the Salesforce
opportunity name closely enough to be unambiguous — the matcher folds case and
punctuation and matches in either direction (`Bilt` finds `Bilt - Revival`;
`Gravitate Energy` finds `Gravitate`), but two candidates means the row is
skipped, so prefer the fuller name when a short one might collide.
