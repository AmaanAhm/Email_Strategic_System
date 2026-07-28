"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Progress } from "@/components/ui/progress";
import { cancelVerification } from "@/app/(app)/verify/actions";
import type { VerifyStats } from "@/lib/types";

const POLL_MS = 4_000;

/**
 * Polls a running verification and refreshes the page when it finishes.
 *
 * Polling rather than router.refresh() on a timer because a run can take
 * hours: a cheap JSON poll keeps the numbers live, and the expensive full
 * re-render happens only when the run actually reaches a terminal state.
 */
export function RunProgress({
  runId,
  initial,
}: {
  runId: string;
  initial: VerifyStats;
}) {
  const router = useRouter();
  const [stats, setStats] = React.useState(initial);
  const [confirming, setConfirming] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  const active = stats.status === "QUEUED" || stats.status === "RUNNING";

  React.useEffect(() => {
    if (!active) return;
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/verify/${runId}/status`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const next: VerifyStats = await res.json();
        if (stopped) return;
        setStats(next);
        // Terminal state: pull the full results table down from the server.
        if (next.status !== "QUEUED" && next.status !== "RUNNING") router.refresh();
      } catch {
        // A transient network blip should not kill the poller.
      }
    };

    const id = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active, runId, router]);

  async function confirmCancel() {
    setCancelling(true);
    const result = await cancelVerification(runId);
    if (result && "error" in result) {
      toast.error(result.error);
      setCancelling(false);
      setConfirming(false);
      return;
    }
    toast.success("Verification cancelled");
    setConfirming(false);
    setCancelling(false);
    router.refresh();
  }

  const pct = stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          {active && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <span className="font-medium tabular-nums">
            {stats.processed} of {stats.total} checked
          </span>
          {active && (
            <span className="text-muted-foreground">
              — this runs in the background, you can leave this page
            </span>
          )}
        </div>
        {active && (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            <Ban data-icon="inline-start" />
            Cancel
          </Button>
        )}
      </div>

      <Progress value={pct} />

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Stat label="Deliverable" value={stats.deliverable} dot="bg-green-500" />
        <Stat label="Risky" value={stats.risky} dot="bg-amber-500" />
        <Stat label="Undeliverable" value={stats.undeliverable} dot="bg-red-500" />
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancel this check?"
        description="Addresses already checked keep their results."
        confirmLabel="Cancel check"
        cancelLabel="Keep going"
        destructive
        loading={cancelling}
        onConfirm={confirmCancel}
      />
    </div>
  );
}

function Stat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}
