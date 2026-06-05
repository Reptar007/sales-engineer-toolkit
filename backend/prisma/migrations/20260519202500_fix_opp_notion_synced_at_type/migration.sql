-- The previous migration declared notionSyncedAt as TIMESTAMP(3) (Postgres
-- native), but the rest of the opps table uses DATETIME (the SQLite-style
-- alias this codebase has always used). Prisma Postgres can read DATETIME
-- columns fine but reports
--   P2023 "Conversion failed: Value TIMESTAMP(3) not supported"
-- on every row read once a TIMESTAMP(3) column is present. Re-add with the
-- matching type so all DateTime columns on opps are uniform.
--
-- Safe to DROP + ADD because no Send-to-Notion attempt ever managed to
-- write a value to this column (the update would 500 before reaching it).
ALTER TABLE "opps" DROP COLUMN "notionSyncedAt";
ALTER TABLE "opps" ADD COLUMN "notionSyncedAt" DATETIME;
