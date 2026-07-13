import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { twoFactor, username } from "better-auth/plugins";
import bcrypt from "bcryptjs";

import {
  createStepUpHandoffTicket,
  hasFreshStepUp,
  hasTwoFactorChangeGrant,
  passkeyRegistrationDenialReason,
  securityGenerationProof,
} from "@nojv/application";
import { prismaAdapterClient as prisma, userRepo } from "@nojv/db";
import { getWebEnv } from "$lib/server/env";
import {
  getPasskeyAuthenticationProof,
  setPasskeyAuthenticationProof,
} from "$lib/server/passkey-request-proof";
import { STEP_UP_HANDOFF_COOKIE } from "$lib/server/step-up-handoff";
import { extractStudentId, parseSchoolEmail } from "$lib/utils/school";
import { createLogger } from "$lib/server/logger";

const authLogger = createLogger("auth-hooks");

function credentialIdFromPasskeyVerification(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("response" in body)) return null;
  const response = body.response;
  if (!response || typeof response !== "object" || !("id" in response)) return null;
  return typeof response.id === "string" ? response.id : null;
}

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
      disableSignUp: true,
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
        isSuperAdmin: { type: "boolean", defaultValue: false, input: false },
        status: { type: "string", defaultValue: "active", input: false },
        mustChangePassword: { type: "boolean", defaultValue: false, input: false },
        twoFactorActivated: { type: "boolean", defaultValue: false, input: false },
        securityGeneration: { type: "number", defaultValue: 0, input: false },
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["github", "google"],
        allowDifferentEmails: true,
      },
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/passkey/verify-authentication") {
          const credentialID = credentialIdFromPasskeyVerification(ctx.body);
          if (!credentialID) return;
          const passkeyRecord = await prisma.passkey.findFirst({
            where: { credentialID },
            select: {
              user: { select: { id: true, securityGeneration: true } },
            },
          });
          if (passkeyRecord) {
            await setPasskeyAuthenticationProof({
              credentialID,
              ...securityGenerationProof(passkeyRecord.user),
            });
          }
          return;
        }
        // Adding a passkey is a 2FA configuration change: it requires the master
        // switch to be on and a valid step-up (a recent activation grant or a
        // fresh device verification). Without this, a client could add a passkey
        // straight through the API and bypass the master-switch model.
        if (
          ctx.path === "/passkey/generate-register-options" ||
          ctx.path === "/passkey/verify-registration"
        ) {
          const session = await getSessionFromCtx(ctx);
          const userId = session?.user.id;
          const sessionId = session?.session.id;
          if (!userId || !sessionId) return;
          const securityState = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, securityGeneration: true, twoFactorActivated: true },
          });
          if (!securityState) {
            throw new APIError("UNAUTHORIZED", {
              message: "The authenticated user no longer exists.",
            });
          }
          const proof = securityGenerationProof(securityState);
          const [hasGrant, hasFresh] = await Promise.all([
            hasTwoFactorChangeGrant(sessionId, proof),
            hasFreshStepUp(sessionId, proof),
          ]);
          const denial = passkeyRegistrationDenialReason({
            activated: securityState.twoFactorActivated,
            hasGrant,
            hasFresh,
          });
          if (denial === "not_activated") {
            throw new APIError("FORBIDDEN", {
              message: "Turn on two-factor authentication first.",
            });
          }
          if (denial === "needs_step_up") {
            throw new APIError("FORBIDDEN", {
              message: "Verify with your authenticator or passkey first.",
            });
          }
        }
      }),
    },
    plugins: [
      username({
        maxUsernameLength: 64,
        usernameValidator: (candidate) => {
          return /^[a-z0-9._-]+$/.test(candidate);
        },
      }),
      twoFactor({ issuer: "NOJV", allowPasswordless: true }),
      passkey({
        rpID: new URL(env.BETTER_AUTH_URL).hostname,
        rpName: "NOJV",
        origin: env.BETTER_AUTH_URL,
        authentication: {
          // This callback only runs after the assertion has been verified. It
          // runs before better-auth creates the new session, so use the
          // verified credential—not client identity or a not-yet-created
          // session—to mark the short-lived step-up grant.
          afterVerification: async ({ clientData, ctx }) => {
            const proof = await getPasskeyAuthenticationProof();
            if (proof?.credentialID !== clientData.id) return;
            const passkeyRecord = await prisma.passkey.findFirst({
              where: { credentialID: clientData.id },
              select: { userId: true },
            });
            if (passkeyRecord?.userId !== proof.userId) return;
            const ticket = await createStepUpHandoffTicket(proof);
            ctx.setCookie(STEP_UP_HANDOFF_COOKIE, ticket, {
              httpOnly: true,
              maxAge: 60,
              path: "/",
              sameSite: "lax",
              secure: isProduction,
            });
          },
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
