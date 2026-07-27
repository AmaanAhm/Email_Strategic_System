import { NextRequest, NextResponse } from "next/server";
import type { RecipientStatus } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { CampaignStats } from "@/lib/types";

type StatusGroup = { status: RecipientStatus; _count: { _all: number } };

function toStats(groups: StatusGroup[]): CampaignStats {
  const count = (status: RecipientStatus) =>
    groups.find((g) => g.status === status)?._count._all ?? 0;
  const total = groups.reduce((sum, g) => sum + g._count._all, 0);
  return {
    total,
    scheduled: count("SCHEDULED"),
    queued: count("QUEUED") + count("SENDING"),
    sent: count("SENT"),
    failed: count("FAILED"),
    remaining:
      count("PENDING") + count("SCHEDULED") + count("QUEUED") + count("SENDING"),
  };
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const grouped = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: { campaignId: id },
  });

  return NextResponse.json(toStats(grouped));
}
