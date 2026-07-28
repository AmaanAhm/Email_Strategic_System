/**
 * SMTP mailbox probing.
 *
 * Speaks just enough SMTP to ask "would you accept mail for this address?" and
 * hangs up. `DATA` is never sent, so no message is ever delivered.
 *
 * Two things this gets right that a naive prober does not:
 *
 *   1. Replies are read as replies, not as packets. SMTP replies are
 *      multi-line (`250-` continuations, final line `250 `) and TCP is free to
 *      split or merge them. Counting `data` events desynchronises the moment a
 *      server sends a two-packet banner.
 *   2. A domain is asked about an address that cannot exist before it is asked
 *      about real ones. A server that accepts the impossible address accepts
 *      everything, and its "yes" about a real address means nothing.
 */

import net from "node:net";
import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  classifyRcptReply,
  isCatchAllReply,
  type Classification,
  type SmtpReply,
} from "@/lib/email-verify";
import { env } from "@/lib/env";

const CONNECT_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 12_000;
/** Servers start dropping connections after a few rejected recipients. */
const MAX_RCPT_PER_SESSION = 5;
/** Greylisting is a deliberate soft-fail; one patient retry resolves most. */
const GREYLIST_RETRY_DELAY_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class SmtpError extends Error {
  constructor(
    message: string,
    readonly kind: "TIMEOUT" | "CONNECTION_FAILED",
  ) {
    super(message);
  }
}

/**
 * One SMTP conversation. `command()` resolves with the server's complete
 * reply, so callers never see partial or merged frames.
 */
class SmtpSession {
  private socket: net.Socket | null = null;
  private buffer = "";
  private pending: {
    resolve: (reply: SmtpReply) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private closedError: Error | null = null;

  async connect(host: string): Promise<SmtpReply> {
    return new Promise<SmtpReply>((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;
      socket.setEncoding("utf-8");

      const timer = setTimeout(() => {
        this.fail(new SmtpError(`connect timeout to ${host}`, "TIMEOUT"));
      }, CONNECT_TIMEOUT_MS);

      // The banner is just the first reply, so it uses the same machinery.
      this.pending = { resolve, reject, timer };

      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.on("error", (err) =>
        this.fail(new SmtpError(err.message, "CONNECTION_FAILED")),
      );
      socket.on("close", () =>
        this.fail(new SmtpError("connection closed by server", "CONNECTION_FAILED")),
      );
      socket.connect(25, host);
    });
  }

  async command(line: string): Promise<SmtpReply> {
    if (this.closedError) throw this.closedError;
    const socket = this.socket;
    if (!socket) throw new SmtpError("not connected", "CONNECTION_FAILED");

    return new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new SmtpError(`timeout waiting for reply to ${line.split(" ")[0]}`, "TIMEOUT"));
      }, COMMAND_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      socket.write(`${line}\r\n`);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // A reply is complete when its last line is "NNN " — a space, not a
    // hyphen. A hyphen marks a continuation and more is coming.
    const lines = this.buffer.split(/\r?\n/).filter((l) => l.length > 0);
    const last = lines[lines.length - 1];
    if (!last || !/^\d{3}(?: |$)/.test(last)) return;

    const text = this.buffer.trim();
    this.buffer = "";
    const code = Number.parseInt(text.slice(0, 3), 10);
    this.settle({ code: Number.isNaN(code) ? 0 : code, text });
  }

  private settle(reply: SmtpReply): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(reply);
  }

  private fail(err: Error): void {
    // Remember the cause so a later command reports it rather than hanging.
    this.closedError ??= err;
    const pending = this.pending;
    if (pending) {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.destroy();
  }

  destroy(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
  }

  /** Best-effort QUIT; a server that has already gone is not an error. */
  async quit(): Promise<void> {
    try {
      if (this.socket && !this.closedError) await this.command("QUIT");
    } catch {
      // ignore
    } finally {
      this.destroy();
    }
  }
}

// ─── MX ──────────────────────────────────────────────────────────────────────

const mxCache = new Map<string, string[]>();

/** MX hosts for a domain, best priority first. Empty means it takes no mail. */
export async function resolveMxHosts(domain: string): Promise<string[]> {
  const cached = mxCache.get(domain);
  if (cached) return cached;

  let hosts: string[] = [];
  try {
    const records = await dns.resolveMx(domain);
    hosts = records
      .filter((r) => r.exchange && r.exchange !== ".")
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);
  } catch {
    hosts = [];
  }
  mxCache.set(domain, hosts);
  return hosts;
}

/** Test seam — the cache is process-wide and would otherwise leak across runs. */
export function clearMxCache(): void {
  mxCache.clear();
}

// ─── Probing ─────────────────────────────────────────────────────────────────

export interface DomainProbeResult {
  /** Verdict per address, keyed by the address as passed in. */
  results: Map<string, Classification>;
  /** True when the domain accepted an address that cannot exist. */
  catchAll: boolean;
}

function heloDomain(): string {
  try {
    return new URL(env.APP_URL).hostname || "localhost";
  } catch {
    return "localhost";
  }
}

function mailFrom(): string {
  return process.env.VERIFY_MAIL_FROM ?? `postmaster@${heloDomain()}`;
}

/** An address that cannot plausibly exist on the domain. */
function impossibleAddress(domain: string): string {
  return `no-such-user-${randomBytes(6).toString("hex")}@${domain}`;
}

function classificationFor(err: unknown): Classification {
  if (err instanceof SmtpError && err.kind === "TIMEOUT") {
    return { verdict: "RISKY", reason: "TIMEOUT", detail: err.message };
  }
  return {
    verdict: "RISKY",
    reason: "CONNECTION_FAILED",
    detail: err instanceof Error ? err.message.slice(0, 300) : "Could not reach the mail server",
  };
}

/**
 * Probes every address on one domain.
 *
 * All addresses for a domain go through here together so the domain is
 * resolved once, the catch-all question is asked once, and the server sees one
 * orderly conversation instead of N parallel connections.
 */
export async function probeDomain(
  domain: string,
  emails: string[],
): Promise<DomainProbeResult> {
  const results = new Map<string, Classification>();

  const hosts = await resolveMxHosts(domain);
  if (hosts.length === 0) {
    for (const email of emails) {
      results.set(email, {
        verdict: "UNDELIVERABLE",
        reason: "NO_MX_RECORD",
        detail: `${domain} has no MX record`,
      });
    }
    return { results, catchAll: false };
  }

  // Try each MX in priority order; a dead primary must not condemn the domain.
  let lastError: unknown = null;
  for (const host of hosts) {
    try {
      return await probeViaHost(host, domain, emails);
    } catch (err) {
      lastError = err;
    }
  }

  const fallback = classificationFor(lastError);
  for (const email of emails) results.set(email, { ...fallback });
  return { results, catchAll: false };
}

async function probeViaHost(
  host: string,
  domain: string,
  emails: string[],
): Promise<DomainProbeResult> {
  const results = new Map<string, Classification>();
  const session = new SmtpSession();

  let catchAll = false;
  try {
    await openSession(session, host);

    // Ask the impossible question first. If the domain says yes to an address
    // that cannot exist, nothing it says about a real one is informative.
    const probeReply = await rcpt(session, impossibleAddress(domain));
    if (isCatchAllReply(probeReply)) {
      catchAll = true;
      for (const email of emails) {
        results.set(email, {
          verdict: "RISKY",
          reason: "CATCH_ALL",
          detail: `${domain} accepts mail for any address, so this mailbox cannot be confirmed`,
        });
      }
      await session.quit();
      return { results, catchAll };
    }
  } catch (err) {
    session.destroy();
    throw err;
  }

  // Not a catch-all: ask about each real address, reconnecting periodically so
  // a server's per-session bad-recipient limit does not poison later answers.
  let current = session;
  let sinceConnect = 1; // the catch-all probe counts
  try {
    for (const email of emails) {
      if (sinceConnect >= MAX_RCPT_PER_SESSION) {
        await current.quit();
        current = new SmtpSession();
        await openSession(current, host);
        sinceConnect = 0;
      }

      let outcome = classifyRcptReply(await rcpt(current, email));
      if (outcome.verdict === "RETRY") {
        // Greylisting: the same address on a fresh connection after a pause is
        // the standard way to get a real answer.
        await sleep(GREYLIST_RETRY_DELAY_MS);
        await current.quit();
        current = new SmtpSession();
        await openSession(current, host);
        sinceConnect = 0;
        outcome = classifyRcptReply(await rcpt(current, email));
      }

      results.set(
        email,
        outcome.verdict === "RETRY"
          ? { verdict: "RISKY", reason: "GREYLISTED", detail: outcome.detail }
          : outcome,
      );
      sinceConnect++;
    }
  } catch (err) {
    // Whatever was already answered stands; the rest inherit the failure.
    const fallback = classificationFor(err);
    for (const email of emails) {
      if (!results.has(email)) results.set(email, { ...fallback });
    }
  } finally {
    await current.quit();
  }

  return { results, catchAll };
}

async function openSession(session: SmtpSession, host: string): Promise<void> {
  const banner = await session.connect(host);
  if (banner.code !== 220) {
    throw new SmtpError(`unexpected banner: ${banner.text.slice(0, 120)}`, "CONNECTION_FAILED");
  }

  const helo = heloDomain();
  const ehlo = await session.command(`EHLO ${helo}`);
  if (ehlo.code !== 250) {
    // Pre-ESMTP servers and some appliances only understand HELO.
    const fallback = await session.command(`HELO ${helo}`);
    if (fallback.code !== 250) {
      throw new SmtpError(`HELO rejected: ${fallback.text.slice(0, 120)}`, "CONNECTION_FAILED");
    }
  }

  const from = await session.command(`MAIL FROM:<${mailFrom()}>`);
  if (from.code !== 250) {
    throw new SmtpError(`MAIL FROM rejected: ${from.text.slice(0, 120)}`, "CONNECTION_FAILED");
  }
}

/**
 * One RCPT TO, resetting the transaction afterwards so the next address starts
 * clean. Servers differ on whether they allow a second RCPT after a rejection.
 */
async function rcpt(session: SmtpSession, email: string): Promise<SmtpReply> {
  const reply = await session.command(`RCPT TO:<${email}>`);
  if (reply.code !== 250 && reply.code !== 251) {
    try {
      await session.command("RSET");
      await session.command(`MAIL FROM:<${mailFrom()}>`);
    } catch {
      // Server hung up; the caller reconnects.
    }
  }
  return reply;
}
