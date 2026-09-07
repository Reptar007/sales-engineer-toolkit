-- CreateTable
CREATE TABLE "opp_carr_attributions" (
    "id" TEXT NOT NULL,
    "salesforceOpportunityId" TEXT NOT NULL,
    "salesEngineerId" TEXT NOT NULL,
    "oppName" TEXT,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opp_carr_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opp_carr_attributions_salesforceOpportunityId_key" ON "opp_carr_attributions"("salesforceOpportunityId");

-- CreateIndex
CREATE INDEX "opp_carr_attributions_salesEngineerId_idx" ON "opp_carr_attributions"("salesEngineerId");

-- AddForeignKey
ALTER TABLE "opp_carr_attributions" ADD CONSTRAINT "opp_carr_attributions_salesEngineerId_fkey" FOREIGN KEY ("salesEngineerId") REFERENCES "sales_engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
