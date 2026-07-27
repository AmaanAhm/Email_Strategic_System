import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { exchangeCode, SENDER_STATE_COOKIE } from "@/lib/sender-oauth";

function backToSenders(
  req: NextRequest,
  params: Record<string, string>,
): NextResponse {
  const url = new URL("/senders", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(SENDER_STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const userId = session.user.id;

  const params = req.nextUrl.searchParams;
  const oauthError = params.get("error");
  if (oauthError) {
    return backToSenders(req, { connected: "error", reason: oauthError });
  }

  const code = params.get("code");
  const state = params.get("state");
  const cookieState = req.cookies.get(SENDER_STATE_COOKIE)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return backToSenders(req, { connected: "error", reason: "invalid_state" });
  }

  try {
    const { tokens, profile } = await exchangeCode(code);
    if (!tokens.refresh_token) {
      // Google only returns a refresh_token with prompt=consent on the first
      // grant; without one we could never send. Ask them to retry.
      return backToSenders(req, {
        connected: "error",
        reason: "no_refresh_token",
      });
    }

    // First sender for this user becomes the default.
    const existing = await prisma.senderIdentity.count({ where: { userId } });

    await prisma.senderIdentity.upsert({
      where: { userId_googleSub: { userId, googleSub: profile.sub } },
      create: {
        userId,
        email: profile.email,
        name: profile.name ?? null,
        image: profile.picture ?? null,
        googleSub: profile.sub,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope,
        isDefault: existing === 0,
        needsReauth: false,
      },
      update: {
        email: profile.email,
        name: profile.name ?? null,
        image: profile.picture ?? undefined,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        expires_at: tokens.expires_at,
        scope: tokens.scope,
        needsReauth: false,
      },
    });

    return backToSenders(req, { connected: "success", email: profile.email });
  } catch {
    return backToSenders(req, { connected: "error", reason: "exchange_failed" });
  }
}
