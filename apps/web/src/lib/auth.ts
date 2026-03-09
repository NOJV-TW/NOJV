import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { prisma } from "@nojv/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!
    }
  },
  user: {
    additionalFields: {
      handle: { type: "string", unique: true, required: true },
      platformRole: { type: "string", defaultValue: "student" },
      locale: { type: "string", defaultValue: "zh-TW" }
    }
  },
  account: {
    accountLinking: { enabled: true }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (user.handle) {
            return { data: user };
          }

          const base = (user.name ?? user.email.split("@")[0]!)
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60);

          let candidate = base || "user";
          let suffix = 0;

          while (true) {
            const existing = await prisma.user.findUnique({
              where: { handle: candidate }
            });

            if (!existing) break;

            suffix++;
            candidate = `${base}-${String(suffix)}`;
          }

          return {
            data: { ...user, handle: candidate }
          };
        }
      }
    }
  }
});
