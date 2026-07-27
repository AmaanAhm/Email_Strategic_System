-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "senderIdentityId" TEXT;

-- CreateTable
CREATE TABLE "SenderIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "googleSub" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "scope" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "needsReauth" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SenderIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SenderIdentity_userId_idx" ON "SenderIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SenderIdentity_userId_email_key" ON "SenderIdentity"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SenderIdentity_userId_googleSub_key" ON "SenderIdentity"("userId", "googleSub");

-- CreateIndex
CREATE INDEX "Campaign_senderIdentityId_idx" ON "Campaign"("senderIdentityId");

-- AddForeignKey
ALTER TABLE "SenderIdentity" ADD CONSTRAINT "SenderIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_senderIdentityId_fkey" FOREIGN KEY ("senderIdentityId") REFERENCES "SenderIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
