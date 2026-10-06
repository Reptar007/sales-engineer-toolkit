-- CreateTable
CREATE TABLE "maintenance_claims" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceName" TEXT,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_claims_userId_idx" ON "maintenance_claims"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_claims_workspaceId_userId_key" ON "maintenance_claims"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "maintenance_claims" ADD CONSTRAINT "maintenance_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
