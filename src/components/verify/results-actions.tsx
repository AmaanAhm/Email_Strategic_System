"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { CircleCheck, Download, FolderPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createGroupFromClean } from "@/app/(app)/verify/actions";

/**
 * Downloads plus the optional "turn the clean rows into a contact group" step.
 *
 * The group is opt-in via a checkbox rather than automatic: a verification run
 * is often a one-off cleanup of somebody else's list, and silently creating
 * contacts from it would clutter Contacts with lists nobody asked to keep.
 */
export function ResultsActions({
  runId,
  cleanCount,
  riskyCount,
  canCreateGroup,
  defaultGroupName,
  savedGroup,
}: {
  runId: string;
  cleanCount: number;
  riskyCount: number;
  canCreateGroup: boolean;
  defaultGroupName: string;
  /** The group these rows were already saved into, if any. */
  savedGroup: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [wantGroup, setWantGroup] = React.useState(false);
  const [name, setName] = React.useState(defaultGroupName);
  const [saving, setSaving] = React.useState(false);

  async function create() {
    if (saving) return;
    setSaving(true);
    const result = await createGroupFromClean(runId, name);
    if ("error" in result) {
      toast.error(result.error);
      setSaving(false);
      return;
    }
    toast.success(`Created “${name.trim()}” with ${cleanCount} contacts`);
    router.push(`/contacts/${result.groupId}`);
  }

  return (
    <div className="space-y-4">
      {/* One tile per file. The explanation sits with the button it describes,
          so neither has to be read as a paragraph before you can act. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <BucketTile
          runId={runId}
          bucket="clean"
          label="Clean"
          count={cleanCount}
          dot="bg-green-500"
          description="A mail server confirmed these addresses accept mail."
          emptyNote="No address could be confirmed."
          primary
        />
        <BucketTile
          runId={runId}
          bucket="risky"
          label="Risky"
          count={riskyCount}
          dot="bg-amber-500"
          description="Nobody would confirm these — catch-all domains, deferrals, blocked lookups. Usually real people, just unprovable from here."
          emptyNote="Nothing landed here."
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Both files keep every column from your sheet, in the original order.
      </p>

      {savedGroup ? (
        // Already saved. Offering the checkbox again is how you end up with
        // two identical groups, so it is replaced by where the rows went.
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-4 text-sm">
          <CircleCheck className="size-4 shrink-0 text-green-600 dark:text-green-400" />
          <span>Saved to contact group</span>
          <Link
            href={`/contacts/${savedGroup.id}`}
            className="font-medium underline underline-offset-4 hover:text-foreground"
          >
            {savedGroup.name}
          </Link>
        </div>
      ) : (
        canCreateGroup && cleanCount > 0 && (
        <div className="rounded-lg border p-4">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={wantGroup}
              onChange={(e) => setWantGroup(e.target.checked)}
            />
            <span>
              <span className="font-medium">Also save as a contact group</span>
              <span className="block text-muted-foreground">
                Adds the {cleanCount} deliverable{" "}
                {cleanCount === 1 ? "address" : "addresses"} to Contacts so you
                can send a campaign to them without re-uploading.
              </span>
            </span>
          </label>

          {wantGroup && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="grid min-w-56 flex-1 gap-2">
                <Label htmlFor="new-group-name">Group name</Label>
                <Input
                  id="new-group-name"
                  value={name}
                  maxLength={80}
                  disabled={saving}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <Button onClick={create} disabled={!name.trim() || saving}>
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FolderPlus data-icon="inline-start" />
                )}
                {saving ? "Creating..." : "Create group"}
              </Button>
            </div>
          )}
        </div>
        )
      )}
    </div>
  );
}

/**
 * One downloadable bucket.
 *
 * When the bucket is empty it renders a real disabled <button> rather than a
 * link. `<Button asChild disabled>` puts a `disabled` attribute on an <a>,
 * which HTML ignores — the link stays clickable and hands back an empty sheet.
 */
function BucketTile({
  runId,
  bucket,
  label,
  count,
  dot,
  description,
  emptyNote,
  primary = false,
}: {
  runId: string;
  bucket: "clean" | "risky";
  label: string;
  count: number;
  dot: string;
  description: string;
  emptyNote: string;
  primary?: boolean;
}) {
  const empty = count === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className={`size-2 shrink-0 translate-y-[-1px] rounded-full ${dot}`} />
          <span className="font-medium">{label}</span>
          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
            {count} {count === 1 ? "row" : "rows"}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {empty ? emptyNote : description}
        </p>
      </div>

      {empty ? (
        <Button variant="outline" disabled className="mt-auto w-full">
          <Download data-icon="inline-start" />
          Nothing to download
        </Button>
      ) : (
        <Button
          asChild
          variant={primary ? "default" : "outline"}
          className="mt-auto w-full"
        >
          <a href={`/api/verify/${runId}/download?bucket=${bucket}`}>
            <Download data-icon="inline-start" />
            Download {label.toLowerCase()}
          </a>
        </Button>
      )}
    </div>
  );
}
