import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { toSvelteKitHandler } from "better-auth/svelte-kit";
import { username } from "better-auth/plugins";

import { prisma } from "@nojv/db";

// --- Environment validation ---
if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required");
if (!process.env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is required");
if (!process.env.GITHUB_CLIENT_ID) throw new Error("GITHUB_CLIENT_ID is required");
if (!process.env.GITHUB_CLIENT_SECRET) throw new Error("GITHUB_CLIENT_SECRET is required");
if (!process.env.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID is required");
if (!process.env.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET is required");

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    }
  },
  user: {
    additionalFields: {
      disabled: { type: "boolean", defaultValue: false },
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
      usernameValidator: (candidate) => {
        return /^[a-z0-9._-]+$/.test(candidate);
      }
    })
  ]
});

export const handler = toSvelteKitHandler(auth);
