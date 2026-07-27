import { prisma } from "@/lib/db";
import type { SenderIdentity } from "@prisma/client";

/**
 * Ensure the user has at least one sending identity. On first call it backfills
 * the user's login Google account (from the Auth.js `Account` row) as the
 * default sender, so existing users keep sending exactly as before. Returns the
 * default (or first) sender, or null if the user has no usable Google grant.
 */
export async function ensureDefaultSenderIdentity(
  userId: string,
): Promise<SenderIdentity | null> {
  const existing = await prisma.senderIdentity.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (existing) return existing;

  const [account, user] = await Promise.all([
    prisma.account.findFirst({ where: { userId, provider: "google" } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, image: true },
    }),
  ]);
  if (!account?.refresh_token || !user?.email) return null;

  try {
    return await prisma.senderIdentity.create({
      data: {
        userId,
        email: user.email,
        name: user.name,
        image: user.image,
        googleSub: account.providerAccountId,
        refresh_token: account.refresh_token,
        access_token: account.access_token,
        expires_at: account.expires_at,
        scope: account.scope,
        isDefault: true,
      },
    });
  } catch {
    // A concurrent backfill won the unique([userId, googleSub]) race.
    return prisma.senderIdentity.findFirst({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }
}

export async function listSenders(userId: string): Promise<SenderIdentity[]> {
  return prisma.senderIdentity.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * Pick the sender for a campaign: an explicit valid choice wins, otherwise fall
 * back to the user's default, then the most recently used, then the oldest.
 * Returns null only when the user has no senders at all.
 */
export async function resolveSender(
  userId: string,
  explicitId?: string | null,
): Promise<SenderIdentity | null> {
  if (explicitId) {
    const chosen = await prisma.senderIdentity.findFirst({
      where: { id: explicitId, userId },
    });
    if (chosen) return chosen;
  }
  const byDefault = await prisma.senderIdentity.findFirst({
    where: { userId, isDefault: true },
  });
  if (byDefault) return byDefault;
  const byLastUsed = await prisma.senderIdentity.findFirst({
    where: { userId, lastUsedAt: { not: null } },
    orderBy: { lastUsedAt: "desc" },
  });
  if (byLastUsed) return byLastUsed;
  return prisma.senderIdentity.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Resolve the sending identity for a campaign, given its stored (possibly null)
 * senderIdentityId. Used by the worker at send time.
 */
export async function getSenderForCampaign(campaign: {
  userId: string;
  senderIdentityId: string | null;
}): Promise<SenderIdentity | null> {
  return resolveSender(campaign.userId, campaign.senderIdentityId);
}
