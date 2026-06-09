-- CreateTable
CREATE TABLE "opps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "salesEngineerId" TEXT NOT NULL,
    "oppName" TEXT NOT NULL,
    "salesforceOpportunityId" TEXT,
    "aeNameOverride" TEXT,
    "csmName" TEXT,
    "qaLeadName" TEXT,
    "qaManagerName" TEXT,
    "technicalSpecsJson" TEXT,
    "productTourUrl" TEXT,
    "notesMarkdown" TEXT,
    "customSectionsJson" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "opps_salesEngineerId_fkey" FOREIGN KEY ("salesEngineerId") REFERENCES "sales_engineers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "opps_salesEngineerId_idx" ON "opps"("salesEngineerId");

-- CreateIndex
CREATE UNIQUE INDEX "opps_salesEngineerId_oppName_key" ON "opps"("salesEngineerId", "oppName");
