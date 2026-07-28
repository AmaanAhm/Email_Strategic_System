"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getVerifyQueue } from "@/lib/queues";
import { createGroupRun } from "@/lib/verification";

type ActionError = { error: string };

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Starts a verification run over an existing contact group. */
export async function verifyContactGroup(
  groupId: string,
): Promise<{ runId: string } | ActionError> {
  const userId = await requireUserId();
  if (!userId) return { error: "Unauthorized" };

  const group = await prisma.contactGroup.findFirst({
    where: { id: groupId, userId },
    select: { id: true },
  });
  if (!group) return { error: "Group not found" };

  // Refuse to stack runs on one group — the second would re-probe every
  // address the first is already working through.
  const active = await prisma.verificationRun.findFirst({
    where: { groupId, userId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (active) return { runId: active.id };

  try {
    const runId = await createGroupRun(userId, groupId);
    revalidatePath("/verify");
    revalidatePath(`/contacts/${groupId}`);
    return { runId };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not start verification",
    };
  }
}

export async function cancelVerification(id: string): Promise<ActionError | void> {
  const userId = await requireUserId();
  if (!userId) return { error: "Unauthorized" };

  // Only an in-flight run can be cancelled; the worker checks this between
  // domains and stops there.
  await prisma.verificationRun.updateMany({
    where: { id, userId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  try {
    const job = await getVerifyQueue().getJob(`verify-${id}`);
    // A job that has already started keeps running until its next cancel
    // check; removing a waiting job stops it from ever starting.
    if (job && !(await job.isActive())) await job.remove();
  } catch {
    // Redis being unavailable must not block the DB-side cancel.
  }

  revalidatePath("/verify");
  revalidatePath(`/verify/${id}`);
}

export async function deleteVerification(id: string): Promise<ActionError | void> {
  const userId = await requireUserId();
  if (!userId) return { error: "Unauthorized" };

  const run = await prisma.verificationRun.findFirst({
    where: { id, userId },
    select: { status: true },
  });
  if (!run) return { error: "Not found" };
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    return { error: "Cancel the run before deleting it." };
  }

  // Rows cascade with the run.
  await prisma.verificationRun.deleteMany({ where: { id, userId } });
  revalidatePath("/verify");
}

/**
 * Creates a contact group from a run's DELIVERABLE rows.
 *
 * Only offered for file runs — a group run's clean rows are already contacts.
 * Name and company fall back to the address itself so the campaign form,
 * which requires both, always has something to substitute.
 */
export async function createGroupFromClean(
  runId: string,
  name: string,
): Promise<{ groupId: string } | ActionError> {
  const userId = await requireUserId();
  if (!userId) return { error: "Unauthorized" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the group a name." };
  if (trimmed.length > 80) return { error: "Group name is too long (max 80)." };

  const run = await prisma.verificationRun.findFirst({
    where: { id: runId, userId },
    select: {
      headers: true,
      createdGroupId: true,
      createdGroup: { select: { id: true, name: true } },
    },
  });
  if (!run) return { error: "Not found" };

  // Saving twice would leave two identical groups in Contacts. The check is
  // here and not only in the UI because a double-click, a stale page or a
  // resubmitted form all reach this action directly.
  if (run.createdGroup) {
    return {
      error: `Already saved to “${run.createdGroup.name}”. Delete that group first if you want to save these again.`,
    };
  }

  const rows = await prisma.verificationRow.findMany({
    where: { runId, verdict: "DELIVERABLE" },
    select: { email: true, cells: true },
    orderBy: { position: "asc" },
  });
  if (rows.length === 0) {
    return { error: "This run has no confirmed-deliverable rows." };
  }

  const headers = (run.headers as unknown as string[]) ?? [];
  const pick = (cells: string[], candidates: string[]): string => {
    for (const candidate of candidates) {
      const index = headers.findIndex(
        (h) => h.trim().toLowerCase() === candidate,
      );
      if (index !== -1 && (cells[index] ?? "").trim()) return cells[index].trim();
    }
    return "";
  };

  try {
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.contactGroup.create({
        data: { userId, name: trimmed },
      });
      const data = rows.map((row) => {
        const cells = (row.cells as unknown as string[]) ?? [];
        return {
          userId,
          groupId: created.id,
          name: pick(cells, ["name", "full name", "contact name", "contact"]) || row.email,
          company: pick(cells, ["company", "organization", "organisation", "company name"]) || row.email,
          email: row.email,
          website: pick(cells, ["website", "url", "site", "web"]) || null,
          industry: pick(cells, ["industry", "sector", "category"]) || null,
          verifyVerdict: "DELIVERABLE" as const,
          verifyReason: "MAILBOX_EXISTS",
          verifiedAt: new Date(),
        };
      });
      const inserted = await tx.contact.createMany({ data, skipDuplicates: true });
      if (inserted.count === 0) throw new Error("NO_ROWS");

      // Claim the run atomically. Two requests racing past the check above
      // both reach here, but only the one that finds createdGroupId still
      // null wins — the loser rolls back its group instead of duplicating it.
      const claimed = await tx.verificationRun.updateMany({
        where: { id: runId, userId, createdGroupId: null },
        data: { createdGroupId: created.id },
      });
      if (claimed.count === 0) throw new Error("ALREADY_SAVED");

      return created;
    });

    revalidatePath("/contacts");
    revalidatePath(`/verify/${runId}`);
    return { groupId: group.id };
  } catch (err) {
    if (err instanceof Error && err.message === "NO_ROWS") {
      return { error: "No contacts could be created from those rows." };
    }
    if (err instanceof Error && err.message === "ALREADY_SAVED") {
      return { error: "These rows were just saved to a group." };
    }
    console.error("createGroupFromClean failed:", err);
    return { error: "Could not create the group." };
  }
}

/**
 * Deletes the contacts in a group whose last verdict was UNDELIVERABLE.
 *
 * Confirmation-gated in the UI and deliberately narrow: RISKY contacts are
 * never touched. A RISKY verdict frequently means our own IP was blocked or
 * the domain accepts everything — deleting on that basis would destroy
 * perfectly reachable contacts.
 */
export async function removeUndeliverableContacts(
  groupId: string,
): Promise<{ removed: number } | ActionError> {
  const userId = await requireUserId();
  if (!userId) return { error: "Unauthorized" };

  const group = await prisma.contactGroup.findFirst({
    where: { id: groupId, userId },
    select: { id: true },
  });
  if (!group) return { error: "Group not found" };

  const { count } = await prisma.contact.deleteMany({
    where: { groupId, userId, verifyVerdict: "UNDELIVERABLE" },
  });

  revalidatePath(`/contacts/${groupId}`);
  revalidatePath("/contacts");
  return { removed: count };
}
