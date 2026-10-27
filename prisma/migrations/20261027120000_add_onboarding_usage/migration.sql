-- AlterTable
ALTER TABLE "onboarding_workspaces" ADD COLUMN "pricing" TEXT;

-- CreateTable
CREATE TABLE "onboarding_usage_weeks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "runs" INTEGER NOT NULL,
    "flowRuns" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "runnerSeconds" DOUBLE PRECISION NOT NULL,
    "credits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_usage_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_usage_weeks_workspaceId_environmentId_weekStart_key" ON "onboarding_usage_weeks"("workspaceId", "environmentId", "weekStart");
