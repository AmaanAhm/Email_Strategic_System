import { z } from "zod";

/**
 * Snapshot of the campaign form, stored as JSON on CampaignDraft.
 *
 * Every field is optional with a default so a draft saved by an older version
 * of the form still loads after new fields are added — the alternative is a
 * migration every time the form grows a control, and a draft that fails to
 * parse is worse than one that opens with a default in a new box.
 */
export const campaignDraftSchema = z.object({
  name: z.string().max(200).catch("").default(""),
  senderId: z.string().max(60).catch("").default(""),
  masterSubject: z.string().max(500).catch("").default(""),
  masterBody: z.string().max(50_000).catch("").default(""),
  pdf: z
    .object({
      path: z.string().max(120),
      fileName: z.string().max(255),
      size: z.number().nonnegative().catch(0),
    })
    .nullable()
    .catch(null)
    .default(null),
  recipientMode: z.enum(["all", "group"]).catch("all").default("all"),
  selectedGroupId: z.string().max(60).catch("").default(""),
  startMode: z.enum(["immediate", "scheduled"]).catch("immediate").default("immediate"),
  startDate: z.string().max(20).catch("").default(""),
  startHour: z.string().max(2).catch("").default(""),
  startMinute: z.string().max(2).catch("").default(""),
  timezone: z.string().max(60).catch("").default(""),
  workStartHour: z.string().max(2).catch("9").default("9"),
  workEndHour: z.string().max(2).catch("18").default("18"),
  minDelaySeconds: z.string().max(6).catch("120").default("120"),
  maxDelaySeconds: z.string().max(6).catch("480").default("480"),
  dailyLimit: z.string().max(4).catch("100").default("100"),
});

export type CampaignDraftData = z.infer<typeof campaignDraftSchema>;

/** Row shape handed to the drafts list UI. */
export interface CampaignDraftSummary {
  id: string;
  name: string | null;
  subjectPreview: string;
  updatedAt: string;
}

/**
 * Never trust what came out of the JSON column: it was written by an older
 * build, or by hand. Unparseable input yields defaults rather than throwing,
 * so one bad row cannot take down the whole drafts list.
 */
export function parseDraftData(raw: unknown): CampaignDraftData {
  const result = campaignDraftSchema.safeParse(raw ?? {});
  return result.success ? result.data : campaignDraftSchema.parse({});
}

/** Most drafts are unnamed; show something recognizable regardless. */
export function draftLabel(name: string | null, subject: string): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const subjectTrimmed = subject.trim();
  if (subjectTrimmed) return subjectTrimmed;
  return "Untitled draft";
}
