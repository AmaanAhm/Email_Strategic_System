/**
 * Deliverability classification — pure functions, no network, no I/O.
 *
 * Everything here is a decision about text: is this address well-formed, is
 * this domain worth probing, and what does an SMTP server's reply actually
 * mean. The socket work lives in `smtp-probe.ts`; keeping the judgement here
 * is what makes it testable without a mail server.
 *
 * The governing rule of this whole feature: an address is only DELIVERABLE
 * when a mail server affirmatively accepted it. Every ambiguous answer —
 * catch-all, greylisting, our own IP being blocked, a timeout — is RISKY, not
 * a rejection. Marking a real person undeliverable costs a customer; marking
 * them risky costs nothing but a second look.
 */

/** The three buckets a row can land in. `RETRY` never escapes the prober. */
export type Verdict = "DELIVERABLE" | "UNDELIVERABLE" | "RISKY";

export interface Classification {
  verdict: Verdict;
  /** Stable machine code, shown in the UI and used for grouping. */
  reason: ReasonCode;
  /** The raw SMTP reply or DNS error that produced this verdict. */
  detail?: string;
}

export type ReasonCode =
  // DELIVERABLE
  | "MAILBOX_EXISTS"
  // UNDELIVERABLE
  | "INVALID_SYNTAX"
  | "PLACEHOLDER_DOMAIN"
  | "NO_MX_RECORD"
  | "MAILBOX_NOT_FOUND"
  | "DUPLICATE_ROW"
  | "MISSING_EMAIL"
  // RISKY
  | "CATCH_ALL"
  | "IP_BLOCKED"
  | "GREYLISTED"
  | "MAILBOX_FULL"
  | "POLICY_BLOCK"
  | "DISPOSABLE"
  | "TIMEOUT"
  | "CONNECTION_FAILED"
  | "UNKNOWN_REPLY";

/** Internal: a greylist reply the prober should retry before giving up. */
export type ProbeOutcome = Classification | { verdict: "RETRY"; reason: "GREYLISTED"; detail?: string };

// ─── Domain policy ───────────────────────────────────────────────────────────

/**
 * RFC 2606 / RFC 6761 reserved names plus the usual spreadsheet filler. These
 * can never receive mail, so they are rejected without touching the network.
 */
export const PLACEHOLDER_DOMAINS: ReadonlySet<string> = new Set([
  "example.com", "example.org", "example.net", "example.edu",
  "test.com", "test.org", "test.net", "test",
  "invalid", "localhost", "local", "localdomain",
  "domain.com", "email.com", "yourdomain.com", "mydomain.com",
  "placeholder.com", "noemail.com", "none.com", "na.com",
  "fake.com", "temp.com", "sample.com", "company.com",
]);

/**
 * Throwaway-inbox providers. These usually *do* accept mail, so they are not
 * undeliverable — they are just worthless to an outreach campaign, which is
 * why they land in RISKY rather than being silently dropped.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com",
  "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org",
  "throwawaymail.com", "yopmail.com", "yopmail.fr", "getnada.com",
  "trashmail.com", "trashmail.net", "dispostable.com", "maildrop.cc",
  "fakeinbox.com", "mailnesia.com", "mytemp.email", "spamgourmet.com",
  "mohmal.com", "emailondeck.com", "burnermail.io", "tempr.email",
  "moakt.com", "luxusmail.org", "inboxbear.com", "harakirimail.com",
]);

/** Misspelled consumer providers, corrected before the address is probed. */
export const TYPO_MAP: Readonly<Record<string, string>> = {
  "gamil.com": "gmail.com", "gmial.com": "gmail.com", "gmal.com": "gmail.com",
  "gmaill.com": "gmail.com", "gmali.com": "gmail.com", "gnail.com": "gmail.com",
  "gmai.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
  "gmail.om": "gmail.com", "gmaol.com": "gmail.com", "gmail.cm": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com", "yhaoo.com": "yahoo.com", "yahoo.cm": "yahoo.com",
  "hotmai.com": "hotmail.com", "hotmal.com": "hotmail.com",
  "hotmial.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com", "outlok.com": "outlook.com",
  "outloo.com": "outlook.com", "outlook.co": "outlook.com",
  "iclod.com": "icloud.com", "icloud.co": "icloud.com",
  "rediffmail.co": "rediffmail.com", "protonmai.com": "protonmail.com",
};

// ─── Syntax ──────────────────────────────────────────────────────────────────

/**
 * Deliberately stricter than RFC 5321 (which permits quoted local parts and
 * IP-literal domains). Those are legal but effectively never appear in a
 * contact sheet, and accepting them would mean probing addresses no campaign
 * can send to anyway.
 */
const SYNTAX_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

export function isValidSyntax(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  // RFC 5321 §4.5.3.1: local part <= 64 octets, each label <= 63.
  if (at > 64) return false;
  if (email.includes("..")) return false;
  // A dot may separate atoms but may not lead or trail the local part. The
  // character class in SYNTAX_RE cannot express this on its own.
  const local = email.slice(0, at);
  if (local.startsWith(".") || local.endsWith(".")) return false;
  return SYNTAX_RE.test(email);
}

/** Lowercases and trims. Does not alter the local part beyond case. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1);
}

/**
 * Applies a known-typo correction. Returns the input unchanged when the
 * domain is not a recognized misspelling.
 */
export function correctTypo(email: string): { email: string; corrected: boolean } {
  const domain = domainOf(email);
  const fixed = TYPO_MAP[domain];
  if (!fixed) return { email, corrected: false };
  return { email: `${email.slice(0, email.lastIndexOf("@"))}@${fixed}`, corrected: true };
}

/**
 * The checks that need no network. Returns null when the address survives and
 * must actually be probed.
 */
export function screenOffline(email: string): Classification | null {
  if (!email) {
    return { verdict: "UNDELIVERABLE", reason: "MISSING_EMAIL", detail: "No email address in this row" };
  }
  if (!isValidSyntax(email)) {
    return { verdict: "UNDELIVERABLE", reason: "INVALID_SYNTAX", detail: "Not a valid email address" };
  }
  const domain = domainOf(email);
  if (PLACEHOLDER_DOMAINS.has(domain)) {
    return { verdict: "UNDELIVERABLE", reason: "PLACEHOLDER_DOMAIN", detail: `${domain} is a reserved placeholder domain` };
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { verdict: "RISKY", reason: "DISPOSABLE", detail: `${domain} is a throwaway inbox provider` };
  }
  return null;
}

// ─── SMTP reply interpretation ───────────────────────────────────────────────

export interface SmtpReply {
  /** The three-digit basic code. */
  code: number;
  /** The full reply, including any continuation lines. */
  text: string;
}

/**
 * Pulls the RFC 3463 enhanced status code (e.g. "5.1.1") out of a reply.
 *
 * Anchored to the start on purpose. An unanchored `\d+\.\d+\.\d+` search
 * happily matches an IP address out of a URL in the reply body — a real bug
 * that made "550 ... see https://check.spamhaus.org/query/ip/192.0.2.66"
 * report an enhanced code of "192.0.2".
 */
export function enhancedCodeOf(reply: SmtpReply): string | null {
  const match = reply.text.match(/^\s*[245]\d{2}[ -]+([245]\.\d{1,3}\.\d{1,3})\b/);
  return match ? match[1] : null;
}

/**
 * True when a rejection is about *us* — our IP, our HELO, our reputation —
 * rather than about the recipient.
 *
 * This distinction is the single most important one in the file. A server
 * that refuses to talk to a blocklisted IP says nothing whatsoever about
 * whether the mailbox exists, and treating that as "undeliverable" would
 * quietly delete good contacts. Checked before any 5xx handling.
 */
export function isSenderBlockReply(text: string): boolean {
  return /\b(spamhaus|spamcop|barracuda|sorbs|dnsbl|rbl|blocklist|blacklist|pbl|sbl|xbl|css\.spamhaus)\b/i.test(text)
    || /\b(?:listed|blocked|banned|denied)\b[^.]{0,60}\b(?:by|using|in|at)\b/i.test(text)
    || /client host .{0,40}blocked/i.test(text)
    || /\b(?:bad|poor|low) reputation\b/i.test(text)
    || /not allowed to (?:send|connect|relay)/i.test(text)
    || /\bhelo\b.{0,30}\b(?:reject|invalid|not accepted)/i.test(text);
}

const MAILBOX_MISSING_RE =
  /(user unknown|no such user|does not exist|doesn't exist|unknown recipient|recipient not found|invalid recipient|recipient rejected|address rejected|unrouteable address|unroutable address|no mailbox|mailbox not found|user not found|account (?:has been )?(?:disabled|closed|terminated)|no longer (?:valid|active|with))/i;

const MAILBOX_FULL_RE = /(mailbox full|quota exceeded|over quota|insufficient (?:system )?storage|mailbox is full)/i;

/**
 * Turns a server's reply to `RCPT TO` into a verdict.
 *
 * Order matters and is not arbitrary:
 *   1. sender-side blocks first, so an IP block is never read as a missing
 *      mailbox;
 *   2. success codes;
 *   3. 4xx as retryable, since greylisting is a deliberate soft-fail;
 *   4. only then are 5xx replies inspected for what they say about the user.
 */
export function classifyRcptReply(reply: SmtpReply): ProbeOutcome {
  const { code, text } = reply;
  const enhanced = enhancedCodeOf(reply);

  if (isSenderBlockReply(text)) {
    return { verdict: "RISKY", reason: "IP_BLOCKED", detail: firstLine(text) };
  }

  // 252 is "cannot VRFY, but will accept and attempt delivery" — an explicit
  // refusal to confirm, so it must not count as proof the mailbox exists.
  if (code === 252) {
    return { verdict: "RISKY", reason: "UNKNOWN_REPLY", detail: firstLine(text) };
  }
  if (code === 250 || code === 251) {
    return { verdict: "DELIVERABLE", reason: "MAILBOX_EXISTS", detail: firstLine(text) };
  }

  if (code >= 400 && code < 500) {
    return { verdict: "RETRY", reason: "GREYLISTED", detail: firstLine(text) };
  }

  if (code >= 500) {
    if (MAILBOX_FULL_RE.test(text) || enhanced === "5.2.2") {
      return { verdict: "RISKY", reason: "MAILBOX_FULL", detail: firstLine(text) };
    }
    // Exchange Online answers an unknown recipient with 5.4.1 + "Recipient
    // address rejected", which is why the text check runs alongside the codes.
    const missingByCode = enhanced === "5.1.1" || enhanced === "5.1.0" || enhanced === "5.1.6";
    if (missingByCode || MAILBOX_MISSING_RE.test(text)) {
      return { verdict: "UNDELIVERABLE", reason: "MAILBOX_NOT_FOUND", detail: firstLine(text) };
    }
    if (enhanced?.startsWith("5.7.")) {
      return { verdict: "RISKY", reason: "POLICY_BLOCK", detail: firstLine(text) };
    }
    return { verdict: "RISKY", reason: "UNKNOWN_REPLY", detail: firstLine(text) };
  }

  return { verdict: "RISKY", reason: "UNKNOWN_REPLY", detail: firstLine(text) };
}

/**
 * Whether a domain that accepted an address which cannot exist should be
 * treated as accept-all. Such a domain can never confirm an individual
 * mailbox, so every address on it is RISKY.
 */
export function isCatchAllReply(reply: SmtpReply): boolean {
  return reply.code === 250 || reply.code === 251;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0].trim().slice(0, 300);
}

// ─── Presentation ────────────────────────────────────────────────────────────

/** Short human phrase for each reason, shown in the results table. */
export const REASON_LABELS: Readonly<Record<ReasonCode, string>> = {
  MAILBOX_EXISTS: "Mailbox accepts mail",
  INVALID_SYNTAX: "Not a valid email address",
  PLACEHOLDER_DOMAIN: "Placeholder domain",
  NO_MX_RECORD: "Domain cannot receive mail",
  MAILBOX_NOT_FOUND: "Mailbox does not exist",
  DUPLICATE_ROW: "Duplicate of an earlier row",
  MISSING_EMAIL: "No email address",
  CATCH_ALL: "Domain accepts every address",
  IP_BLOCKED: "Our IP was blocked, mailbox unknown",
  GREYLISTED: "Server deferred the check",
  MAILBOX_FULL: "Mailbox is full",
  POLICY_BLOCK: "Server refused on policy",
  DISPOSABLE: "Throwaway inbox provider",
  TIMEOUT: "Server did not respond",
  CONNECTION_FAILED: "Could not reach mail server",
  UNKNOWN_REPLY: "Unclear server response",
};
