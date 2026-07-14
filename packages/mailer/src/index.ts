import nodemailer from "nodemailer";
import { z } from "zod";

import type { Mailer } from "./types";

export type { Mailer, SendEmailInput, SendEmailResult } from "./types";
export { renderEmail } from "./template";
export type { EmailContent } from "./template";

const nodeEnvSchema = z.enum(["development", "test", "production"]);
const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "APP_BASE_URL must use HTTP or HTTPS");
const absentSmtpValue = z.undefined().optional();
const nonSmtpMailerKeys = new Set(["NODE_ENV", "MAILER_MODE", "APP_BASE_URL"]);

function projectMailerEnv(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key]) => nonSmtpMailerKeys.has(key) || key.startsWith("SMTP_"),
    ),
  );
}

const smtpEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    MAILER_MODE: z.literal("smtp"),
    SMTP_HOST: z.string().trim().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_USER: z.string().trim().min(1),
    SMTP_PASS: z.string().min(1),
    SMTP_FROM: z.string().trim().min(1),
    APP_BASE_URL: httpUrlSchema,
  })
  .strict();

const sinkEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test"]),
    MAILER_MODE: z.literal("sink"),
    SMTP_HOST: absentSmtpValue,
    SMTP_PORT: absentSmtpValue,
    SMTP_USER: absentSmtpValue,
    SMTP_PASS: absentSmtpValue,
    SMTP_FROM: absentSmtpValue,
    APP_BASE_URL: httpUrlSchema,
  })
  .strict();

export const mailerEnvSchema = z.preprocess(
  projectMailerEnv,
  z
    .discriminatedUnion("MAILER_MODE", [smtpEnvSchema, sinkEnvSchema])
    .superRefine((env, context) => {
      if (env.NODE_ENV === "production" && new URL(env.APP_BASE_URL).protocol !== "https:") {
        context.addIssue({
          code: "custom",
          message: "Production APP_BASE_URL must use HTTPS",
          path: ["APP_BASE_URL"],
        });
      }
    }),
);

export type MailerConfig = z.output<typeof mailerEnvSchema>;

let cachedMailer: Mailer | undefined;

export function validateMailerConfig(
  input: Record<string, string | undefined> = process.env,
): MailerConfig {
  return mailerEnvSchema.parse(input);
}

function createMailer(): Mailer {
  const env = validateMailerConfig();

  if (env.MAILER_MODE === "sink") {
    return {
      sendEmail() {
        console.info({ component: "mailer", event: "email_suppressed", mode: "sink" });
        return Promise.resolve("suppressed");
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    pool: true,
    maxConnections: 3,
  });

  return {
    async sendEmail({ to, subject, html }) {
      const result = await transporter.sendMail({ from: env.SMTP_FROM, to, subject, html });
      if (!Array.isArray(result.accepted) || result.accepted.length === 0) {
        throw new Error("SMTP accepted no recipients");
      }
      return "accepted";
    },
  };
}

export function getMailer(): Mailer {
  cachedMailer ??= createMailer();
  return cachedMailer;
}

export function getAppBaseUrl(): string {
  return validateMailerConfig().APP_BASE_URL;
}
