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
import {
  SampleSheetButton,
  SampleSheetNote,
} from "@/components/contacts/sample-sheet";
import type { ImportResult } from "@/lib/types";

export function CreateGroupButton({
  label = "Create group",
}: {
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);

  function reset() {
    setName("");
    setFile(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !file || loading) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("newGroupName", trimmed);
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        body: fd,
      });
      const data: Partial<ImportResult> & {
        groupId?: string;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.groupId) {
        toast.error(data.error ?? "Could not create the group");
        return;
      }
      toast.success(
        `Created “${trimmed}” with ${data.imported} contact${data.imported === 1 ? "" : "s"}`,
      );
      // Navigation unmounts this component, so `loading` stays true on purpose.
      router.push(`/contacts/${data.groupId}`);
    } catch {
      toast.error("Could not create the group");
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (loading) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>Create a group</DialogTitle>
              <DialogDescription>
                Name the group and choose the contacts file to fill it. Both are
                needed — a group is created only once it has contacts in it.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
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
              <div className="grid gap-2">
                <Label htmlFor="group-file">Contacts file</Label>
                <Input
                  id="group-file"
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  disabled={loading}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  CSV or Excel (.csv, .xlsx, .xls), up to 5MB.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    Not sure about the format?
                  </p>
                  <SampleSheetButton variant="secondary" />
                </div>
                <SampleSheetNote />
              </div>
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
              <Button type="submit" disabled={!name.trim() || !file || loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                {loading ? "Importing..." : "Create & import"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
