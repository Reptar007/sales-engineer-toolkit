-- CreateTable
CREATE TABLE "maintenance_claims" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "workspaceName" TEXT,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "maintenance_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "maintenance_claims_userId_idx" ON "maintenance_claims"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_claims_workspaceId_userId_key" ON "maintenance_claims"("workspaceId", "userId");
