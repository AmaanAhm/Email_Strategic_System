import { auth as googleAuth, gmail, type gmail_v1 } from "@googleapis/gmail";
import type { SenderIdentity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export class ReauthRequiredError extends Error {
  constructor(
    message = "Google re-authentication required",
    public senderId?: string,
  ) {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export async function markSenderNeedsReauth(senderId: string): Promise<void> {
  await prisma.senderIdentity.update({
    where: { id: senderId },
    data: { needsReauth: true },
  });
}

/**
 * Build a Gmail client authenticated as a specific sending identity. Refreshed
 * access tokens are persisted back to that sender row; a missing refresh token
 * raises ReauthRequiredError so the caller can surface a reconnect prompt.
 */
export async function getGmailForSender(
  sender: Pick<
    SenderIdentity,
    "id" | "refresh_token" | "access_token" | "expires_at"
  >,
): Promise<gmail_v1.Gmail> {
  if (!sender.refresh_token) {
    await markSenderNeedsReauth(sender.id);
    throw new ReauthRequiredError(
      "Sender is not connected to Google",
      sender.id,
    );
  }

  const oauth2 = new googleAuth.OAuth2(
    env.AUTH_GOOGLE_ID,
    env.AUTH_GOOGLE_SECRET,
  );

  oauth2.setCredentials({
    access_token: sender.access_token ?? undefined,
    refresh_token: sender.refresh_token,
    expiry_date: sender.expires_at ? sender.expires_at * 1000 : undefined,
  });

  oauth2.on("tokens", (tokens) => {
    const data: {
      access_token?: string;
      expires_at?: number;
      refresh_token?: string;
    } = {};
    if (tokens.access_token) data.access_token = tokens.access_token;
    if (tokens.expiry_date) {
      data.expires_at = Math.floor(tokens.expiry_date / 1000);
    }
    if (tokens.refresh_token) data.refresh_token = tokens.refresh_token;
    if (Object.keys(data).length === 0) return;

    // Fire-and-forget persistence of refreshed tokens.
    prisma.senderIdentity
      .update({ where: { id: sender.id }, data })
      .catch((err: unknown) => {
        console.error("Failed to persist refreshed sender tokens", err);
      });
  });

  return gmail({ version: "v1", auth: oauth2 });
}
