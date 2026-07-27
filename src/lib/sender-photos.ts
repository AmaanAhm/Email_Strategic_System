import { auth as googleAuth } from "@googleapis/gmail";
import type { SenderIdentity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/** Fetch a sender's Google profile photo URL using its stored refresh token. */
async function fetchGooglePicture(sender: SenderIdentity): Promise<string | null> {
  if (!sender.refresh_token) return null;

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
    const data: { access_token?: string; expires_at?: number } = {};
    if (tokens.access_token) data.access_token = tokens.access_token;
    if (tokens.expiry_date) data.expires_at = Math.floor(tokens.expiry_date / 1000);
    if (Object.keys(data).length === 0) return;
    prisma.senderIdentity
      .update({ where: { id: sender.id }, data })
      .catch(() => {});
  });

  const { token } = await oauth2.getAccessToken();
  if (!token) return null;

  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { picture?: string };
  return data.picture ?? null;
}

/**
 * Best-effort backfill of missing sender photos. Only touches senders that have
 * no image yet; each Google fetch is isolated so one failure never blocks the
 * others. Safe to call on page load — it no-ops once every sender has a photo.
 */
export async function backfillSenderImages(userId: string): Promise<void> {
  const missing = await prisma.senderIdentity.findMany({
    where: { userId, image: null, needsReauth: false },
  });
  if (missing.length === 0) return;

  await Promise.allSettled(
    missing.map(async (s) => {
      try {
        const picture = await fetchGooglePicture(s);
        if (picture) {
          await prisma.senderIdentity.update({
            where: { id: s.id },
            data: { image: picture },
          });
        }
      } catch {
        // Best-effort: leave the avatar as initials and retry on a later load.
      }
    }),
  );
}
