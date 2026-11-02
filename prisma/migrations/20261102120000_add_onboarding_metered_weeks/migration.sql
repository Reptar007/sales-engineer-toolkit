-- AlterTable
ALTER TABLE "onboarding_workspaces" ADD COLUMN "metronomeAliases" TEXT;

-- CreateTable
CREATE TABLE "onboarding_metered_weeks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "aiCredits" DOUBLE PRECISION NOT NULL,
    "interactiveMinutes" DOUBLE PRECISION NOT NULL,
    "suiteMinutes" DOUBLE PRECISION NOT NULL,
    "importedBy" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_metered_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_metered_weeks_workspaceId_environmentId_weekStart_key" ON "onboarding_metered_weeks"("workspaceId", "environmentId", "weekStart");
