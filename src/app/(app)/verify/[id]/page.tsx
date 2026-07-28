import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResultsActions } from "@/components/verify/results-actions";
import { RunProgress } from "@/components/verify/run-progress";
import { VerdictBadge } from "@/components/verify/verdict-badge";
import { countVerdicts, reasonLabel } from "@/lib/verification";
import type { VerifyStats } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Rows shown on screen. The downloads carry the full set. */
const TABLE_LIMIT = 500;

export default async function VerifyRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const { id } = await params;

  const run = await prisma.verificationRun.findFirst({
    where: { id, userId },
    select: {
      id: true,
      source: true,
      status: true,
      total: true,
      processed: true,
      fileName: true,
      error: true,
      createdAt: true,
      group: { select: { id: true, name: true } },
      createdGroup: { select: { id: true, name: true } },
    },
  });
  if (!run) notFound();

  const [counts, blockedCount, rows] = await Promise.all([
    countVerdicts(id),
    // Only these rows are explained by our own IP being refused. Counting them
    // is what decides whether the note below is worth showing at all.
    prisma.verificationRow.count({ where: { runId: id, reason: "IP_BLOCKED" } }),
    prisma.verificationRow.findMany({
      where: { runId: id },
      orderBy: { position: "asc" },
      take: TABLE_LIMIT,
      select: {
        id: true,
        position: true,
        email: true,
        probedEmail: true,
        verdict: true,
        reason: true,
        detail: true,
      },
    }),
  ]);

  const stats: VerifyStats = {
    status: run.status,
    total: run.total,
    processed: run.processed,
    deliverable: counts.deliverable,
    undeliverable: counts.undeliverable,
    risky: counts.risky,
    error: run.error,
  };

  const title =
    run.source === "FILE"
      ? (run.fileName ?? "Uploaded sheet")
      : `${run.group?.name ?? "Deleted group"} (contact group)`;
  const defaultGroupName = (run.fileName ?? run.group?.name ?? "Verified list")
    .replace(/\.(csv|xlsx)$/i, "")
    .slice(0, 80);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/verify"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Verify your contacts
        </Link>
      </div>

      <div className="space-y-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">
          Started {format(run.createdAt, "MMM d, yyyy 'at' h:mm a")}
        </p>
      </div>

      {run.status === "FAILED" && (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>This check stopped early</AlertTitle>
          <AlertDescription>
            {run.error ?? "Something went wrong."} Results for addresses already
            checked are still below.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <RunProgress runId={run.id} initial={stats} />
        </CardContent>
      </Card>

      {blockedCount > 0 && (
        // Shown only when a run actually hit this, and phrased as an
        // explanation of specific rows rather than a standing warning — it
        // does not affect campaign sending, which goes out through Gmail.
        <p className="text-sm text-muted-foreground">
          {blockedCount} address{blockedCount === 1 ? "" : "es"} couldn&rsquo;t be
          checked because the mail server refused this server&rsquo;s IP. They are
          counted as Risky, which says nothing about whether the mailbox is real.
          Sending is unaffected — campaigns go out through Gmail.
        </p>
      )}

      {run.status !== "QUEUED" && run.status !== "RUNNING" && (
        <Card>
          <CardHeader>
            <CardTitle>Download</CardTitle>
          </CardHeader>
          <CardContent>
            <ResultsActions
              runId={run.id}
              cleanCount={counts.deliverable}
              riskyCount={counts.risky}
              canCreateGroup={run.source === "FILE"}
              defaultGroupName={defaultGroupName}
              savedGroup={run.createdGroup}
            />
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Results
          {run.total > TABLE_LIMIT && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              first {TABLE_LIMIT} of {run.total}
            </span>
          )}
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-36">Verdict</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {row.position + 1}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.probedEmail ? (
                      // Show the repair rather than quietly swapping the
                      // address: the download carries the corrected one.
                      <>
                        <span className="block text-muted-foreground line-through">
                          {row.email}
                        </span>
                        <span className="block">{row.probedEmail}</span>
                      </>
                    ) : (
                      row.email || (
                        <span className="text-muted-foreground italic">blank</span>
                      )
                    )}
                  </TableCell>
                  <TableCell>
                    <VerdictBadge verdict={row.verdict} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <span className="block">{reasonLabel(row.reason)}</span>
                    {row.detail && (
                      <span className="block truncate text-xs opacity-70" title={row.detail}>
                        {row.detail}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
