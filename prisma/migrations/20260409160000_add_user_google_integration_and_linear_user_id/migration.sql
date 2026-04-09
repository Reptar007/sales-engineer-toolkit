-- AlterTable
ALTER TABLE "sales_engineers" ADD COLUMN "linearUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_engineers_linearUserId_key" ON "sales_engineers"("linearUserId");

-- CreateTable
CREATE TABLE "user_google_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleSub" TEXT,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_google_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_google_integrations_userId_key" ON "user_google_integrations"("userId");

-- CreateIndex
CREATE INDEX "user_google_integrations_userId_idx" ON "user_google_integrations"("userId");

-- AddForeignKey
ALTER TABLE "user_google_integrations" ADD CONSTRAINT "user_google_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
