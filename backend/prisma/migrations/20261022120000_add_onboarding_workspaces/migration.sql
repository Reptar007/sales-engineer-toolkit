-- CreateTable
CREATE TABLE "onboarding_workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "workspaceName" TEXT,
    "segment" TEXT,
    "addedManually" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "kickoffOn" DATETIME,
    "pilotDays" INTEGER,
    "linearIssue" TEXT,
    "ae" TEXT,
    "csm" TEXT,
    "failureOwner" TEXT,
    "clientBuildingTests" BOOLEAN,
    "nextStep" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_workspaces_workspaceId_key" ON "onboarding_workspaces"("workspaceId");
