export interface ContactRow {
  name: string;
  company: string;
  email: string;
  website?: string;
  industry?: string;
}

export interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  errors: { row: number; message: string }[];
}

export interface ScheduleOptions {
  count: number;
  /** UTC instant the campaign starts. */
  startAt: Date;
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** 0..23, in campaign timezone. */
  workStartHour: number;
  /** 1..24, exclusive upper bound, must be > workStartHour. */
  workEndHour: number;
  /** 1..150 emails per timezone-day. */
  dailyLimit: number;
  minDelaySeconds: number;
  /** Must be >= minDelaySeconds. */
  maxDelaySeconds: number;
  /**
   * Emails already sent on the first tz-day of this schedule; counts against
   * dailyLimit for that day only. Defaults to 0.
   */
  initialSentToday?: number;
  /** Returns [0,1). Injectable for deterministic tests; defaults to Math.random. */
  rng?: () => number;
}

export interface RewriteInput {
  /** Master body with {{variables}} already substituted. */
  masterBody: string;
  /** Chosen subject variation with variables already substituted. */
  subject: string;
  recipient: ContactRow;
  senderName: string;
}

export interface RewrittenEmail {
  subject: string;
  greeting: string;
  opening: string;
  body: string;
  cta: string;
  closing: string;
}

export interface CampaignStats {
  total: number;
  scheduled: number;
  queued: number;
  sent: number;
  failed: number;
  remaining: number;
}

export const TICK_QUEUE = "campaign-tick";
export const EMAIL_QUEUE = "email-send";

export interface SendEmailJobData {
  recipientId: string;
}
