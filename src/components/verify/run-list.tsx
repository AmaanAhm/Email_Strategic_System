"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, FileSpreadsheet, Trash2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteVerification } from "@/app/(app)/verify/actions";

export interface RunRow {
  id: string;
  label: string;
  source: "FILE" | "CONTACT_GROUP";
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  total: number;
  processed: number;
  deliverable: number;
  createdLabel: string;
}

const STATUS_STYLES: Record<RunRow["status"], { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "bg-muted text-muted-foreground" },
  RUNNING: {
    label: "Checking",
    className: "animate-pulse bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  COMPLETED: {
    label: "Done",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  FAILED: { label: "Failed", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

export function RunList({ runs }: { runs: RunRow[] }) {
  const router = useRouter();
  const [target, setTarget] = React.useState<RunRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  async function confirmDelete() {
    if (!target) return;
    setDeleting(true);
    const result = await deleteVerification(target.id);
    if (result && "error" in result) {
      toast.error(result.error);
    } else {
      toast.success("Check deleted");
      router.refresh();
    }
    setDeleting(false);
    setTarget(null);
  }

  return (
    <>
      <ul className="divide-y rounded-lg border">
        {runs.map((run) => {
          const style = STATUS_STYLES[run.status];
          const Icon = run.source === "FILE" ? FileSpreadsheet : Users;
          return (
            <li key={run.id} className="flex items-center gap-3 p-3">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <Link href={`/verify/${run.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{run.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {run.createdLabel} ·{" "}
                  {run.status === "RUNNING" || run.status === "QUEUED"
                    ? `${run.processed} of ${run.total} checked`
                    : `${run.deliverable} of ${run.total} deliverable`}
                </span>
              </Link>
              <Badge variant="secondary" className={style.className}>
                {style.label}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete check ${run.label}`}
                onClick={() => setTarget(run)}
              >
                <Trash2 className="size-4" />
              </Button>
              <Link
                href={`/verify/${run.id}`}
                aria-label={`Open check ${run.label}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="size-4" />
              </Link>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Delete this check?"
        description="Removes the results only. Contacts and downloaded sheets are unaffected."
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
