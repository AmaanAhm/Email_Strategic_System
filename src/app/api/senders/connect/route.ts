import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { buildConnectUrl, SENDER_STATE_COOKIE } from "@/lib/sender-oauth";

// Starts the "connect another Google account as a sender" flow. Unlike the
// Auth.js sign-in flow, this attaches the account to the CURRENT user instead
// of switching identity.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildConnectUrl(state));
  res.cookies.set(SENDER_STATE_COOKIE, state, {
    httpOnly: true,
    // Only mark secure when actually served over https, so the flow works on
    // http://localhost too (a secure cookie is dropped over plain http).
    secure: env.APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
