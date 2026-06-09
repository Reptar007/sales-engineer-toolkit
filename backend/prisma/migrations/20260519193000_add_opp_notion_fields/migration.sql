-- AlterTable: persist the Notion handoff page reference per Opp so we can
-- render "Open in Notion" instead of duplicating page creation on every
-- click. Filled by the POST /opps/:id/notion endpoint.
ALTER TABLE "opps" ADD COLUMN "notionPageId" TEXT;
ALTER TABLE "opps" ADD COLUMN "notionPageUrl" TEXT;
ALTER TABLE "opps" ADD COLUMN "notionSyncedAt" TIMESTAMP(3);
