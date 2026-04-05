import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import bcrypt from "bcryptjs";

import { prismaAdapterClient as prisma } from "@nojv/db";
import { getWebEnv } from "$lib/server/env";

function buildSocialProviders(env: ReturnType<typeof getWebEnv>) {
  const githubId = env.GITHUB_CLIENT_ID;
  const githubSecret = env.GITHUB_CLIENT_SECRET;
  const googleId = env.GOOGLE_CLIENT_ID;
  const googleSecret = env.GOOGLE_CLIENT_SECRET;

  if ((githubId && !githubSecret) || (!githubId && githubSecret)) {
    throw new Error(
      "GitHub OAuth config is incomplete: set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"
    );
  }

  if ((googleId && !googleSecret) || (!googleId && googleSecret)) {
    throw new Error(
      "Google OAuth config is incomplete: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
    );
  }

  return {
    ...(githubId && githubSecret
      ? {
          github: {
            clientId: githubId,
            clientSecret: githubSecret
          }
        }
      : {}),
    ...(googleId && googleSecret
      ? {
          google: {
            clientId: googleId,
            clientSecret: googleSecret
          }
        }
      : {})
  };
}

function createAuth() {
  const env = getWebEnv();

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      // Seeded credential accounts store bcrypt hashes; configure auth to match.
      password: {
        hash: async (plain) => bcrypt.hash(plain, 10),
        verify: async ({ hash, password }) => bcrypt.compare(password, hash)
      }
    },
    socialProviders: buildSocialProviders(env),
    user: {
      additionalFields: {
        disabled: { type: "boolean", defaultValue: false, input: false },
        platformRole: { type: "string", defaultValue: "student", input: false },
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

let _auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  _auth ??= createAuth();
  return _auth;
}
