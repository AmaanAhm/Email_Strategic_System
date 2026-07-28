"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

// Groups are created only by POST /api/contacts/import with a newGroupName,
// which creates the group and its contacts in one transaction. There is
// deliberately no action that creates an empty group: every path to a group
// goes through a file that has at least one usable contact in it.

export async function deleteContactGroup(
  id: string,
): Promise<{ error: string } | void> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  // Cascade deletes the group's contacts (CampaignRecipient keeps its snapshot).
  await prisma.contactGroup.deleteMany({
    where: { id, userId: session.user.id },
  });
  revalidatePath("/contacts");
}

export async function deleteContact(id: string, groupId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await prisma.contact.deleteMany({
    where: { id, userId: session.user.id },
  });
  revalidatePath(`/contacts/${groupId}`);
}

export async function clearGroupContacts(groupId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await prisma.contact.deleteMany({
    where: { groupId, userId: session.user.id },
  });
  revalidatePath(`/contacts/${groupId}`);
}
