import Link from "next/link";
import { redirect } from "next/navigation";
import { Megaphone, Plus } from "lucide-react";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  CampaignList,
  type CampaignListRow,
} from "@/components/campaigns/campaign-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const userId = session.user.id;

  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const grouped =
    campaigns.length > 0
      ? await prisma.campaignRecipient.groupBy({
          by: ["campaignId", "status"],
          _count: { _all: true },
          where: { campaign: { userId } },
        })
      : [];

  const counts = new Map<
    string,
    { total: number; sent: number; failed: number }
  >();
  for (const g of grouped) {
    const entry =
      counts.get(g.campaignId) ?? { total: 0, sent: 0, failed: 0 };
    entry.total += g._count._all;
    if (g.status === "SENT") entry.sent += g._count._all;
    if (g.status === "FAILED") entry.failed += g._count._all;
    counts.set(g.campaignId, entry);
  }

  const rows: CampaignListRow[] = campaigns.map((c) => {
    const stat = counts.get(c.id) ?? { total: 0, sent: 0, failed: 0 };
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      timezone: c.timezone,
      startAt: c.startAt,
      createdAt: c.createdAt,
      total: stat.total,
      sent: stat.sent,
      failed: stat.failed,
    };
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Megaphone
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No campaigns yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first campaign to start reaching out.
              </p>
            </div>
            <Button asChild>
              <Link href="/campaigns/new">
                <Plus data-icon="inline-start" />
                New Campaign
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <CampaignList campaigns={rows} />
      )}
    </div>
  );
}
