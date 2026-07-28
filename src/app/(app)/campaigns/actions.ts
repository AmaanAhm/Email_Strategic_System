"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { z } from "zod";
import type { CampaignStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { computeSchedule } from "@/lib/scheduling";
import { generateSubjectVariations } from "@/lib/subjects";
import { resolveSender } from "@/lib/senders";
import { findTemplateIssues } from "@/lib/template";
import { STORED_NAME_RE, isAllowedFileName } from "@/lib/attachments";
import { campaignDraftSchema } from "@/lib/campaign-draft";

const UPDATE_BATCH_SIZE = 200;

/**
 * The upload route hands the client back a bare "<uuid>.<ext>" filename, never
 * a path. Only that exact shape, with an allowlisted extension, is accepted
 * here and stored on the campaign; the worker re-resolves it against
 * UPLOAD_DIR.
 */
const PDF_PATH_RE = STORED_NAME_RE;
/** Display-only name: no path separators, CR/LF or NUL, allowlisted type. */
const PDF_FILE_NAME_RE = /^[^/\\\r\n\0]+$/;

/** [start, end) UTC instants of the calendar day that `at` falls on in `tz`. */
function tzDayBounds(at: Date, tz: string): [Date, Date] {
  const zoned = toZonedTime(at, tz);
  const y = zoned.getFullYear();
  const m = zoned.getMonth();
  const d = zoned.getDate();
  return [
    fromZonedTime(new Date(y, m, d, 0, 0, 0, 0), tz),
    fromZonedTime(new Date(y, m, d + 1, 0, 0, 0, 0), tz),
  ];
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1, "Campaign name is required").max(200),
    masterSubject: z.string().trim().min(1, "Subject is required").max(500),
    masterBody: z.string().trim().min(1, "Email body is required"),
    timezone: z
      .string()
      .refine(isValidTimezone, { message: "Invalid timezone" }),
    startAt: z
      .string()
      .min(1, "Start time is required")
      .transform((v, ctx) => {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          ctx.addIssue({ code: "custom", message: "Invalid start date" });
          return z.NEVER;
        }
        return d;
      }),
    workStartHour: z.coerce.number().int().min(0).max(23),
    workEndHour: z.coerce.number().int().min(1).max(24),
    minDelaySeconds: z.coerce.number().int().min(10).max(3600),
    maxDelaySeconds: z.coerce.number().int().min(10).max(3600),
    dailyLimit: z.coerce
      .number()
      .int()
      .transform((v) => Math.min(150, Math.max(1, v))),
    pdfPath: z
      .string()
      .regex(PDF_PATH_RE, "Invalid attachment reference")
      .optional(),
    pdfFileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(PDF_FILE_NAME_RE, "Invalid attachment file name")
      .refine(isAllowedFileName, "Unsupported attachment type")
      .optional(),
    senderIdentityId: z.string().min(1).max(60).optional(),
  })
  .refine((v) => v.workStartHour < v.workEndHour, {
    message: "Work start hour must be before work end hour",
    path: ["workEndHour"],
  })
  .refine((v) => v.minDelaySeconds <= v.maxDelaySeconds, {
    message: "Min delay must be <= max delay",
    path: ["maxDelaySeconds"],
  })
  // An unresolvable placeholder is not a cosmetic problem: it ships literal
  // "{{...}}" to a prospect and cannot be recalled. Refuse to create the
  // campaign at all rather than discover it after the first send.
  .superRefine((v, ctx) => {
    const fields = [
      ["masterSubject", "Subject"],
      ["masterBody", "Email body"],
    ] as const;
    for (const [field, label] of fields) {
      const issues = findTemplateIssues(v[field]);
      if (issues.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${label}: ${issues.join("; ")}`,
        });
      }
    }
  });

function parseContactIds(raw: unknown): string[] | "all" | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw === "all") return "all";
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = z.array(z.string().min(1)).safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Keeps a runaway client from filling the table via the save button. */
const MAX_DRAFTS_PER_USER = 50;

/**
 * Save (or update) an unfinished campaign form.
 *
 * Deliberately does not validate the way createCampaign does — the whole point
 * is to keep work that is not yet valid. Nothing saved here can send: drafts
 * have no recipients and no schedule until they go through createCampaign.
 */
export async function saveCampaignDraft(
  draftId: string | null,
  raw: unknown,
): Promise<{ id: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  const userId = session.user.id;

  const parsed = campaignDraftSchema.safeParse(raw);
  if (!parsed.success) return { error: "Could not save this draft" };
  const data = parsed.data;
  const name = data.name.trim() || null;

  if (draftId) {
    // Scoped to the user so an id from another account cannot be overwritten.
    const updated = await prisma.campaignDraft.updateMany({
      where: { id: draftId, userId },
      data: { name, data },
    });
    if (updated.count > 0) {
      revalidatePath("/campaigns");
      revalidatePath("/campaigns/new");
      return { id: draftId };
    }
    // Fall through: the draft was deleted in another tab, so save a new one
    // rather than silently discarding the user's work.
  }

  const created = await prisma.campaignDraft.create({
    data: { userId, name, data },
  });

  const stale = await prisma.campaignDraft.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    skip: MAX_DRAFTS_PER_USER,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.campaignDraft.deleteMany({
      where: { id: { in: stale.map((d) => d.id) }, userId },
    });
  }

  revalidatePath("/campaigns");
  revalidatePath("/campaigns/new");
  return { id: created.id };
}

export async function deleteCampaignDraft(
  id: string,
): Promise<{ error: string } | void> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  await prisma.campaignDraft.deleteMany({
    where: { id, userId: session.user.id },
  });
  revalidatePath("/campaigns");
  revalidatePath("/campaigns/new");
}

/**
 * Returns the existing campaign name that collides with `name`, or null.
 *
 * `mode: "insensitive"` maps to Postgres ILIKE, so this catches case variants
 * that a plain unique index would let through.
 */
async function findNameClash(
  userId: string,
  name: string,
): Promise<string | null> {
  const existing = await prisma.campaign.findFirst({
    where: { userId, name: { equals: name.trim(), mode: "insensitive" } },
    select: { name: true },
  });
  return existing?.name ?? null;
}

export async function createCampaign(
  formData: FormData,
): Promise<{ id: string } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  const userId = session.user.id;

  const optional = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" && v.trim().length > 0 ? v : undefined;
  };

  const parsed = createCampaignSchema.safeParse({
    name: formData.get("name"),
    masterSubject: formData.get("masterSubject"),
    masterBody: formData.get("masterBody"),
    timezone: formData.get("timezone"),
    startAt: formData.get("startAt"),
    workStartHour: formData.get("workStartHour"),
    workEndHour: formData.get("workEndHour"),
    minDelaySeconds: formData.get("minDelaySeconds"),
    maxDelaySeconds: formData.get("maxDelaySeconds"),
    dailyLimit: formData.get("dailyLimit"),
    pdfPath: optional("pdfPath"),
    pdfFileName: optional("pdfFileName"),
    senderIdentityId: optional("senderIdentityId"),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first ? first.message : "Invalid form data" };
  }
  const data = parsed.data;

  // Names must be distinct per user. Compared case- and whitespace-insensitively
  // because "Testing" and "testing " are the same campaign to a human, and a
  // list of near-identical names is impossible to tell apart later.
  const clash = await findNameClash(userId, data.name);
  if (clash) {
    return {
      error: `You already have a campaign called “${clash}”. Pick a different name.`,
    };
  }

  const contactIds = parseContactIds(formData.get("contactIds"));
  if (contactIds === null) return { error: "Invalid contact selection" };

  const contacts = await prisma.contact.findMany({
    where:
      contactIds === "all"
        ? { userId }
        : { userId, id: { in: contactIds } },
    orderBy: { createdAt: "asc" },
  });
  if (contacts.length === 0) return { error: "No contacts selected" };

  // Resolve the sending identity: explicit choice (validated as belonging to
  // this user), else the user's default. Stored so the worker knows who sends.
  const sender = await resolveSender(userId, data.senderIdentityId ?? null);

  // Tolerant: never throws — falls back to [masterSubject] on any failure.
  const subjectVariations = await generateSubjectVariations(
    data.masterSubject,
    data.masterBody,
  );

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        userId,
        name: data.name,
        masterSubject: data.masterSubject,
        masterBody: data.masterBody,
        subjectVariations,
        pdfPath: data.pdfPath ?? null,
        pdfFileName: data.pdfFileName ?? null,
        timezone: data.timezone,
        startAt: data.startAt,
        workStartHour: data.workStartHour,
        workEndHour: data.workEndHour,
        minDelaySeconds: data.minDelaySeconds,
        maxDelaySeconds: data.maxDelaySeconds,
        dailyLimit: data.dailyLimit,
        senderIdentityId: sender?.id ?? null,
        status: "DRAFT",
      },
    });
    await tx.campaignRecipient.createMany({
      data: contacts.map((c) => ({
        campaignId: created.id,
        contactId: c.id,
        name: c.name,
        company: c.company,
        email: c.email,
        website: c.website,
        industry: c.industry,
        status: "PENDING" as const,
      })),
    });
    return created;
  });

  revalidatePath("/campaigns");
  return { id: campaign.id };
}

/**
 * Start a campaign immediately, ignoring its configured start time and
 * working-hours window. Delays between emails and the daily limit still apply,
 * so Gmail-safety pacing is preserved.
 */
export async function sendCampaignNow(
  id: string,
): Promise<{ error: string } | void> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  const userId = session.user.id;

  const campaign = await prisma.campaign.findFirst({ where: { id, userId } });
  if (!campaign) return { error: "Campaign not found" };
  if (
    campaign.status === "COMPLETED" ||
    campaign.status === "CANCELLED"
  ) {
    return { error: `Cannot send a ${campaign.status.toLowerCase()} campaign` };
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: id, status: { in: ["PENDING", "SCHEDULED"] } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (recipients.length === 0) {
    return { error: "No recipients left to send" };
  }

  const origin = new Date();
  // Sends already made today still count against the cap.
  const [dayStart, dayEnd] = tzDayBounds(origin, campaign.timezone);
  const initialSentToday = await prisma.campaignRecipient.count({
    where: {
      campaignId: id,
      status: "SENT",
      sentAt: { gte: dayStart, lt: dayEnd },
    },
  });

  let dates: Date[];
  try {
    dates = computeSchedule({
      count: recipients.length,
      startAt: origin,
      timezone: campaign.timezone,
      // Send-now is an explicit override of the sending window.
      workStartHour: 0,
      workEndHour: 24,
      dailyLimit: campaign.dailyLimit,
      minDelaySeconds: campaign.minDelaySeconds,
      maxDelaySeconds: campaign.maxDelaySeconds,
      initialSentToday,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to compute schedule",
    };
  }

  for (let i = 0; i < recipients.length; i += UPDATE_BATCH_SIZE) {
    const chunk = recipients.slice(i, i + UPDATE_BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((r, j) =>
        prisma.campaignRecipient.update({
          where: { id: r.id },
          data: { status: "SCHEDULED", scheduledAt: dates[i + j] },
        }),
      ),
    );
  }

  await prisma.campaign.update({
    where: { id },
    data: {
      startAt: origin,
      status: "RUNNING",
      launchedAt: campaign.launchedAt ?? origin,
      completedAt: null,
    },
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}

export async function launchCampaign(
  id: string,
): Promise<{ error: string } | void> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  const userId = session.user.id;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
  });
  if (!campaign) return { error: "Campaign not found" };
  if (campaign.status !== "DRAFT") {
    return { error: "Only draft campaigns can be launched" };
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: id, status: "PENDING" },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (recipients.length === 0) {
    return { error: "Campaign has no pending recipients" };
  }

  // A draft may sit unlaunched past its startAt; scheduling from a stale origin
  // would put every send in the past and bypass delays and the daily cap.
  const origin = new Date(Math.max(campaign.startAt.getTime(), Date.now()));

  let dates: Date[];
  try {
    dates = computeSchedule({
      count: recipients.length,
      startAt: origin,
      timezone: campaign.timezone,
      workStartHour: campaign.workStartHour,
      workEndHour: campaign.workEndHour,
      dailyLimit: campaign.dailyLimit,
      minDelaySeconds: campaign.minDelaySeconds,
      maxDelaySeconds: campaign.maxDelaySeconds,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to compute schedule",
    };
  }

  for (let i = 0; i < recipients.length; i += UPDATE_BATCH_SIZE) {
    const chunk = recipients.slice(i, i + UPDATE_BATCH_SIZE);
    await prisma.$transaction(
      chunk.map((r, j) =>
        prisma.campaignRecipient.update({
          where: { id: r.id },
          data: { status: "SCHEDULED", scheduledAt: dates[i + j] },
        }),
      ),
    );
  }

  await prisma.campaign.update({
    where: { id },
    data: {
      startAt: origin,
      status: origin <= new Date() ? "RUNNING" : "SCHEDULED",
      launchedAt: new Date(),
    },
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}

export async function pauseCampaign(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  await prisma.campaign.updateMany({
    where: { id, userId, status: { in: ["SCHEDULED", "RUNNING"] } },
    data: { status: "PAUSED" },
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}

export async function resumeCampaign(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId, status: "PAUSED" },
  });
  if (!campaign) return;

  const scheduled = await prisma.campaignRecipient.findMany({
    where: { campaignId: id, status: "SCHEDULED" },
    orderBy: { scheduledAt: "asc" },
    select: { id: true },
  });

  if (scheduled.length > 0) {
    const origin = new Date(Math.max(Date.now(), campaign.startAt.getTime()));
    // Sends already made on the origin's tz-day still count against the cap,
    // otherwise each pause/resume grants a fresh dailyLimit for the same day.
    const [dayStart, dayEnd] = tzDayBounds(origin, campaign.timezone);
    const initialSentToday = await prisma.campaignRecipient.count({
      where: {
        campaignId: id,
        status: "SENT",
        sentAt: { gte: dayStart, lt: dayEnd },
      },
    });

    const dates = computeSchedule({
      count: scheduled.length,
      startAt: origin,
      timezone: campaign.timezone,
      workStartHour: campaign.workStartHour,
      workEndHour: campaign.workEndHour,
      dailyLimit: campaign.dailyLimit,
      minDelaySeconds: campaign.minDelaySeconds,
      maxDelaySeconds: campaign.maxDelaySeconds,
      initialSentToday,
    });
    for (let i = 0; i < scheduled.length; i += UPDATE_BATCH_SIZE) {
      const chunk = scheduled.slice(i, i + UPDATE_BATCH_SIZE);
      await prisma.$transaction(
        chunk.map((r, j) =>
          prisma.campaignRecipient.update({
            where: { id: r.id },
            data: { scheduledAt: dates[i + j] },
          }),
        ),
      );
    }
  }

  await prisma.campaign.update({
    where: { id },
    data: { status: "RUNNING" },
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}

/**
 * Statuses a campaign may be deleted from.
 *
 * A campaign that is still live is deliberately excluded — it has queued jobs
 * and a schedule in flight, and deleting it mid-flight would strand them.
 * Cancel first, which stops the sending, then delete.
 */
const DELETABLE_STATUSES: CampaignStatus[] = ["DRAFT", "COMPLETED", "CANCELLED"];

/**
 * Permanently removes a campaign and its per-recipient send record.
 *
 * The recipient rows cascade, and they are the only record of what was
 * actually sent to whom — so this is genuinely destructive for a campaign
 * that already ran, and the UI confirms before calling it. Contacts are
 * untouched: recipients hold a snapshot, and the contact relation is SetNull.
 */
export async function deleteCampaign(
  id: string,
): Promise<{ error: string } | void> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  const userId = session.user.id;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    select: { status: true },
  });
  if (!campaign) return { error: "Campaign not found" };

  if (!DELETABLE_STATUSES.includes(campaign.status)) {
    return {
      error:
        "This campaign is still active. Cancel it first, then it can be deleted.",
    };
  }

  // Scoped to the owner so a guessed id cannot delete someone else's campaign.
  await prisma.campaign.deleteMany({ where: { id, userId } });

  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
}

export async function cancelCampaign(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!campaign) return;

  await prisma.$transaction([
    prisma.campaignRecipient.updateMany({
      where: {
        campaignId: id,
        status: { in: ["PENDING", "SCHEDULED", "QUEUED"] },
      },
      data: { status: "CANCELLED" },
    }),
    prisma.campaign.update({
      where: { id },
      data: { status: "CANCELLED", completedAt: new Date() },
    }),
  ]);

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}
