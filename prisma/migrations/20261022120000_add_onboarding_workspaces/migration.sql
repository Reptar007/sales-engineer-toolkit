-- CreateTable
CREATE TABLE "onboarding_workspaces" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceName" TEXT,
    "segment" TEXT,
    "addedManually" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "kickoffOn" TIMESTAMP(3),
    "pilotDays" INTEGER,
    "linearIssue" TEXT,
    "ae" TEXT,
    "csm" TEXT,
    "failureOwner" TEXT,
    "clientBuildingTests" BOOLEAN,
    "nextStep" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_workspaces_workspaceId_key" ON "onboarding_workspaces"("workspaceId");
