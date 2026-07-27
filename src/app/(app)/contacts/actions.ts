"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function createContactGroup(
  name: string,
): Promise<{ id: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a group name" };
  if (trimmed.length > 80) return { error: "Group name is too long (max 80)" };

  const group = await prisma.contactGroup.create({
    data: { userId: session.user.id, name: trimmed },
  });
  revalidatePath("/contacts");
  return { id: group.id };
}

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
