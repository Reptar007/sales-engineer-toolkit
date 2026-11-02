-- AlterTable
ALTER TABLE "onboarding_workspaces" ADD COLUMN "metronomeAliases" TEXT;

-- CreateTable
CREATE TABLE "onboarding_metered_weeks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "aiCredits" REAL NOT NULL,
    "interactiveMinutes" REAL NOT NULL,
    "suiteMinutes" REAL NOT NULL,
    "importedBy" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_metered_weeks_workspaceId_environmentId_weekStart_key" ON "onboarding_metered_weeks"("workspaceId", "environmentId", "weekStart");
