"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import type { CampaignStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteCampaign } from "@/app/(app)/campaigns/actions";

/** Mirrors DELETABLE_STATUSES in the action; the server is still the authority. */
const DELETABLE: CampaignStatus[] = ["DRAFT", "COMPLETED", "CANCELLED"];

export function DeleteCampaignButton({
  id,
  name,
  status,
  sent,
  variant = "icon",
  redirectTo,
}: {
  id: string;
  name: string;
  status: CampaignStatus;
  /** Emails already delivered — shown so the cost of deleting is explicit. */
  sent: number;
  variant?: "icon" | "button";
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const deletable = DELETABLE.includes(status);

  async function confirm() {
    setDeleting(true);
    const result = await deleteCampaign(id);
    if (result && "error" in result) {
      toast.error(result.error);
      setDeleting(false);
      setOpen(false);
      return;
    }
    toast.success(`Deleted “${name}”`);
    setOpen(false);
    setDeleting(false);
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete campaign ${name}`}
          title={
            deletable
              ? `Delete ${name}`
              : "Cancel this campaign before deleting it"
          }
          disabled={!deletable}
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : (
        <Button
          variant="outline"
          disabled={!deletable}
          title={deletable ? undefined : "Cancel this campaign before deleting it"}
          onClick={() => setOpen(true)}
        >
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !deleting && setOpen(next)}
        title={`Delete “${name}”?`}
        description={
          // One line. The red button and the "Delete ...?" title already carry
          // the warning; spelling out the consequences a fourth time is noise.
          sent > 0 ? (
            <>
              Removes the send record for {sent} email{sent === 1 ? "" : "s"}.
              Contacts aren&rsquo;t affected.
            </>
          ) : (
            <>This campaign never sent anything.</>
          )
        }
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        destructive
        loading={deleting}
        onConfirm={confirm}
      />
    </>
  );
}
