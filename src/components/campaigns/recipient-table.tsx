"use client";

import { formatInTimeZone } from "date-fns-tz";
import { Sparkles } from "lucide-react";
import type { RecipientStatus } from "@prisma/client";

import { RecipientStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface RecipientRow {
  id: string;
  email: string;
  name: string;
  company: string;
  status: RecipientStatus;
  scheduledAt: Date | null;
  sentAt: Date | null;
  finalSubject: string | null;
  lastError: string | null;
  usedFallback: boolean;
}

function formatAt(date: Date | null, timezone: string) {
  if (!date) return null;
  return formatInTimeZone(date, timezone, "d MMM, h:mm a");
}

export function RecipientTable({
  recipients,
  timezone,
}: {
  recipients: RecipientRow[];
  timezone: string;
}) {
  return (
    <TooltipProvider>
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Sent at</TableHead>
              <TableHead>Subject used</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recipients.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-24 text-center text-muted-foreground"
                >
                  No recipients.
                </TableCell>
              </TableRow>
            ) : (
              recipients.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.email}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="max-w-[160px]">
                    <span className="block truncate" title={r.company}>
                      {r.company}
                    </span>
                  </TableCell>
                  <TableCell>
                    <RecipientStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatAt(r.scheduledAt, timezone) ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatAt(r.sentAt, timezone) ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[240px]">
                    <div className="flex items-center gap-1.5">
                      {r.finalSubject ? (
                        <span
                          className="block min-w-0 truncate"
                          title={r.finalSubject}
                        >
                          {r.finalSubject}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {r.usedFallback ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 bg-violet-500/15 text-violet-600 dark:text-violet-400"
                        >
                          <Sparkles aria-hidden="true" />
                          AI fallback
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    {r.lastError ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block cursor-default truncate text-red-600 dark:text-red-400">
                            {r.lastError}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm whitespace-pre-wrap">
                          {r.lastError}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
