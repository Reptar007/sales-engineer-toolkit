-- SQLite stores the Role enum as TEXT, so the new csm and csm_lead values
-- need no change here; this migration keeps the folders in step with the
-- Postgres ones (prisma/migrations), which add the values to the enum type.
SELECT 1;
