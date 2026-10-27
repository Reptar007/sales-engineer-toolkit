-- AlterTable
ALTER TABLE "onboarding_workspaces" ADD COLUMN "pricing" TEXT;

-- CreateTable
CREATE TABLE "onboarding_usage_weeks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "runs" INTEGER NOT NULL,
    "flowRuns" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "runnerSeconds" REAL NOT NULL,
    "credits" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_usage_weeks_workspaceId_environmentId_weekStart_key" ON "onboarding_usage_weeks"("workspaceId", "environmentId", "weekStart");
