import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { twoFactor, username } from "better-auth/plugins";
import bcrypt from "bcryptjs";

import {
  areSecuritySettingsUnlocked,
  userDomain,
  adminMfaKind,
  createStepUpHandoffTicket,
  hasAdminSessionMfa,
  isSuperAdminSessionExpired,
  markFactorChangeVerifiedSession,
  markVerifiedSession,
  passkeyRegistrationDenialReason,
  securityGenerationProof,
} from "@nojv/application";
import { prismaAdapterClient as prisma } from "@nojv/db";
import { getMailer, renderEmail } from "@nojv/mailer";
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

async function sendEmailVerificationMessage({
  to,
  url,
  subject,
  heading,
  intro,
  actionLabel,
  outro,
}: {
  to: string;
  url: string;
  subject: string;
  heading: string;
  intro: string;
  actionLabel: string;
  outro: string;
}): Promise<void> {
  const delivery = await getMailer().sendEmail({
    to,
    subject,
    html: renderEmail({
      heading,
      intro,
      action: { url, label: actionLabel },
      outro,
    }),
  });
  if (delivery === "suppressed") {
    throw new Error("Email delivery is unavailable.");
  }
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
    emailVerification: {
      expiresIn: 30 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmailVerificationMessage({
          to: user.email,
          url,
          subject: "NOJV 電子郵件驗證 · Verify your email",
          heading: "驗證電子郵件 · Verify your email",
          intro:
            "請點擊下方按鈕完成電子郵件驗證。<br>Click the button below to verify your email address.",
          actionLabel: "驗證電子郵件 · Verify email",
          outro:
            "此連結將在 30 分鐘後失效。若你沒有提出變更，請忽略這封信。<br>This link expires in 30 minutes. If you did not request this change, you can ignore this email.",
        });
      },
    },
    socialProviders: buildSocialProviders(env),
    user: {
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await sendEmailVerificationMessage({
            to: user.email,
            url,
            subject: "NOJV 信箱變更確認 · Confirm email change",
            heading: "確認信箱變更 · Confirm email change",
            intro: `有人要求將你的 NOJV 信箱變更為 <strong>${newEmail}</strong>。請先確認這項要求。<br>Someone requested to change your NOJV email address to <strong>${newEmail}</strong>. Confirm this request first.`,
            actionLabel: "確認變更 · Confirm change",
            outro:
              "確認後，系統會再寄一封驗證信到新信箱。若你沒有提出變更，請忽略這封信。<br>After confirmation, we will send a verification email to the new address. If you did not request this change, ignore this email.",
          });
        },
      },
      additionalFields: {
        disabled: { type: "boolean", defaultValue: false, input: false },
        platformRole: { type: "string", defaultValue: "student", input: false },
        isSuperAdmin: { type: "boolean", defaultValue: false, input: false },
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
            await userDomain.linkUserCourseRoster(session.userId);
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
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/update-user" &&
          ctx.body &&
          typeof ctx.body === "object" &&
          ("username" in ctx.body || "displayUsername" in ctx.body)
        ) {
          throw new APIError("FORBIDDEN", {
            message: "Change usernames through the verified profile flow.",
          });
        }
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
        if (isAPIError(ctx.context.returned)) return;
        if (ctx.path === "/two-factor/verify-totp") {
          const session = ctx.context.newSession;
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
