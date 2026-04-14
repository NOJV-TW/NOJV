import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import bcrypt from "bcryptjs";

import { prismaAdapterClient as prisma, userRepo } from "@nojv/db";
import { getWebEnv } from "$lib/server/env";
import { extractStudentId, parseSchoolEmail } from "$lib/school";
import { createLogger } from "$lib/server/logger";

const authLogger = createLogger("auth-hooks");

/**
 * On first OAuth login, check whether the user's email resolves to a
 * known school student id (spec §5.3) and, if so, merge any matching
 * placeholder User row into the row better-auth just created. The
 * placeholder was created earlier by a teacher pasting the handle in
 * the course members page; after merging, the placeholder's course
 * memberships carry over to the real user.
 *
 * better-auth exposes `databaseHooks.user.create.before|after`; the
 * `before` variant cannot redirect a create into an update (returning
 * `false` aborts the OAuth flow with no way to substitute an existing
 * row), so reconciliation runs in `after`: better-auth creates the
 * real user normally, then we transfer memberships from the
 * placeholder and delete it.
 */
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
    // Carry the handle onto the real user so subsequent page loads
    // and the course members UI see the expected username.
    await userRepo.update(newUser.id, {
      username: handle,
      displayUsername: handle
    });
    authLogger.info("Merged placeholder user into OAuth signup", {
      placeholderId: placeholder.id,
      userId: newUser.id,
      handle
    });
  } catch (err) {
    // Fail open: if the merge crashes we leave both rows in place so
    // an operator can reconcile manually. OAuth signup still succeeds.
    authLogger.error("Placeholder merge failed", {
      placeholderId: placeholder.id,
      userId: newUser.id,
      handle,
      err: err instanceof Error ? err.message : String(err)
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
        status: { type: "string", defaultValue: "active", input: false }
      }
    },
    account: {
      accountLinking: { enabled: true }
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // `user` is better-auth's User shape; id + email are the
            // only fields we need for placeholder merge.
            if (user.id && typeof user.email === "string") {
              await mergePlaceholderIfAny({ id: user.id, email: user.email });
            }
          }
        }
      }
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
