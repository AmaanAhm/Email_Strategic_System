import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePenLine } from "lucide-react";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { DraftList } from "@/components/campaigns/draft-list";
import {
  parseDraftData,
  type CampaignDraftSummary,
} from "@/lib/campaign-draft";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function DraftsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await prisma.campaignDraft.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const drafts: CampaignDraftSummary[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    subjectPreview: parseDraftData(d.data).masterSubject.slice(0, 80),
    updatedAt: d.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Drafts</h1>
          <p className="text-sm text-muted-foreground">
            Campaigns you started but have not created yet. Saved
            automatically as you type.
          </p>
        </div>
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FilePenLine
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No drafts</p>
              <p className="text-sm text-muted-foreground">
                Start a campaign and leave before finishing — it will show up
                here on its own.
              </p>
            </div>
            <Button asChild>
              <Link href="/campaigns/new">New campaign</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DraftList drafts={drafts} showHeader={false} />
      )}
    </div>
  );
}
