import { randomBytes } from "node:crypto";
import type { SenderIdentity } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getGmailForSender,
  markSenderNeedsReauth,
  ReauthRequiredError,
} from "@/lib/google";

export class GmailSendError extends Error {
  constructor(
    public kind: "AUTH" | "RATE_LIMIT" | "PERMANENT" | "TRANSIENT",
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GmailSendError";
  }
}

export interface MimeAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

/** Printable ASCII only -> safe to place in a header without encoding. */
function isAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/** RFC 2047 encode a header value when it contains non-ASCII characters. */
function encodeWord(value: string): string {
  if (isAscii(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Encode an address display-name phrase. An RFC 2047 encoded-word must appear
 * bare, while a plain ASCII phrase stays quoted.
 */
function encodeDisplayName(name: string): string {
  const clean = name.replace(/[\r\n"]/g, "");
  return isAscii(clean) ? `"${clean}"` : encodeWord(clean);
}

/** Percent-encode UTF-8 bytes using the RFC 2231 attribute-char set. */
function encodeRfc2231(value: string): string {
  return Array.from(Buffer.from(value, "utf8"))
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9!#$&+\-.^_`|~]/.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

/** Wrap a base64 string at 76 characters with CRLF line endings. */
function wrapBase64(b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return lines.join("\r\n");
}

/** Strip CR/LF and quote characters that could break MIME headers. */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "");
}

/** 7-bit fallback for the legacy filename/name parameters. */
function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, "_") || "attachment";
}

export function buildMimeMessage(opts: {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  replyTo?: string;
  messageId?: string;
  attachment?: MimeAttachment;
}): string {
  const { from, to, subject, textBody, replyTo, messageId, attachment } = opts;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeWord(subject)}`,
    `MIME-Version: 1.0`,
    `Date: ${new Date().toUTCString()}`,
  ];
  if (replyTo) {
    headers.push(`Reply-To: ${replyTo}`);
  }
  if (messageId) {
    headers.push(`Message-ID: ${messageId}`);
  }

  const bodyB64 = wrapBase64(Buffer.from(textBody, "utf8").toString("base64"));

  let lines: string[];
  if (attachment) {
    const boundary = `----=_Part_${randomBytes(12).toString("hex")}`;
    const filename = sanitizeFilename(attachment.filename);
    const asciiName = asciiFilename(filename);
    const dispositionParams = isAscii(filename)
      ? `filename="${asciiName}"`
      : `filename="${asciiName}"; filename*=UTF-8''${encodeRfc2231(filename)}`;
    const attachmentB64 = wrapBase64(attachment.data.toString("base64"));
    lines = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      "",
      bodyB64,
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${asciiName}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; ${dispositionParams}`,
      "",
      attachmentB64,
      `--${boundary}--`,
      "",
    ];
  } else {
    lines = [
      ...headers,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      "",
      bodyB64,
      "",
    ];
  }

  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

interface GoogleApiErrorDetail {
  reason?: string;
}

interface GoogleApiErrorShape {
  code?: number | string;
  status?: number | string;
  message?: string;
  /**
   * gaxios passes the parsed API error body as the Error `cause`, which is the
   * only place the `errors[].reason` details survive when the response body is
   * unavailable.
   */
  cause?: { errors?: GoogleApiErrorDetail[] };
  response?: {
    status?: number;
    headers?: unknown;
    data?: {
      error?: {
        status?: string;
        message?: string;
        errors?: GoogleApiErrorDetail[];
      };
    };
  };
  errors?: GoogleApiErrorDetail[];
}

function readRetryAfterMs(e: GoogleApiErrorShape): number | undefined {
  const headers = e.response?.headers;
  if (!headers) return undefined;

  let value: string | null | undefined;
  const maybeHeaders = headers as { get?: (name: string) => string | null };
  if (typeof maybeHeaders.get === "function") {
    value = maybeHeaders.get("retry-after");
  } else {
    const record = headers as Record<string, string | undefined>;
    value = record["retry-after"] ?? record["Retry-After"];
  }
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "quotaExceeded",
]);

/** Resolve the HTTP status from the several places gaxios may expose it. */
function readStatus(e: GoogleApiErrorShape): number | undefined {
  for (const candidate of [e.status, e.code, e.response?.status]) {
    if (typeof candidate === "number") return candidate;
    // `code` is a string for network errors ("ECONNRESET"), never a status.
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
      return Number(candidate);
    }
  }
  return undefined;
}

/** Collect the API error reasons from every shape gaxios may surface them in. */
function readReasons(e: GoogleApiErrorShape): string[] {
  const details = [
    ...(e.response?.data?.error?.errors ?? []),
    ...(e.cause?.errors ?? []),
    ...(e.errors ?? []),
  ];
  return details
    .map((detail) => detail?.reason)
    .filter((reason): reason is string => typeof reason === "string");
}

function mapGmailError(err: unknown): GmailSendError {
  const e = (err ?? {}) as GoogleApiErrorShape;
  const status = readStatus(e);
  const message =
    (typeof e.message === "string" && e.message) || "Gmail send failed";
  const isRateLimited =
    readReasons(e).some((reason) => RATE_LIMIT_REASONS.has(reason)) ||
    e.response?.data?.error?.status === "RESOURCE_EXHAUSTED";

  if (status === 401 || /invalid_grant/i.test(message)) {
    return new GmailSendError("AUTH", message);
  }
  if (status === 429 || (status === 403 && isRateLimited)) {
    return new GmailSendError("RATE_LIMIT", message, readRetryAfterMs(e));
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    return new GmailSendError("PERMANENT", message);
  }
  // 5xx or network error with no HTTP status.
  return new GmailSendError("TRANSIENT", message);
}

/**
 * Send a message as a specific connected sender. The sender's address is used
 * for both the From and Reply-To headers, and dispatch happens through that
 * sender's own OAuth token so DKIM/SPF/DMARC align with the visible From.
 */
export async function sendGmail(
  sender: SenderIdentity,
  opts: {
    to: string;
    subject: string;
    textBody: string;
    messageId?: string;
    attachment?: MimeAttachment;
  },
): Promise<{ gmailMessageId: string }> {
  if (!sender.email) {
    throw new GmailSendError("PERMANENT", "Sender has no email address");
  }

  let gmail;
  try {
    gmail = await getGmailForSender(sender);
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      throw new GmailSendError("AUTH", err.message);
    }
    throw err;
  }

  const from = sender.name
    ? `${encodeDisplayName(sender.name)} <${sender.email}>`
    : sender.email;

  const raw = buildMimeMessage({
    from,
    to: opts.to,
    subject: opts.subject,
    textBody: opts.textBody,
    replyTo: sender.email,
    messageId: opts.messageId,
    attachment: opts.attachment,
  });

  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    const gmailMessageId = res.data.id;
    if (!gmailMessageId) {
      throw new GmailSendError("TRANSIENT", "Gmail returned no message id");
    }
    // Best-effort: record which sender was last used (drives default selection).
    await prisma.senderIdentity
      .update({ where: { id: sender.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return { gmailMessageId };
  } catch (err) {
    const mapped =
      err instanceof GmailSendError
        ? err
        : err instanceof ReauthRequiredError
          ? new GmailSendError("AUTH", err.message)
          : mapGmailError(err);
    if (mapped.kind === "AUTH") {
      await markSenderNeedsReauth(sender.id).catch(() => {});
    }
    throw mapped;
  }
}

/**
 * Look up an already-sent message by its RFC 822 Message-ID so a retry can
 * detect a delivery whose response was lost. Never throws: a failed lookup is
 * reported as "not found" so the caller falls back to sending.
 */
export async function findSentMessageId(
  sender: SenderIdentity,
  rfc822MessageId: string,
): Promise<string | null> {
  try {
    const gmail = await getGmailForSender(sender);
    const res = await gmail.users.messages.list({
      userId: "me",
      q: `rfc822msgid:${rfc822MessageId}`,
    });
    return res.data.messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}
