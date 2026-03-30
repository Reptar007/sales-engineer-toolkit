# Seed All Teams, SEs, and AEs

This script populates the database with all teams, Sales Engineers, and Account Executives based on the provided mappings.

## What it does:

1. **Creates all teams** from the SE mapping (Team Bowser, Team Yoshi, Team Kirby, Team Sonic, Team Zelda, Team Mario)
2. **Creates all Sales Engineer users** with their teams
3. **Creates all Account Executives** and assigns them to teams
4. **Creates Team Assignments** (SE ↔ AE mappings)
5. **Sets Dion Pham (dinhan@qawolf.com) as admin and sales_engineer_2**

## Default Password

All users are created with the default password: `password`

## Running the Script

### For Local Development (SQLite)

```bash
cd backend
node scripts/seed-all-teams.js
```

### For Staging/Production (PostgreSQL)

The script will automatically use the `DATABASE_URL` environment variable. Make sure it's set before running:

```bash
# For staging (set DATABASE_URL first)
export DATABASE_URL="postgresql://user:password@staging-host:5432/dbname"
cd backend
node scripts/seed-all-teams.js

# For production (via Heroku - DATABASE_URL is automatically set)
heroku run "cd backend && node scripts/seed-all-teams.js" --app qa-sales-engineering
```

**Note:** For Heroku, the `DATABASE_URL` is automatically available in the environment, so you don't need to set it manually.

## Notes

- The script is idempotent - it will skip existing records and only create new ones
- If a team or user already exists, it will update relationships as needed
- All AEs are automatically assigned to their SE via Team Assignments

## Teams and SEs Created

- **Team Bowser**: Dion Pham (dinhan@qawolf.com) - **admin + sales_engineer_2**
- **Team Yoshi**: Ricky Moore (ricky@qawolf.com) - sales_engineer_2
- **Team Kirby**: Becca Stone (becca@qawolf.com) - sales_engineer_2
- **Team Sonic**: Ian (ian@qawolf.com) - sales_engineer_2
- **Team Zelda**: Jun (jun@qawolf.com) - sales_engineer_2
- **Team Mario**: Sebastian Antonucci (sebastian@qawolf.com) - admin, sales_engineer_lead
