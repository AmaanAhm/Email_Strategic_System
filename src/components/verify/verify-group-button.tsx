"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MailCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  removeUndeliverableContacts,
  verifyContactGroup,
} from "@/app/(app)/verify/actions";

/**
 * Runs a deliverability check over an existing group, and — once there are
 * confirmed-dead contacts — offers to remove them.
 *
 * Removal is deliberately limited to UNDELIVERABLE. RISKY contacts are left
 * alone no matter how many there are: that bucket is full of people whose
 * server simply would not answer us.
 */
export function VerifyGroupButton({
  groupId,
  undeliverableCount,
}: {
  groupId: string;
  undeliverableCount: number;
}) {
  const router = useRouter();
  const [starting, setStarting] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  async function start() {
    if (starting) return;
    setStarting(true);
    const result = await verifyContactGroup(groupId);
    if ("error" in result) {
      toast.error(result.error);
      setStarting(false);
      return;
    }
    router.push(`/verify/${result.runId}`);
  }

  async function confirmRemove() {
    setRemoving(true);
    const result = await removeUndeliverableContacts(groupId);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(
        `Removed ${result.removed} contact${result.removed === 1 ? "" : "s"}`,
      );
      router.refresh();
    }
    setRemoving(false);
    setConfirming(false);
  }

  return (
    <>
      <Button variant="outline" onClick={start} disabled={starting}>
        {starting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MailCheck data-icon="inline-start" />
        )}
        {starting ? "Starting..." : "Check addresses"}
      </Button>

      {undeliverableCount > 0 && (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          <Trash2 data-icon="inline-start" />
          Remove {undeliverableCount} dead
        </Button>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${undeliverableCount} contact${undeliverableCount === 1 ? "" : "s"}?`}
        description={
          // Keep only the protective fact: Risky contacts survive. That is the
          // one thing the user cannot infer from the button.
          <>
            Only the ones a mail server rejected.{" "}
            <span className="font-medium">Risky</span> contacts are kept.
          </>
        }
        confirmLabel={removing ? "Removing..." : "Remove"}
        destructive
        loading={removing}
        onConfirm={confirmRemove}
      />
    </>
  );
}
