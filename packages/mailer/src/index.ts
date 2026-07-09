import nodemailer from "nodemailer";
import { z } from "zod";

import type { Mailer } from "./types";

export type { Mailer, SendEmailInput } from "./types";
export { renderEmail } from "./template";
export type { EmailContent } from "./template";

const envSchema = z.object({
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default(""),
  APP_BASE_URL: z.string().default("https://nojv.tw"),
});

let cachedMailer: Mailer | undefined;

function createMailer(): Mailer {
  const env = envSchema.parse(process.env);

  if (!env.SMTP_HOST || !env.SMTP_USER) {
    console.warn("[mailer] SMTP is not configured; email sending is disabled (no-op).");
    return {
      sendEmail: () => Promise.resolve(),
    };
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    pool: true,
    maxConnections: 3,
  });
  const from = env.SMTP_FROM || `NOJV <${env.SMTP_USER}>`;

  return {
    async sendEmail({ to, subject, html }) {
      await transporter.sendMail({ from, to, subject, html });
    },
  };
}

export function getMailer(): Mailer {
  cachedMailer ??= createMailer();
  return cachedMailer;
}

export function getAppBaseUrl(): string {
  return envSchema.parse(process.env).APP_BASE_URL;
}
