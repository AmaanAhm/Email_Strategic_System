import { CircleCheck } from "lucide-react";
import type { CampaignStatus, RecipientStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const recipientStyles: Record<
  RecipientStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Queued",
    className: "bg-muted text-muted-foreground",
  },
  SCHEDULED: {
    label: "Scheduled",
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  QUEUED: {
    label: "Queued",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  SENDING: {
    label: "Sending",
    className:
      "animate-pulse bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  SENT: {
    label: "Sent",
    className: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
  CANCELLED: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground",
  },
};

export function RecipientStatusBadge({ status }: { status: RecipientStatus }) {
  const style = recipientStyles[status];
  return (
    <Badge variant="secondary" className={cn(style.className)}>
      {style.label}
    </Badge>
  );
}

const campaignStyles: Record<
  CampaignStatus,
  { label: string; className: string; checked?: boolean }
> = {
  DRAFT: {
    label: "Draft",
    className: "bg-muted text-muted-foreground",
  },
  SCHEDULED: {
    label: "Scheduled",
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  RUNNING: {
    label: "Running",
    className: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  PAUSED: {
    label: "Paused",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    checked: true,
  },
  CANCELLED: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground",
  },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const style = campaignStyles[status];
  return (
    <Badge variant="secondary" className={cn(style.className)}>
      {style.checked ? <CircleCheck aria-hidden="true" /> : null}
      {style.label}
    </Badge>
  );
}
