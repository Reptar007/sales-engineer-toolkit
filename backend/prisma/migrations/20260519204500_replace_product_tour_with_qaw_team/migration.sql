-- Replace the free-text productTourUrl field with a structured qawTeam
-- assignment (Alpacas / Badgers / etc.). The Notion handoff DB has a
-- corresponding "QAE Team" Select column we populate from this value.
ALTER TABLE "opps" DROP COLUMN "productTourUrl";
ALTER TABLE "opps" ADD COLUMN "qawTeam" TEXT;
