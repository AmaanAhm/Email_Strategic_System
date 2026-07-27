import { format } from "date-fns";
import { FolderPlus } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CreateGroupButton } from "@/components/contacts/create-group-button";
import { GroupsList, type GroupRow } from "@/components/contacts/groups-list";

export default async function ContactsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  // The (app) layout guards authentication; this satisfies strictness.
  if (!userId) return null;

  const groups = await prisma.contactGroup.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { contacts: true } } },
  });

  const rows: GroupRow[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    count: g._count.contacts,
    createdLabel: format(g.createdAt, "MMM d, yyyy"),
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <Badge variant="secondary">
            {groups.length} group{groups.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <CreateGroupButton />
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FolderPlus className="size-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No contact groups yet</p>
              <p className="text-sm text-muted-foreground">
                Create a group, then import contacts into it.
              </p>
            </div>
            <CreateGroupButton label="Create your first group" />
          </CardContent>
        </Card>
      ) : (
        <GroupsList groups={rows} />
      )}
    </div>
  );
}
