import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import bcrypt from "bcryptjs";

import { prismaAdapterClient as prisma, userRepo } from "@nojv/db";
import { getWebEnv } from "$lib/server/env";
import { extractStudentId, parseSchoolEmail } from "$lib/utils/school";
import { createLogger } from "$lib/server/logger";

const authLogger = createLogger("auth-hooks");

async function mergePlaceholderIfAny(newUser: { id: string; email: string }): Promise<void> {
  const parsed = parseSchoolEmail(newUser.email);
  if (!parsed) return;

  const handle = extractStudentId(parsed.school, parsed.studentId);
  const placeholder = await userRepo.findByUsername(handle);
  if (!placeholder) return;
  if (placeholder.id === newUser.id) return;
  if (placeholder.status !== "pending_first_login") return;

  try {
    await userRepo.attachPlaceholderToAuth(placeholder.id, newUser.id);
    await userRepo.update(newUser.id, {
      username: handle,
      displayUsername: handle,
    });
    authLogger.info("Merged placeholder user into OAuth signup", {
      placeholderId: placeholder.id,
      userId: newUser.id,
      handle,
    });
  } catch (err) {
    authLogger.error("Placeholder merge failed", {
      placeholderId: placeholder.id,
      userId: newUser.id,
      handle,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function buildSocialProviders(env: ReturnType<typeof getWebEnv>) {
  const githubId = env.GITHUB_CLIENT_ID;
  const githubSecret = env.GITHUB_CLIENT_SECRET;
  const googleId = env.GOOGLE_CLIENT_ID;
  const googleSecret = env.GOOGLE_CLIENT_SECRET;

  if ((githubId && !githubSecret) || (!githubId && githubSecret)) {
    throw new Error(
      "GitHub OAuth config is incomplete: set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET",
    );
  }

  if ((googleId && !googleSecret) || (!googleId && googleSecret)) {
    throw new Error(
      "Google OAuth config is incomplete: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    );
  }

  return {
    ...(githubId && githubSecret
      ? {
          github: {
            clientId: githubId,
            clientSecret: githubSecret,
          },
        }
      : {}),
    ...(googleId && googleSecret
      ? {
          google: {
            clientId: googleId,
            clientSecret: googleSecret,
          },
        }
      : {}),
  };
}

function createAuth() {
  const env = getWebEnv();
  const isProduction = env.NODE_ENV === "production";

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
      },
    },
    emailAndPassword: {
      enabled: true,
      password: {
        hash: async (plain) => bcrypt.hash(plain, 10),
        verify: async ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },
    socialProviders: buildSocialProviders(env),
    user: {
      additionalFields: {
        disabled: { type: "boolean", defaultValue: false, input: false },
        platformRole: { type: "string", defaultValue: "student", input: false },
        status: { type: "string", defaultValue: "active", input: false },
      },
    },
    account: {
      accountLinking: { enabled: true },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (user.id && typeof user.email === "string") {
              await mergePlaceholderIfAny({ id: user.id, email: user.email });
            }
          },
        },
      },
    },
    plugins: [
      username({
        maxUsernameLength: 64,
        usernameValidator: (candidate) => {
          return /^[a-z0-9._-]+$/.test(candidate);
        },
      }),
    ],
  });
}

let _auth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  _auth ??= createAuth();
  return _auth;
}
