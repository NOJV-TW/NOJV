import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@nojv/db";

/** Extra fields added to session.user and JWT token by our auth callbacks. */
export interface NojvSessionExtras {
  handle?: string;
  platformRole?: string;
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  callbacks: {
    authorized({ auth: session }) {
      // Middleware matcher already scopes to /api/((?!auth|runtime).*),
      // so every request reaching here is a protected API route.
      if (!session?.user) {
        return Response.json({ message: "Authentication required." }, { status: 401 });
      }

      return true;
    },
    jwt({ token, user, trigger }) {
      if (trigger === "signIn" || trigger === "signUp") {
        const extra = user as NojvSessionExtras;
        token.handle = extra.handle;
        token.platformRole = extra.platformRole;
      }

      return token;
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }

      Object.assign(session.user, {
        handle: token.handle,
        platformRole: token.platformRole
      });

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
