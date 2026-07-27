-- Require every contact to belong to a group (backfilled prior to this migration).
ALTER TABLE "Contact" ALTER COLUMN "groupId" SET NOT NULL;

-- Move email uniqueness from per-user to per-group so the same address can live
-- in different groups while staying deduped within a group.
DROP INDEX "Contact_userId_email_key";
CREATE UNIQUE INDEX "Contact_groupId_email_key" ON "Contact"("groupId", "email");
