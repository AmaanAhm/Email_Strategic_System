import Link from "next/link";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  Hourglass,
  Plus,
  Send,
  Upload,
  Users,
} from "lucide-react";
import type { RecipientStatus } from "@prisma/client";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { CampaignStats } from "@/lib/types";
import { backfillSenderImages } from "@/lib/sender-photos";
import { StatCards } from "@/components/dashboard/stat-cards";
import { SentCalendar } from "@/components/dashboard/sent-calendar";
import { SenderAvatar } from "@/components/sender-avatar";
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
import { Progress } from "@/components/ui/progress";

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const userId = session.user.id;
  const sp = await searchParams;

  const [totalContacts, grouped, activeCampaigns, recentCampaigns] =
    await Promise.all([
      prisma.contact.count({ where: { userId } }),
      prisma.campaignRecipient.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { campaign: { userId } },
      }),
      prisma.campaign.count({
        where: { userId, status: { in: ["RUNNING", "SCHEDULED"] } },
      }),
      prisma.campaign.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

  const stats = toStats(grouped);

  const perCampaign =
    recentCampaigns.length > 0
      ? await prisma.campaignRecipient.groupBy({
          by: ["campaignId", "status"],
          _count: { _all: true },
          where: { campaignId: { in: recentCampaigns.map((c) => c.id) } },
        })
      : [];

  const counts = new Map<string, { total: number; sent: number }>();
  for (const g of perCampaign) {
    const entry = counts.get(g.campaignId) ?? { total: 0, sent: 0 };
    entry.total += g._count._all;
    if (g.status === "SENT") entry.sent += g._count._all;
    counts.set(g.campaignId, entry);
  }

  const processed = stats.sent + stats.failed;
  const deliveryRate =
    processed > 0 ? Math.round((stats.sent / processed) * 100) : null;
  const barTotal = Math.max(stats.total, 1);
  const sentPct = (stats.sent / barTotal) * 100;
  const failedPct = (stats.failed / barTotal) * 100;
  const remPct = (stats.remaining / barTotal) * 100;

  // "Today" is measured in the timezone of the most recent campaign.
  const refTz = recentCampaigns[0]?.timezone ?? "Asia/Kolkata";
  const now = new Date();
  const zonedNow = toZonedTime(now, refTz);
  const todayStart = fromZonedTime(
    new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate()),
    refTz,
  );

  // Day filter: the selected calendar day (in refTz), defaulting to today.
  const todayYmd = formatInTimeZone(now, refTz, "yyyy-MM-dd");
  const selectedYmd = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "")
    ? (sp.day as string)
    : todayYmd;
  const [dy, dm, dd] = selectedYmd.split("-").map(Number);
  const dayStart = fromZonedTime(new Date(dy, dm - 1, dd), refTz);
  const dayEnd = fromZonedTime(new Date(dy, dm - 1, dd + 1), refTz);

  // Best-effort: fill in any missing Google profile photos before we read them.
  await backfillSenderImages(userId);

  const [sentToday, upcoming, senders, dayGroups, allSent] = await Promise.all([
    prisma.campaignRecipient.count({
      where: {
        campaign: { userId },
        status: "SENT",
        sentAt: { gte: todayStart },
      },
    }),
    prisma.campaignRecipient.findMany({
      where: {
        campaign: { userId },
        status: "SCHEDULED",
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: "asc" },
      take: 6,
      select: {
        id: true,
        scheduledAt: true,
        campaign: { select: { name: true, timezone: true } },
      },
    }),
    prisma.senderIdentity.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.campaignRecipient.groupBy({
      by: ["campaignId"],
      _count: { _all: true },
      where: {
        campaign: { userId },
        status: "SENT",
        sentAt: { gte: dayStart, lt: dayEnd },
      },
    }),
    prisma.campaignRecipient.findMany({
      where: { campaign: { userId }, status: "SENT", sentAt: { not: null } },
      select: { sentAt: true },
    }),
  ]);

  // Calendar dots: distinct calendar days (in refTz) that had at least one send.
  const markedDays = Array.from(
    new Set(
      allSent
        .filter((r) => r.sentAt)
        .map((r) => formatInTimeZone(r.sentAt as Date, refTz, "yyyy-MM-dd")),
    ),
  );

  // Resolve campaign names for the selected day's per-campaign breakdown.
  const dayCampaigns =
    dayGroups.length > 0
      ? await prisma.campaign.findMany({
          where: { id: { in: dayGroups.map((g) => g.campaignId) } },
          select: { id: true, name: true },
        })
      : [];
  const dayNameById = new Map(dayCampaigns.map((c) => [c.id, c.name]));
  const dayBreakdown = dayGroups
    .map((g) => ({
      id: g.campaignId,
      name: dayNameById.get(g.campaignId) ?? "Unknown campaign",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
  const sentSelectedDay = dayBreakdown.reduce((sum, b) => sum + b.count, 0);

  // Sends per sender: recipients are SENT via their campaign's chosen sender.
  const senderSentCounts = await Promise.all(
    senders.map((s) =>
      prisma.campaignRecipient.count({
        where: { status: "SENT", campaign: { userId, senderIdentityId: s.id } },
      }),
    ),
  );
  const senderStats = senders.map((s, i) => ({
    id: s.id,
    email: s.email,
    name: s.name,
    image: s.image,
    isDefault: s.isDefault,
    needsReauth: s.needsReauth,
    sent: senderSentCounts[i],
  }));

  return (
    <div className="space-y-6 p-4 md:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

      <StatCards
        items={[
          {
            label: "Total Contacts",
            value: totalContacts,
            icon: Users,
            tone: "blue",
          },
          {
            label: "Scheduled",
            value: stats.scheduled,
            icon: CalendarClock,
            tone: "amber",
          },
          { label: "Sent", value: stats.sent, icon: Send, tone: "green" },
          {
            label: "Failed",
            value: stats.failed,
            icon: AlertTriangle,
            tone: "red",
          },
          {
            label: "Remaining",
            value: stats.remaining,
            icon: Hourglass,
            tone: "violet",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Delivery overview</CardTitle>
          <CardDescription>Across all your campaigns</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <span className="text-4xl font-semibold tabular-nums">
              {deliveryRate === null ? "—" : `${deliveryRate}%`}
            </span>
            <span className="pb-1.5 text-xs text-muted-foreground">
              delivered
            </span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            {sentPct > 0 && (
              <div className="bg-gmail-green" style={{ width: `${sentPct}%` }} />
            )}
            {failedPct > 0 && (
              <div className="bg-gmail-red" style={{ width: `${failedPct}%` }} />
            )}
            {remPct > 0 && (
              <div
                className="bg-gmail-blue/40"
                style={{ width: `${remPct}%` }}
              />
            )}
          </div>
          <ul className="grid grid-cols-3 gap-2 text-xs">
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-gmail-green" />
              <span className="text-muted-foreground">Sent</span>
              <span className="ml-auto font-medium tabular-nums">
                {stats.sent}
              </span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-gmail-red" />
              <span className="text-muted-foreground">Failed</span>
              <span className="ml-auto font-medium tabular-nums">
                {stats.failed}
              </span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-gmail-blue/40" />
              <span className="text-muted-foreground">Left</span>
              <span className="ml-auto font-medium tabular-nums">
                {stats.remaining}
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Recent campaigns</CardTitle>
          <CardDescription>
            {activeCampaigns > 0
              ? `${activeCampaigns} active campaign${activeCampaigns === 1 ? "" : "s"}`
              : "No active campaigns"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentCampaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {totalContacts === 0
                  ? "Get started by importing your contacts, then create your first campaign."
                  : "You have contacts ready. Create your first campaign to start sending."}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild variant="outline">
                  <Link href="/contacts">
                    <Upload data-icon="inline-start" />
                    Import contacts
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/campaigns/new">
                    <Plus data-icon="inline-start" />
                    Create campaign
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <ul className="divide-y">
              {recentCampaigns.map((campaign) => {
                const c = counts.get(campaign.id) ?? { total: 0, sent: 0 };
                const pct = c.total > 0 ? (c.sent / c.total) * 100 : 0;
                return (
                  <li key={campaign.id} className="first:pt-0 last:pb-0">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      aria-label={`Open campaign ${campaign.name}`}
                      className="group -mx-2 flex flex-col gap-2 rounded-lg px-2 py-3 transition-colors hover:bg-accent sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium group-hover:underline">
                          {campaign.name}
                        </span>
                        <CampaignStatusBadge status={campaign.status} />
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="text-xs text-muted-foreground">
                          {format(campaign.createdAt, "d MMM yyyy")}
                        </span>
                        <div className="flex w-40 items-center gap-2">
                          <Progress value={pct} className="flex-1" />
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {c.sent}/{c.total}
                          </span>
                        </div>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Sent on a day</CardTitle>
            <CardDescription>
              Pick a date to see that day&apos;s send volume
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SentCalendar
              selected={selectedYmd}
              today={todayYmd}
              markedDays={markedDays}
            />
            <div className="flex items-end gap-2">
              <span className="text-4xl font-semibold tabular-nums">
                {sentSelectedDay.toLocaleString("en-US")}
              </span>
              <span className="pb-1.5 text-xs text-muted-foreground">
                sent {selectedYmd === todayYmd ? "today" : "that day"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatInTimeZone(dayStart, refTz, "EEEE, d MMMM yyyy")}
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Breakdown by campaign</CardTitle>
            <CardDescription>
              Which campaigns sent on the selected day
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dayBreakdown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No emails were sent on this day.
              </p>
            ) : (
              <ul className="divide-y">
                {dayBreakdown.map((b) => {
                  const pct =
                    sentSelectedDay > 0 ? (b.count / sentSelectedDay) * 100 : 0;
                  return (
                    <li
                      key={b.id}
                      className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                    >
                      <Link
                        href={`/campaigns/${b.id}`}
                        className="min-w-0 truncate text-sm font-medium hover:underline"
                      >
                        {b.name}
                      </Link>
                      <div className="flex w-40 shrink-0 items-center gap-2">
                        <Progress value={pct} className="flex-1" />
                        <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                          {b.count}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Today &amp; upcoming</CardTitle>
            <CardDescription>Sent today and what&apos;s next out</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <span className="text-4xl font-semibold tabular-nums">
                {sentToday}
              </span>
              <span className="pb-1.5 text-xs text-muted-foreground">
                sent today
              </span>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Next up
              </p>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing scheduled.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {upcoming.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate">{u.campaign.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {u.scheduledAt
                          ? formatInTimeZone(
                              u.scheduledAt,
                              u.campaign.timezone,
                              "d MMM, h:mm a",
                            )
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sender health</CardTitle>
            <CardDescription>
              Your connected accounts and their volume
            </CardDescription>
          </CardHeader>
          <CardContent>
            {senderStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No senders connected.{" "}
                <Link
                  href="/senders"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Connect one
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y">
                {senderStats.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <SenderAvatar
                        image={s.image}
                        name={s.name}
                        email={s.email}
                        className="size-8 text-xs"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {s.name ?? s.email}
                          </span>
                          {s.isDefault && (
                            <Badge variant="secondary">Default</Badge>
                          )}
                          {s.needsReauth && (
                            <Badge variant="destructive">Reconnect</Badge>
                          )}
                        </div>
                        <span className="block truncate text-xs text-muted-foreground">
                          {s.email}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm tabular-nums">
                        <span className="font-semibold">
                          {s.sent.toLocaleString("en-US")}
                        </span>{" "}
                        <span className="text-muted-foreground">sent</span>
                      </span>
                      {s.needsReauth && (
                        <Button asChild size="sm" variant="outline">
                          <a href="/api/senders/connect">Reconnect</a>
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
