import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@nojv/db";

export const { auth, handlers, signIn, signOut } = NextAuth({
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as { handle?: string; platformRole?: string };
        token.handle = u.handle;
        token.platformRole = u.platformRole;
      }

      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = session.user as any;
      u.handle = token.handle;
      u.platformRole = token.platformRole;

      return session;
    }
  },
  pages: {
    signIn: "/auth/signin"
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const email = credentials.email as string | undefined;
        const password = credentials.password as string | undefined;

        if (!email || !password) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user?.passwordHash) {
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);

        if (!valid) {
          return null;
        }

        return {
          email: user.email,
          handle: user.handle,
          id: user.id,
          name: user.displayName,
          platformRole: user.platformRole
        };
      }
    })
  ],
  session: {
    strategy: "jwt"
  }
});
