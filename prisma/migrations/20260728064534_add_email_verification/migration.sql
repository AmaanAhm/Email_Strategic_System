-- CreateEnum
CREATE TYPE "VerifySource" AS ENUM ('FILE', 'CONTACT_GROUP');

-- CreateEnum
CREATE TYPE "VerifyRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VerifyVerdict" AS ENUM ('PENDING', 'DELIVERABLE', 'UNDELIVERABLE', 'RISKY');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifyReason" TEXT,
ADD COLUMN     "verifyVerdict" "VerifyVerdict";

-- CreateTable
CREATE TABLE "VerificationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "VerifySource" NOT NULL,
    "fileName" TEXT,
    "groupId" TEXT,
    "headers" JSONB NOT NULL,
    "status" "VerifyRunStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRow" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "cells" JSONB NOT NULL,
    "contactId" TEXT,
    "verdict" "VerifyVerdict" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "detail" TEXT,

    CONSTRAINT "VerificationRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationRun_userId_createdAt_idx" ON "VerificationRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRun_status_idx" ON "VerificationRun"("status");

-- CreateIndex
CREATE INDEX "VerificationRow_runId_position_idx" ON "VerificationRow"("runId", "position");

-- CreateIndex
CREATE INDEX "VerificationRow_runId_verdict_idx" ON "VerificationRow"("runId", "verdict");

-- CreateIndex
CREATE INDEX "Contact_groupId_verifyVerdict_idx" ON "Contact"("groupId", "verifyVerdict");

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ContactGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRow" ADD CONSTRAINT "VerificationRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "VerificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
