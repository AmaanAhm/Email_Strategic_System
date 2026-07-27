import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import { auth } from "@/auth";
import { ensureDefaultSenderIdentity, listSenders } from "@/lib/senders";
import { backfillSenderImages } from "@/lib/sender-photos";
import {
  SendersList,
  type SenderRow,
} from "@/components/senders/senders-list";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CONNECT_ERRORS: Record<string, string> = {
  invalid_state: "The connection request expired or was invalid. Try again.",
  no_refresh_token:
    "Google didn't grant offline access. Remove this app's access in your Google account, then reconnect.",
  exchange_failed: "Could not complete the connection with Google. Try again.",
  access_denied: "You declined the permission. The account was not connected.",
};

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    email?: string;
    reason?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Backfill the login Google account as the first default sender.
  await ensureDefaultSenderIdentity(session.user.id);
  // Best-effort: fill in any missing Google profile photos.
  await backfillSenderImages(session.user.id);
  const senders = await listSenders(session.user.id);
  const sp = await searchParams;

  const rows: SenderRow[] = senders.map((s) => ({
    id: s.id,
    email: s.email,
    name: s.name,
    image: s.image,
    isDefault: s.isDefault,
    needsReauth: s.needsReauth,
    lastUsedLabel: s.lastUsedAt
      ? formatDistanceToNow(s.lastUsedAt, { addSuffix: true })
      : null,
  }));

  const success = sp.connected === "success";
  const errorMsg =
    sp.connected === "error"
      ? (CONNECT_ERRORS[sp.reason ?? ""] ??
        "Could not connect the account. Try again.")
      : null;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Senders</h1>
        <p className="text-sm text-muted-foreground">
          Connect the Google accounts you send campaigns from. Each campaign
          picks one, and its address is used for the From and Reply-To headers.
        </p>
      </div>

      {success && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Connected{sp.email ? ` ${sp.email}` : ""}. It&apos;s ready to send
            from.
          </span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connect a Google account</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild>
            {/* Plain anchor: this route redirects to Google; never prefetch it. */}
            <a href="/api/senders/connect">
              <Plus className="size-4" />
              Connect Google account
            </a>
          </Button>
        </CardContent>
      </Card>

      <SendersList senders={rows} />
    </div>
  );
}
