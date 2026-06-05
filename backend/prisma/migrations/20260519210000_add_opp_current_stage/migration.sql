-- Snapshot the SF opportunity stage on the Opp record so the Hunt
-- Board directory can render a stage pill without per-row Salesforce
-- queries on every list load. The FE refreshes this whenever the
-- detail page successfully hydrates Salesforce data.
ALTER TABLE "opps" ADD COLUMN "currentStage" TEXT;
ALTER TABLE "opps" ADD COLUMN "stageSyncedAt" DATETIME;
