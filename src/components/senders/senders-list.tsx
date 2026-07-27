"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Star, Trash2 } from "lucide-react";
import {
  disconnectSender,
  setDefaultSender,
} from "@/app/(app)/senders/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SenderAvatar } from "@/components/sender-avatar";

export interface SenderRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  isDefault: boolean;
  needsReauth: boolean;
  lastUsedLabel: string | null;
}

export function SendersList({ senders }: { senders: SenderRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = React.useState<SenderRow | null>(
    null,
  );
  const [isPending, startTransition] = React.useTransition();

  function handleSetDefault(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const res = await setDefaultSender(id);
      setBusyId(null);
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success("Default sender updated");
        router.refresh();
      }
    });
  }

  function confirmDisconnect() {
    const target = confirmTarget;
    if (!target) return;
    setBusyId(target.id);
    startTransition(async () => {
      const res = await disconnectSender(target.id);
      setBusyId(null);
      if (res && "error" in res) {
        toast.error(res.error);
      } else {
        toast.success("Sender disconnected");
        router.refresh();
      }
      setConfirmTarget(null);
    });
  }

  if (senders.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No senders connected yet. Connect a Google account above to start
        sending.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y rounded-lg border">
      {senders.map((s) => {
        const busy = isPending && busyId === s.id;
        return (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <SenderAvatar image={s.image} name={s.name} email={s.email} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {s.name ?? s.email}
                  </span>
                  {s.isDefault && (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="size-3" aria-hidden="true" />
                      Default
                    </Badge>
                  )}
                  {s.needsReauth && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      Reconnect
                    </Badge>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {s.name ? `${s.email} · ` : ""}
                  {s.lastUsedLabel ? `last used ${s.lastUsedLabel}` : "never used"}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {s.needsReauth && (
                <Button asChild variant="outline" size="sm">
                  {/* Plain anchor: never prefetch an OAuth-redirecting route. */}
                  <a href="/api/senders/connect">Reconnect</a>
                </Button>
              )}
              {!s.isDefault && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleSetDefault(s.id)}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Star className="size-4" />
                  )}
                  Set default
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmTarget(s)}
                aria-label={`Disconnect ${s.email}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </li>
        );
      })}
      </ul>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setConfirmTarget(null);
        }}
        title="Disconnect sender?"
        description={
          <>
            Campaigns won&apos;t be able to send from{" "}
            <span className="font-medium text-foreground">
              {confirmTarget?.email}
            </span>{" "}
            until it&apos;s reconnected.
          </>
        }
        confirmLabel="Disconnect"
        destructive
        loading={isPending && busyId === confirmTarget?.id}
        onConfirm={confirmDisconnect}
      />
    </>
  );
}
