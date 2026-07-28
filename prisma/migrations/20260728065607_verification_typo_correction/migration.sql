-- AlterTable
ALTER TABLE "VerificationRow" ADD COLUMN     "probedEmail" TEXT;

-- AlterTable
ALTER TABLE "VerificationRun" ADD COLUMN     "emailIndex" INTEGER NOT NULL DEFAULT 0;
