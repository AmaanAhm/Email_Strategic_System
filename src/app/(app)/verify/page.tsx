import { format } from "date-fns";
import { MailCheck } from "lucide-react";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { RunList, type RunRow } from "@/components/verify/run-list";
import { UploadCard } from "@/components/verify/upload-card";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const session = await auth();
  const userId = session?.user?.id;
  // The (app) layout guards authentication; this satisfies strictness.
  if (!userId) return null;

  const runs = await prisma.verificationRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        source: true,
        status: true,
        total: true,
        processed: true,
        fileName: true,
        createdAt: true,
        group: { select: { name: true } },
        _count: { select: { rows: true } },
        rows: { where: { verdict: "DELIVERABLE" }, select: { id: true } },
      },
  });

  const rows: RunRow[] = runs.map((run) => ({
    id: run.id,
    label:
      run.source === "FILE"
        ? (run.fileName ?? "Uploaded sheet")
        : `${run.group?.name ?? "Deleted group"} (contact group)`,
    source: run.source,
    status: run.status,
    total: run.total,
    processed: run.processed,
    deliverable: run.rows.length,
    createdLabel: format(run.createdAt, "MMM d, yyyy 'at' h:mm a"),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Verify your contacts
        </h1>
      </div>

      <UploadCard />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent checks</h2>
        {rows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <MailCheck className="size-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">Nothing checked yet</p>
                <p className="text-sm text-muted-foreground">
                  Upload a sheet above, or open a contact group and check the
                  addresses already in it.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <RunList runs={rows} />
        )}
      </section>
    </div>
  );
}
