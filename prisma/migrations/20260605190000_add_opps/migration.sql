-- CreateTable
CREATE TABLE "opps" (
    "id" TEXT NOT NULL,
    "salesEngineerId" TEXT NOT NULL,
    "oppName" TEXT NOT NULL,
    "salesforceOpportunityId" TEXT,
    "aeNameOverride" TEXT,
    "csmName" TEXT,
    "qaLeadName" TEXT,
    "qaManagerName" TEXT,
    "technicalSpecsJson" TEXT,
    "qawTeam" TEXT,
    "currentStage" TEXT,
    "stageSyncedAt" TIMESTAMP(3),
    "notesMarkdown" TEXT,
    "customSectionsJson" TEXT,
    "manualLinearLinksJson" TEXT,
    "creationJson" TEXT,
    "estimationJson" TEXT,
    "notionPageId" TEXT,
    "notionPageUrl" TEXT,
    "notionSyncedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opps_salesEngineerId_idx" ON "opps"("salesEngineerId");

-- CreateIndex
CREATE UNIQUE INDEX "opps_salesEngineerId_oppName_key" ON "opps"("salesEngineerId", "oppName");

-- AddForeignKey
ALTER TABLE "opps" ADD CONSTRAINT "opps_salesEngineerId_fkey" FOREIGN KEY ("salesEngineerId") REFERENCES "sales_engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
