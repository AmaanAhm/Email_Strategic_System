import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarClock,
  Hourglass,
  Paperclip,
  Pause,
  Play,
  Rocket,
  Zap,
  Send,
  Users,
} from "lucide-react";
import type { RecipientStatus } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { CampaignStats } from "@/lib/types";
import {
  cancelCampaign,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  sendCampaignNow,
} from "@/app/(app)/campaigns/actions";
import { AutoRefresh } from "@/components/campaigns/auto-refresh";
import { DeleteCampaignButton } from "@/components/campaigns/delete-campaign-button";
import { RecipientTable } from "@/components/campaigns/recipient-table";
import { StatCards } from "@/components/dashboard/stat-cards";
import { CampaignStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatDelay(seconds: number) {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const userId = session.user.id;

  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
  });
  if (!campaign) notFound();

  const [grouped, recipients, sender] = await Promise.all([
    prisma.campaignRecipient.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { campaignId: id },
    }),
    prisma.campaignRecipient.findMany({
      where: { campaignId: id },
      orderBy: { scheduledAt: { sort: "asc", nulls: "last" } },
      take: 500,
    }),
    campaign.senderIdentityId
      ? prisma.senderIdentity.findUnique({
          where: { id: campaign.senderIdentityId },
          select: { email: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  const stats = toStats(grouped);
  const refreshActive = campaign.status === "RUNNING" || stats.queued > 0;

  async function handleLaunch() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) return;
    await launchCampaign(id);
    revalidatePath(`/campaigns/${id}`);
  }

  async function handlePause() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) return;
    await pauseCampaign(id);
    revalidatePath(`/campaigns/${id}`);
  }

  async function handleResume() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) return;
    await resumeCampaign(id);
    revalidatePath(`/campaigns/${id}`);
  }

  async function handleCancel() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) return;
    await cancelCampaign(id);
    revalidatePath(`/campaigns/${id}`);
  }

  async function handleSendNow() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) return;
    await sendCampaignNow(id);
    revalidatePath(`/campaigns/${id}`);
  }

  const canPause =
    campaign.status === "SCHEDULED" || campaign.status === "RUNNING";
  const canResume = campaign.status === "PAUSED";
  const canCancel =
    campaign.status === "SCHEDULED" || campaign.status === "PAUSED";
  const canSendNow =
    campaign.status !== "COMPLETED" &&
    campaign.status !== "CANCELLED" &&
    stats.remaining > 0;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <AutoRefresh active={refreshActive} />

      <div>
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Campaigns
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {campaign.name}
          </h1>
          <CampaignStatusBadge status={campaign.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {campaign.status === "DRAFT" ? (
            <form action={handleLaunch}>
              <Button type="submit">
                <Rocket data-icon="inline-start" />
                Launch
              </Button>
            </form>
          ) : null}
          {canSendNow ? (
            <form action={handleSendNow}>
              <Button
                type="submit"
                variant={campaign.status === "DRAFT" ? "outline" : "default"}
                title="Start immediately, ignoring the start time and working hours. Delays and the daily limit still apply."
              >
                <Zap data-icon="inline-start" />
                Send now
              </Button>
            </form>
          ) : null}
          {canPause ? (
            <form action={handlePause}>
              <Button type="submit" variant="outline">
                <Pause data-icon="inline-start" />
                Pause
              </Button>
            </form>
          ) : null}
          {canResume ? (
            <form action={handleResume}>
              <Button type="submit">
                <Play data-icon="inline-start" />
                Resume
              </Button>
            </form>
          ) : null}
          {canCancel ? (
            <form action={handleCancel}>
              <Button type="submit" variant="destructive">
                <Ban data-icon="inline-start" />
                Cancel
              </Button>
            </form>
          ) : null}
          <DeleteCampaignButton
            id={campaign.id}
            name={campaign.name}
            status={campaign.status}
            sent={stats.sent}
            variant="button"
            redirectTo="/campaigns"
          />
        </div>
      </div>

      <StatCards
        items={[
          { label: "Total", value: stats.total, icon: Users, tone: "blue" },
          {
            label: "Scheduled",
            value: stats.scheduled,
            icon: CalendarClock,
            tone: "amber",
          },
          {
            label: "Queued",
            value: stats.queued,
            icon: Hourglass,
            tone: "violet",
          },
          { label: "Sent", value: stats.sent, icon: Send, tone: "green" },
          {
            label: "Failed",
            value: stats.failed,
            icon: AlertTriangle,
            tone: "red",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>
              Sending window and pacing for this campaign.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Send from</dt>
              <dd className="min-w-0 truncate">
                {sender
                  ? sender.name
                    ? `${sender.name} (${sender.email})`
                    : sender.email
                  : "No sender assigned"}
              </dd>
              <dt className="text-muted-foreground">Starts</dt>
              <dd>
                {formatInTimeZone(
                  campaign.startAt,
                  campaign.timezone,
                  "EEE, d MMM yyyy 'at' h:mm a"
                )}
              </dd>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd>{campaign.timezone}</dd>
              <dt className="text-muted-foreground">Working hours</dt>
              <dd>
                {formatHour(campaign.workStartHour)} –{" "}
                {formatHour(campaign.workEndHour)}
              </dd>
              <dt className="text-muted-foreground">Delay between emails</dt>
              <dd>
                {formatDelay(campaign.minDelaySeconds)} –{" "}
                {formatDelay(campaign.maxDelaySeconds)}
              </dd>
              <dt className="text-muted-foreground">Daily limit</dt>
              <dd>{campaign.dailyLimit} emails / day</dd>
              {campaign.pdfFileName ? (
                <>
                  <dt className="text-muted-foreground">Attachment</dt>
                  <dd className="flex items-center gap-1.5">
                    <Paperclip
                      className="size-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {campaign.pdfFileName}
                  </dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subject variations</CardTitle>
            <CardDescription>
              Master subject plus AI-generated variations rotated per
              recipient.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Master</Badge>
                <span className="text-sm">{campaign.masterSubject}</span>
              </div>
              {campaign.subjectVariations.length > 0 ? (
                <ul className="space-y-1.5">
                  {campaign.subjectVariations.map((subject, i) => (
                    <li
                      key={i}
                      className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs"
                    >
                      {subject}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No variations generated.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Master email body</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {campaign.masterBody}
          </pre>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Recipients</h2>
        <RecipientTable recipients={recipients} timezone={campaign.timezone} />
        {recipients.length === 500 ? (
          <p className="text-xs text-muted-foreground">
            Showing the first 500 recipients.
          </p>
        ) : null}
      </div>
    </div>
  );
}
