"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createContactGroup } from "@/app/(app)/contacts/actions";

export function CreateGroupButton({
  label = "Create group",
}: {
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    const res = await createContactGroup(trimmed);
    if ("error" in res) {
      setLoading(false);
      toast.error(res.error);
      return;
    }
    toast.success("Group created");
    // Route to the new group's page to import into it. Keep `loading` true —
    // navigation unmounts this component.
    router.push(`/contacts/${res.id}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !loading && setOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>Create a group</DialogTitle>
              <DialogDescription>
                Name this group, then import contacts into it.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="group-name">Group name</Label>
              <Input
                id="group-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q3 Prospects"
                maxLength={80}
                disabled={loading}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                Create &amp; import
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
