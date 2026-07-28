"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteContactGroup } from "@/app/(app)/contacts/actions";

export function DeleteGroupButton({
  groupId,
  name,
}: {
  groupId: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  function confirmDelete() {
    startTransition(async () => {
      const res = await deleteContactGroup(groupId);
      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Group deleted");
      router.push("/contacts");
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`Delete group ${name}`}
      >
        <Trash2 data-icon="inline-start" />
        Delete group
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !isPending) setOpen(false);
        }}
        title={`Delete “${name}”?`}
        description="Its contacts go too."
        confirmLabel="Delete group"
        destructive
        loading={isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
