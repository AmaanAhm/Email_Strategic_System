import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ensureDefaultSenderIdentity, listSenders } from "@/lib/senders";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { parseDraftData } from "@/lib/campaign-draft";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function NewCampaignPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<{ draft?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }
  const { draft: requestedDraftId } = await searchParams;

  await ensureDefaultSenderIdentity(session.user.id);
  const [contacts, groups, senderRows, activeDraft] = await Promise.all([
    prisma.contact.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, company: true, email: true, groupId: true },
    }),
    prisma.contactGroup.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { contacts: true } } },
    }),
    listSenders(session.user.id),
    // Scoped to this user, so a guessed id from another account is simply not
    // found rather than loaded.
    requestedDraftId
      ? prisma.campaignDraft.findFirst({
          where: { id: requestedDraftId, userId: session.user.id },
        })
      : Promise.resolve(null),
  ]);

  const initialDraft = activeDraft ? parseDraftData(activeDraft.data) : null;
  const senders = senderRows.map((s) => ({
    id: s.id,
    email: s.email,
    name: s.name,
    isDefault: s.isDefault,
  }));
  const groupOptions = groups.map((g) => ({
    id: g.id,
    name: g.name,
    count: g._count.contacts,
  }));

  if (contacts.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" />
              No contacts yet
            </CardTitle>
            <CardDescription>
              You need at least one contact before creating a campaign. Import
              your contacts from a CSV or Excel file to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/contacts">Import contacts</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {activeDraft ? "Continue draft" : "New campaign"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Compose your master email, pick recipients, and set a sending
          schedule. AI will uniquely rewrite each email before it is sent.
        </p>
      </div>
      <CampaignForm
        key={activeDraft?.id ?? "new"}
        contacts={contacts}
        groups={groupOptions}
        senders={senders}
        defaultTimezone="Asia/Kolkata"
        draftId={activeDraft?.id ?? null}
        initialDraft={initialDraft}
      />
    </div>
  );
}
