import { auth as googleAuth } from "@googleapis/gmail";
import { env } from "@/lib/env";
import { GMAIL_SCOPES } from "@/auth";

export const SENDER_CONNECT_CALLBACK_PATH = "/api/senders/connect/callback";
export const SENDER_STATE_COOKIE = "sender_connect_state";

/** Absolute redirect URI Google calls back to. Must be registered as an
 * "Authorized redirect URI" on the OAuth client. */
export function senderRedirectUri(): string {
  return `${env.APP_URL.replace(/\/$/, "")}${SENDER_CONNECT_CALLBACK_PATH}`;
}

function senderOAuthClient() {
  return new googleAuth.OAuth2(
    env.AUTH_GOOGLE_ID,
    env.AUTH_GOOGLE_SECRET,
    senderRedirectUri(),
  );
}

export function buildConnectUrl(state: string): string {
  return senderOAuthClient().generateAuthUrl({
    // offline + consent guarantees a refresh_token, which we need to send later.
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES.split(" "),
    state,
    include_granted_scopes: true,
  });
}

export interface ConnectedProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface ExchangedTokens {
  refresh_token: string | null;
  access_token: string | null;
  expires_at: number | null;
  scope: string | null;
}

/** Exchange the authorization code for tokens and read the account's identity
 * from the returned id_token (verified against our client id). */
export async function exchangeCode(code: string): Promise<{
  tokens: ExchangedTokens;
  profile: ConnectedProfile;
}> {
  const client = senderOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new Error("Google did not return an id_token");
  }
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.AUTH_GOOGLE_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("Google profile is missing an id or email");
  }
  return {
    tokens: {
      refresh_token: tokens.refresh_token ?? null,
      access_token: tokens.access_token ?? null,
      expires_at: tokens.expiry_date
        ? Math.floor(tokens.expiry_date / 1000)
        : null,
      scope: tokens.scope ?? null,
    },
    profile: {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    },
  };
}
