-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'readonly',
    "firstName" TEXT,
    "lastName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sales_engineers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "salesforceEmail" TEXT,
    "salesforceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sales_engineers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sales_engineers_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "account_executives" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "salesforceId" TEXT NOT NULL,
    "salesforceEmail" TEXT,
    "teamId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "account_executives_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "team_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "salesEngineerId" TEXT NOT NULL,
    "accountExecutiveId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "team_assignments_salesEngineerId_fkey" FOREIGN KEY ("salesEngineerId") REFERENCES "sales_engineers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_assignments_accountExecutiveId_fkey" FOREIGN KEY ("accountExecutiveId") REFERENCES "account_executives" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sales_engineers_userId_key" ON "sales_engineers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_engineers_teamId_key" ON "sales_engineers"("teamId");

-- CreateIndex
CREATE INDEX "sales_engineers_userId_idx" ON "sales_engineers"("userId");

-- CreateIndex
CREATE INDEX "sales_engineers_teamId_idx" ON "sales_engineers"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "account_executives_salesforceId_key" ON "account_executives"("salesforceId");

-- CreateIndex
CREATE INDEX "account_executives_teamId_idx" ON "account_executives"("teamId");

-- CreateIndex
CREATE INDEX "account_executives_salesforceId_idx" ON "account_executives"("salesforceId");

-- CreateIndex
CREATE INDEX "team_assignments_salesEngineerId_idx" ON "team_assignments"("salesEngineerId");

-- CreateIndex
CREATE INDEX "team_assignments_accountExecutiveId_idx" ON "team_assignments"("accountExecutiveId");

-- CreateIndex
CREATE UNIQUE INDEX "team_assignments_salesEngineerId_accountExecutiveId_key" ON "team_assignments"("salesEngineerId", "accountExecutiveId");
