import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";

import { prisma } from "@nojv/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? ""
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ""
    }
  },
  user: {
    additionalFields: {
      platformRole: { type: "string", defaultValue: "student" },
      locale: { type: "string", defaultValue: "zh-TW" }
    }
  },
  account: {
    accountLinking: { enabled: true }
  },
  plugins: [
    username({
      maxUsernameLength: 64,
      schema: {
        user: {
          fields: {
            displayUsername: "displayHandle",
            username: "handle"
          }
        }
      },
      usernameValidator: (candidate) => {
        return /^[a-z0-9._-]+$/.test(candidate);
      }
    }),
    nextCookies()
  ]
});
