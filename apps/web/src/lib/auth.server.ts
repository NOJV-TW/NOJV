import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { twoFactor, username } from "better-auth/plugins";
import bcrypt from "bcryptjs";

import {
  areSecuritySettingsUnlocked,
  adminMfaKind,
  createStepUpHandoffTicket,
  hasAdminSessionMfa,
  isSuperAdminSessionExpired,
  markFactorChangeVerifiedSession,
  markVerifiedSession,
  passkeyRegistrationDenialReason,
  securityGenerationProof,
} from "@nojv/application";
import { prismaAdapterClient as prisma, userRepo } from "@nojv/db";
import { getWebEnv } from "$lib/server/env";
import {
  consumeInternalFactorMutationAuthority,
  factorMutationPath,
  type FactorMutationPath,
} from "$lib/server/auth-factor-mutation";
import {
  getPasskeyAuthenticationProof,
  getPasskeyRegistrationProof,
  setPasskeyAuthenticationProof,
  setPasskeyRegistrationProof,
} from "$lib/server/passkey-request-proof";
import { STEP_UP_HANDOFF_COOKIE } from "$lib/server/step-up-handoff";
import {
  consumeSuperAdminPasswordProof,
  isSuperAdminPasswordProofSessionValid,
  passwordProofTicketFromCookieHeader,
  readSuperAdminPasswordProof,
} from "$lib/server/super-admin-password-proof";
import { extractStudentId, parseSchoolEmail } from "$lib/utils/school";
import { createLogger } from "$lib/server/logger";

const authLogger = createLogger("auth-hooks");

const internalFactorMutationPaths = new Set<FactorMutationPath>(
  Object.values(factorMutationPath),
);

const unfinishedSuperAdminAuthPaths = new Set([
  "/change-password",
  "/get-session",
  "/passkey/generate-authenticate-options",
  "/passkey/generate-register-options",
  "/passkey/verify-authentication",
  "/passkey/verify-registration",
  "/sign-in/email",
  "/sign-in/username",
  "/sign-out",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-totp",
]);

function isInternalFactorMutationPath(path: string): path is FactorMutationPath {
  return internalFactorMutationPaths.has(path as FactorMutationPath);
}

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
      account: {
        create: {
          before: async (account) => {
            if (account.providerId === "credential") return;
            const user = await prisma.user.findUnique({
              where: { id: account.userId },
              select: { isSuperAdmin: true },
            });
            if (user?.isSuperAdmin) {
              throw new APIError("FORBIDDEN", {
                message: "Super admin accounts cannot link OAuth providers.",
              });
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const proof = await getPasskeyAuthenticationProof();
            if (!proof?.authenticatedAt || proof.userId !== session.userId) return;
            const authenticatedAt = new Date(proof.authenticatedAt);
            const maximumExpiry = new Date(authenticatedAt.getTime() + 24 * 60 * 60 * 1000);
            return {
              data: {
                ...session,
                createdAt: authenticatedAt,
                expiresAt:
                  session.expiresAt < maximumExpiry ? session.expiresAt : maximumExpiry,
              },
            };
          },
        },
      },
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
        const activeSession = await getSessionFromCtx(ctx);
        if (
          activeSession?.user.isSuperAdmin &&
          !unfinishedSuperAdminAuthPaths.has(ctx.path) &&
          !(await hasAdminSessionMfa(
            activeSession.session.id,
            securityGenerationProof(
              activeSession.user as typeof activeSession.user & {
                securityGeneration: number;
              },
            ),
          ))
        ) {
          throw new APIError("FORBIDDEN", {
            message: "Complete super admin security verification first.",
          });
        }
        if (ctx.path === "/link-social") {
          if (activeSession?.user.isSuperAdmin) {
            throw new APIError("FORBIDDEN", {
              message: "Super admin accounts cannot link OAuth providers.",
            });
          }
        }
        if (isInternalFactorMutationPath(ctx.path)) {
          const session = await getSessionFromCtx(ctx);
          const isSignInTotpVerification =
            ctx.path === factorMutationPath.verifyTotp && session === null;
          if (isSignInTotpVerification) return;
          if (!(await consumeInternalFactorMutationAuthority(ctx.path))) {
            throw new APIError("FORBIDDEN", {
              message: "Factor configuration changes must use the account settings flow.",
            });
          }
          return;
        }
        if (ctx.path === "/passkey/verify-authentication") {
          const credentialID = credentialIdFromPasskeyVerification(ctx.body);
          if (!credentialID) return;
          const passkeyRecord = await prisma.passkey.findFirst({
            where: { credentialID },
            select: {
              user: {
                select: { id: true, isSuperAdmin: true, securityGeneration: true },
              },
            },
          });
          if (passkeyRecord) {
            const proof = securityGenerationProof(passkeyRecord.user);
            let authenticatedAt: string | undefined;
            let passwordProofTicket: string | undefined;
            if (passkeyRecord.user.isSuperAdmin) {
              const session = activeSession;
              if (
                session?.user.id === proof.userId &&
                !isSuperAdminSessionExpired(new Date(session.session.createdAt)) &&
                (await hasAdminSessionMfa(session.session.id, proof))
              ) {
                authenticatedAt = new Date(session.session.createdAt).toISOString();
              } else {
                const ticket = passwordProofTicketFromCookieHeader(
                  ctx.headers?.get("cookie") ?? null,
                );
                const passwordProof = ticket ? await readSuperAdminPasswordProof(ticket) : null;
                if (
                  !ticket ||
                  passwordProof?.userId !== proof.userId ||
                  !isSuperAdminPasswordProofSessionValid(
                    passwordProof,
                    session?.session.id ?? null,
                  )
                ) {
                  throw new APIError("FORBIDDEN", {
                    message:
                      "Super admin passkey sign-in requires password verification first.",
                  });
                }
                authenticatedAt = passwordProof.authenticatedAt;
                passwordProofTicket = ticket;
              }
            }
            await setPasskeyAuthenticationProof({
              credentialID,
              ...proof,
              ...(authenticatedAt ? { authenticatedAt } : {}),
              ...(passwordProofTicket ? { passwordProofTicket } : {}),
            });
          }
          return;
        }
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
            select: { id: true, securityGeneration: true },
          });
          if (!securityState) {
            throw new APIError("UNAUTHORIZED", {
              message: "The authenticated user no longer exists.",
            });
          }
          const proof = securityGenerationProof(securityState);
          const securitySettingsUnlocked = await areSecuritySettingsUnlocked(sessionId, proof);
          const denial = passkeyRegistrationDenialReason({
            securitySettingsUnlocked,
          });
          if (denial) {
            throw new APIError("FORBIDDEN", {
              message: "Unlock login and security settings first.",
            });
          }
          if (ctx.path === "/passkey/verify-registration") {
            const credentialID = credentialIdFromPasskeyVerification(ctx.body);
            if (credentialID) {
              await setPasskeyRegistrationProof({ ...proof, credentialID, sessionId });
            }
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/two-factor/verify-totp") {
          const session = ctx.context.newSession ?? (await getSessionFromCtx(ctx));
          if (!session) return;
          const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
              id: true,
              isSuperAdmin: true,
              platformRole: true,
              securityGeneration: true,
            },
          });
          if (user) {
            const ticket = passwordProofTicketFromCookieHeader(
              ctx.headers?.get("cookie") ?? null,
            );
            if (user.isSuperAdmin && ticket) {
              await consumeSuperAdminPasswordProof(ticket, user.id);
            }
            await markVerifiedSession(
              session.session.id,
              securityGenerationProof(user),
              adminMfaKind(user),
            );
          }
          return;
        }
        if (ctx.path === "/passkey/verify-registration") {
          const registration = await getPasskeyRegistrationProof();
          if (!registration) return;
          const user = await prisma.user.findUnique({
            where: { id: registration.userId },
            select: {
              id: true,
              isSuperAdmin: true,
              platformRole: true,
              securityGeneration: true,
            },
          });
          if (!user) return;
          const proof = securityGenerationProof(user);
          let rebound = false;
          try {
            rebound = await markFactorChangeVerifiedSession(
              registration.sessionId,
              registration,
              proof,
              adminMfaKind(user),
            );
          } finally {
            if (!rebound) {
              await prisma.passkey.deleteMany({
                where: {
                  credentialID: registration.credentialID,
                  userId: registration.userId,
                },
              });
            }
          }
          if (!rebound) {
            throw new APIError("CONFLICT", {
              message: "Security settings changed during passkey registration. Try again.",
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
            if (
              proof.passwordProofTicket &&
              !(await consumeSuperAdminPasswordProof(proof.passwordProofTicket, proof.userId))
            ) {
              throw new APIError("FORBIDDEN", {
                message: "The password verification expired. Sign in again.",
              });
            }
            const ticket = await createStepUpHandoffTicket(
              proof,
              "verified",
              proof.authenticatedAt,
            );
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
