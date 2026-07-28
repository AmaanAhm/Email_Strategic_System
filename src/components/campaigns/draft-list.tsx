"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { FilePenLine, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteCampaignDraft } from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CampaignDraftSummary } from "@/lib/campaign-draft";

function savedAgo(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";
  return `${formatDistanceToNow(date)} ago`;
}

export function DraftList({
  drafts,
  currentDraftId = null,
  showHeader = true,
}: {
  drafts: CampaignDraftSummary[];
  currentDraftId?: string | null;
  /** The Drafts page has its own heading; suppress the duplicate. */
  showHeader?: boolean;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  if (drafts.length === 0) return null;

  async function handleDelete(id: string, label: string) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const result = await deleteCampaignDraft(id);
      if (result && "error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted “${label}”`);
      // Leaving the page open on a draft that no longer exists would let the
      // next save silently create a duplicate.
      if (id === currentDraftId) router.push("/campaigns/new");
      else router.refresh();
    } catch {
      toast.error("Could not delete the draft");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      {showHeader && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FilePenLine className="size-4" aria-hidden="true" />
            Unfinished campaigns ({drafts.length})
          </CardTitle>
          <CardDescription>
            Saved but not created yet. Pick one up where you left off.
          </CardDescription>
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-2 pt-6 first:pt-6">
        {drafts.map((draft) => {
          const label = draft.name?.trim() || draft.subjectPreview || "Untitled draft";
          const isCurrent = draft.id === currentDraftId;
          return (
            <div
              key={draft.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                isCurrent ? "border-primary/50 bg-primary/5" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {label}
                  {isCurrent && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      editing now
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {draft.subjectPreview && draft.subjectPreview !== label
                    ? `${draft.subjectPreview} · `
                    : ""}
                  saved {savedAgo(draft.updatedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!isCurrent && (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/campaigns/new?draft=${draft.id}`}>
                      Continue
                    </Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete draft ${label}`}
                  disabled={deletingId === draft.id}
                  onClick={() => handleDelete(draft.id, label)}
                >
                  {deletingId === draft.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
