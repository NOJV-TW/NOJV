import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";

import { prisma } from "@nojv/db";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function createAuth() {
  return betterAuth({
    secret: requiredEnv("BETTER_AUTH_SECRET"),
    baseURL: requiredEnv("BETTER_AUTH_URL"),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true
    },
    socialProviders: {
      github: {
        clientId: requiredEnv("GITHUB_CLIENT_ID"),
        clientSecret: requiredEnv("GITHUB_CLIENT_SECRET")
      },
      google: {
        clientId: requiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET")
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
}

let _auth: ReturnType<typeof createAuth>;

export function getAuth() {
  if (!_auth) _auth = createAuth();
  return _auth;
}
