import { Resend } from "resend";

import { getWebEnv } from "../env";
import type { Mailer } from "./types";

export function createResendMailer(): Mailer {
  const env = getWebEnv();
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required");
  if (!env.EMAIL_FROM_DOMAIN) throw new Error("EMAIL_FROM_DOMAIN is required");

  const resend = new Resend(env.RESEND_API_KEY);
  const from = `NOJV <noreply@${env.EMAIL_FROM_DOMAIN}>`;

  return {
    async sendEmail({ to, subject, html }) {
      const { error } = await resend.emails.send({ from, to, subject, html });
      if (error) throw new Error(error.message);
    },
  };
}
