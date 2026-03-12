import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { toSvelteKitHandler } from "better-auth/svelte-kit";
import { username } from "better-auth/plugins";

import { prisma } from "@nojv/db";

// --- Environment warnings ---
if (!process.env.BETTER_AUTH_SECRET) {
  console.warn("[auth] BETTER_AUTH_SECRET is not set — using insecure default. Set this in production!");
}

if (process.env.GITHUB_CLIENT_ID && !process.env.GITHUB_CLIENT_SECRET) {
  console.warn("[auth] GITHUB_CLIENT_ID is set but GITHUB_CLIENT_SECRET is missing");
}

if (process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn("[auth] GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is missing");
}

const githubProvider = process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
  ? { github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET } }
  : {};

const googleProvider = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
  : {};

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-in-production",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    ...githubProvider,
    ...googleProvider
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
    })
  ]
});

export const handler = toSvelteKitHandler(auth);
