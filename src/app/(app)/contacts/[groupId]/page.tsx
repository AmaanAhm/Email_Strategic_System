import { notFound } from "next/navigation";
import { Upload } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ImportDialog } from "@/components/contacts/import-dialog";
import { DeleteGroupButton } from "@/components/contacts/delete-group-button";
import {
  SampleSheetButton,
  SampleSheetNote,
} from "@/components/contacts/sample-sheet";
import {
  ContactsTable,
  type SerializedContact,
} from "@/components/contacts/contacts-table";

export default async function ContactGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const { groupId } = await params;

  const group = await prisma.contactGroup.findFirst({
    where: { id: groupId, userId },
  });
  if (!group) notFound();

  const contacts = await prisma.contact.findMany({
    where: { groupId, userId },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const serialized: SerializedContact[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    email: c.email,
    website: c.website,
    industry: c.industry,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {group.name}
          </h1>
          <Badge variant="secondary">{contacts.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {contacts.length > 0 && <ImportDialog groupId={groupId} />}
          <DeleteGroupButton groupId={groupId} name={group.name} />
        </div>
      </div>

      {contacts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Upload className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No contacts in this group yet</p>
              <p className="text-sm text-muted-foreground">
                Import a CSV or Excel file to fill “{group.name}”.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ImportDialog groupId={groupId} triggerLabel="Import contacts" />
              <SampleSheetButton />
            </div>
            <SampleSheetNote className="max-w-xl" />
          </CardContent>
        </Card>
      ) : (
        <ContactsTable contacts={serialized} groupId={groupId} />
      )}
    </div>
  );
}
