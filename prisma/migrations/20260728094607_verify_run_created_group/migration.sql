-- AlterTable
ALTER TABLE "VerificationRun" ADD COLUMN     "createdGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_createdGroupId_fkey" FOREIGN KEY ("createdGroupId") REFERENCES "ContactGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
