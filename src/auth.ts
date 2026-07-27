import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

export const GMAIL_SCOPES =
  "openid email profile https://www.googleapis.com/auth/gmail.send";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
          scope: GMAIL_SCOPES,
        },
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return;

      await prisma.account.update({
        where: {
          provider_providerAccountId: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        },
        data: {
          access_token: account.access_token ?? undefined,
          // Google only returns a refresh_token on the first consent (or with
          // prompt=consent). Never overwrite a stored one with null.
          ...(account.refresh_token
            ? { refresh_token: account.refresh_token }
            : {}),
          expires_at: account.expires_at ?? undefined,
          scope: account.scope ?? undefined,
        },
      });

      if (user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { needsReauth: false },
        });
      }
    },
  },
});
