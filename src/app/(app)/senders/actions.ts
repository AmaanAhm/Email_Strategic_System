"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function setDefaultSender(
  id: string,
): Promise<{ error: string } | void> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  const userId = session.user.id;

  const sender = await prisma.senderIdentity.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!sender) return { error: "Sender not found" };

  await prisma.$transaction([
    prisma.senderIdentity.updateMany({
      where: { userId },
      data: { isDefault: false },
    }),
    prisma.senderIdentity.update({
      where: { id },
      data: { isDefault: true },
    }),
  ]);

  revalidatePath("/senders");
}

export async function disconnectSender(
  id: string,
): Promise<{ error: string } | void> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  const userId = session.user.id;

  const sender = await prisma.senderIdentity.findFirst({
    where: { id, userId },
  });
  if (!sender) return { error: "Sender not found" };

  // Never orphan a live campaign: it would strand mid-send. DRAFT campaigns are
  // fine (SetNull; they re-resolve a sender at launch).
  const activeCount = await prisma.campaign.count({
    where: {
      senderIdentityId: id,
      status: { in: ["SCHEDULED", "RUNNING", "PAUSED"] },
    },
  });
  if (activeCount > 0) {
    return {
      error:
        "This sender is used by an active campaign. Cancel or finish it first.",
    };
  }

  await prisma.senderIdentity.delete({ where: { id } });

  // Keep exactly one default if any senders remain.
  if (sender.isDefault) {
    const next = await prisma.senderIdentity.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (next) {
      await prisma.senderIdentity.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }

  revalidatePath("/senders");
}
