import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { examDomain } from "@nojv/application";

export const examPasswordAuth = () =>
  ({
    id: "exam-password",
    endpoints: {
      signInExamPassword: createAuthEndpoint(
        "/sign-in/exam-password",
        {
          method: "POST",
          body: z.object({
            username: z.string().trim().min(1).max(64),
            password: z.string().min(1).max(64),
          }),
          requireHeaders: true,
        },
        async (ctx) => {
          const credential = await examDomain.credentials.authenticate(
            ctx.body.username,
            ctx.body.password,
          );
          if (!credential) {
            throw new APIError("UNAUTHORIZED", {
              code: "INVALID_EXAM_CREDENTIAL",
              message: "The username or exam password is invalid or has expired.",
            });
          }
          const user = await ctx.context.internalAdapter.findUserById(credential.userId);
          if (!user) {
            throw new APIError("UNAUTHORIZED", {
              code: "INVALID_EXAM_CREDENTIAL",
              message: "The username or exam password is invalid or has expired.",
            });
          }
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            true,
            { expiresAt: credential.expiresAt, examPassword: true },
            true,
          );
          try {
            const attached = await examDomain.credentials.attachSession({
              credentialId: credential.credentialId,
              revision: credential.revision,
              userId: user.id,
              sessionId: session.id,
            });
            if (!attached) {
              throw new APIError("UNAUTHORIZED", {
                code: "INVALID_EXAM_CREDENTIAL",
                message: "The exam password changed or expired. Sign in again.",
              });
            }
            await setSessionCookie(ctx, { session, user }, true);
          } catch (error) {
            await ctx.context.internalAdapter.deleteSession(session.token);
            throw error;
          }
          return ctx.json({ examId: credential.examId });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
