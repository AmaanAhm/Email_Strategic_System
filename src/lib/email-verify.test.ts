import { describe, expect, it } from "vitest";
import {
  classifyRcptReply,
  correctTypo,
  domainOf,
  enhancedCodeOf,
  isCatchAllReply,
  isSenderBlockReply,
  isValidSyntax,
  normalizeEmail,
  screenOffline,
  REASON_LABELS,
  type ReasonCode,
  type SmtpReply,
} from "./email-verify";

/** Build a reply the way the prober does: code parsed off the front. */
const reply = (text: string): SmtpReply => ({
  code: Number.parseInt(text.slice(0, 3), 10),
  text,
});

// Replies captured from real servers while profiling the user's contact list.
const REAL = {
  spamhausBlock:
    "550 5.7.1 Service unavailable, Client host [192.0.2.66] blocked using Spamhaus. To request removal from this list see https://www.spamhaus.org/query/ip/192.0.2.66 - gsmtp",
  mimecastPbl:
    "550 zen.mimecast.org Listed by PBL, see https://check.spamhaus.org/query/ip/192.0.2.66",
  gmailNoSuchUser:
    "550-5.1.1 The email account that you tried to reach does not exist. Please try\r\n550-5.1.1 double-checking the recipient's email address for typos or\r\n550 5.1.1 unnecessary spaces.",
  googleAccept: "250 2.1.5 OK 5a478bee46e88-314bc44415fsi42372156eec.31 - gsmtp",
  mimecastDefer:
    "451 Internal resource temporarily unavailable - https://community.mimecast.com/docs/DOC-1369#451",
} as const;

describe("isValidSyntax", () => {
  it.each([
    "amaan@icubeswire.com",
    "first.last+tag@sub.example.co.uk",
    "a@b.io",
    "user_name-1@domain-with-dash.com",
  ])("accepts %s", (email) => {
    expect(isValidSyntax(email)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["plainstring", "no @"],
    ["no-domain@", "missing domain"],
    ["@no-local.com", "missing local part"],
    ["two@@at.com", "double @"],
    ["trailing.dot.@gmail.com", "local part ends in a dot"],
    ["double..dot@gmail.com", "consecutive dots"],
    ["no-tld@localhost", "no dot in domain"],
    ["spaces in@gmail.com", "whitespace"],
    ["a@b.c", "single-character TLD"],
  ])("rejects %s (%s)", (email) => {
    expect(isValidSyntax(email)).toBe(false);
  });

  it("rejects an over-length address", () => {
    expect(isValidSyntax(`${"a".repeat(250)}@gmail.com`)).toBe(false);
  });

  it("rejects a local part over 64 octets", () => {
    expect(isValidSyntax(`${"a".repeat(65)}@gmail.com`)).toBe(false);
  });
});

describe("normalizeEmail / domainOf", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Amaan@ICubesWire.COM ")).toBe("amaan@icubeswire.com");
  });

  it("takes the domain after the last @", () => {
    expect(domainOf("a@b@gmail.com")).toBe("gmail.com");
    expect(domainOf("no-at-sign")).toBe("");
  });
});

describe("correctTypo", () => {
  it("repairs a known misspelling and keeps the local part", () => {
    expect(correctTypo("rohitaffiliates@gmail.co")).toEqual({
      email: "rohitaffiliates@gmail.com",
      corrected: true,
    });
  });

  it("leaves an unknown domain alone", () => {
    expect(correctTypo("someone@icubeswire.com")).toEqual({
      email: "someone@icubeswire.com",
      corrected: false,
    });
  });

  it("does not mangle a local part containing an @-like sequence", () => {
    expect(correctTypo("a.b+c@gamil.com").email).toBe("a.b+c@gmail.com");
  });
});

describe("screenOffline", () => {
  it("passes a normal address through for probing", () => {
    expect(screenOffline("someone@icubeswire.com")).toBeNull();
  });

  it("rejects an empty address", () => {
    expect(screenOffline("")).toMatchObject({
      verdict: "UNDELIVERABLE",
      reason: "MISSING_EMAIL",
    });
  });

  it("rejects reserved placeholder domains without touching the network", () => {
    expect(screenOffline("john@example.com")).toMatchObject({
      verdict: "UNDELIVERABLE",
      reason: "PLACEHOLDER_DOMAIN",
    });
  });

  it("marks disposable providers risky rather than undeliverable", () => {
    // They do accept mail; they are simply worthless for outreach.
    expect(screenOffline("burner@mailinator.com")).toMatchObject({
      verdict: "RISKY",
      reason: "DISPOSABLE",
    });
  });

  it("rejects bad syntax", () => {
    expect(screenOffline("not-an-email")).toMatchObject({
      verdict: "UNDELIVERABLE",
      reason: "INVALID_SYNTAX",
    });
  });
});

describe("enhancedCodeOf", () => {
  it("reads the enhanced code from a single-line reply", () => {
    expect(enhancedCodeOf(reply("550 5.1.1 User unknown"))).toBe("5.1.1");
  });

  it("reads it from a multi-line reply", () => {
    expect(enhancedCodeOf(reply(REAL.gmailNoSuchUser))).toBe("5.1.1");
  });

  it("does not mistake an IP address in the reply body for an enhanced code", () => {
    // Regression: an unanchored /\d+\.\d+\.\d+/ pulls "192.0.2" out of the
    // Spamhaus URL and reports it as the status code.
    expect(enhancedCodeOf(reply(REAL.mimecastPbl))).toBeNull();
  });

  it("returns null when there is no enhanced code", () => {
    expect(enhancedCodeOf(reply("550 Requested action not taken"))).toBeNull();
  });
});

describe("isSenderBlockReply", () => {
  it.each([
    REAL.spamhausBlock,
    REAL.mimecastPbl,
    "554 5.7.1 Service unavailable; Client host [1.2.3.4] blocked using bl.spamcop.net",
    "550 Your IP has a poor reputation and is not allowed to send",
    "421 4.7.0 HELO rejected: invalid hostname",
  ])("recognises %s as a sender-side block", (text) => {
    expect(isSenderBlockReply(text)).toBe(true);
  });

  it.each([REAL.gmailNoSuchUser, REAL.googleAccept, "550 5.1.1 User unknown"])(
    "does not treat %s as a sender block",
    (text) => {
      expect(isSenderBlockReply(text)).toBe(false);
    },
  );
});

describe("classifyRcptReply", () => {
  const expectVerdict = (text: string, verdict: string, reason: ReasonCode) => {
    const result = classifyRcptReply(reply(text));
    expect(result.verdict).toBe(verdict);
    expect(result.reason).toBe(reason);
  };

  it("accepts a 250", () => {
    expectVerdict(REAL.googleAccept, "DELIVERABLE", "MAILBOX_EXISTS");
  });

  it("accepts a 251 (will forward)", () => {
    expectVerdict("251 User not local; will forward", "DELIVERABLE", "MAILBOX_EXISTS");
  });

  it("treats 252 as unconfirmed, never as proof", () => {
    // 252 literally means "I will not verify this for you".
    expectVerdict("252 Cannot VRFY user, but will accept message", "RISKY", "UNKNOWN_REPLY");
  });

  it("reads a real Gmail 5.1.1 as a missing mailbox", () => {
    expectVerdict(REAL.gmailNoSuchUser, "UNDELIVERABLE", "MAILBOX_NOT_FOUND");
  });

  it("reads Exchange Online's 5.4.1 phrasing as a missing mailbox", () => {
    expectVerdict(
      "550 5.4.1 Recipient address rejected: Access denied. [BM1PR01CA0123.INDPRD01.PROD.OUTLOOK.COM]",
      "UNDELIVERABLE",
      "MAILBOX_NOT_FOUND",
    );
  });

  it.each([
    "550 No such user here",
    "550 5.1.1 <bob@x.com>: Recipient address rejected: User unknown in virtual mailbox table",
    "550 Unrouteable address",
    "550 5.1.6 Recipient no longer with this organisation",
  ])("reads %s as a missing mailbox", (text) => {
    expect(classifyRcptReply(reply(text)).verdict).toBe("UNDELIVERABLE");
  });

  it("never reports a blocklisted IP as a missing mailbox", () => {
    // The critical case: this is about us, not about the recipient. Calling it
    // UNDELIVERABLE would delete a contact who is perfectly reachable.
    expectVerdict(REAL.spamhausBlock, "RISKY", "IP_BLOCKED");
    expectVerdict(REAL.mimecastPbl, "RISKY", "IP_BLOCKED");
  });

  it("marks a full mailbox risky, not dead", () => {
    expectVerdict("552 5.2.2 Mailbox full", "RISKY", "MAILBOX_FULL");
    expectVerdict("550 5.2.2 Over quota", "RISKY", "MAILBOX_FULL");
  });

  it("marks greylisting for retry", () => {
    const result = classifyRcptReply(reply(REAL.mimecastDefer));
    expect(result.verdict).toBe("RETRY");
    expect(result.reason).toBe("GREYLISTED");
  });

  it.each(["450 4.2.0 Try again later", "421 Service not available", "452 Too many recipients"])(
    "marks %s for retry",
    (text) => {
      expect(classifyRcptReply(reply(text)).verdict).toBe("RETRY");
    },
  );

  it("falls back to a policy block for an unexplained 5.7.x", () => {
    expectVerdict("550 5.7.25 Reverse DNS lookup failed", "RISKY", "POLICY_BLOCK");
  });

  it("falls back to risky for an unrecognised rejection", () => {
    expectVerdict("500 Syntax error, command unrecognised", "RISKY", "UNKNOWN_REPLY");
  });

  it("truncates a long reply into the detail field", () => {
    const result = classifyRcptReply(reply(`550 5.1.1 ${"x".repeat(600)}`));
    expect(result.detail!.length).toBeLessThanOrEqual(300);
  });

  it("keeps only the first line of a multi-line reply as detail", () => {
    expect(classifyRcptReply(reply(REAL.gmailNoSuchUser)).detail).not.toContain("\n");
  });
});

describe("isCatchAllReply", () => {
  it("treats acceptance of an impossible address as accept-all", () => {
    expect(isCatchAllReply(reply(REAL.googleAccept))).toBe(true);
  });

  it("does not treat a rejection as accept-all", () => {
    expect(isCatchAllReply(reply(REAL.gmailNoSuchUser))).toBe(false);
    expect(isCatchAllReply(reply(REAL.mimecastDefer))).toBe(false);
  });
});

describe("REASON_LABELS", () => {
  it("has a label for every reason code the classifier can emit", () => {
    const emitted: ReasonCode[] = [
      "MAILBOX_EXISTS", "INVALID_SYNTAX", "PLACEHOLDER_DOMAIN", "NO_MX_RECORD",
      "MAILBOX_NOT_FOUND", "DUPLICATE_ROW", "MISSING_EMAIL", "CATCH_ALL",
      "IP_BLOCKED", "GREYLISTED", "MAILBOX_FULL", "POLICY_BLOCK", "DISPOSABLE",
      "TIMEOUT", "CONNECTION_FAILED", "UNKNOWN_REPLY",
    ];
    for (const code of emitted) {
      expect(REASON_LABELS[code], code).toBeTruthy();
    }
  });
});
