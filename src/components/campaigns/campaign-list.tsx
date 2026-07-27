import Link from "next/link";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { CampaignStatus } from "@prisma/client";

import { CampaignStatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface CampaignListRow {
  id: string;
  name: string;
  status: CampaignStatus;
  timezone: string;
  startAt: Date;
  createdAt: Date;
  total: number;
  sent: number;
  failed: number;
}

export function CampaignList({ campaigns }: { campaigns: CampaignListRow[] }) {
  return (
    <div className="glass overflow-x-auto rounded-2xl">
      <Table className="[&_td]:py-3 [&_th]:py-3">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Recipients</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead>Scheduled start</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:nth-child(even)]:bg-muted/20">
          {campaigns.map((campaign) => (
            <TableRow key={campaign.id}>
              <TableCell className="max-w-[240px]">
                <Link
                  href={`/campaigns/${campaign.id}`}
                  className="block truncate font-medium hover:underline"
                  title={campaign.name}
                >
                  {campaign.name}
                </Link>
              </TableCell>
              <TableCell>
                <CampaignStatusBadge status={campaign.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {campaign.total}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {campaign.sent}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {campaign.failed}
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span>
                    {formatInTimeZone(
                      campaign.startAt,
                      campaign.timezone,
                      "d MMM yyyy, h:mm a"
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {campaign.timezone}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {format(campaign.createdAt, "d MMM yyyy")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
