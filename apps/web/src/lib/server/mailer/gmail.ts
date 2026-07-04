import nodemailer from "nodemailer";

import { getWebEnv } from "../env";
import type { Mailer } from "./types";

export function createGmailMailer(): Mailer {
  const env = getWebEnv();
  if (!env.GMAIL_USER) throw new Error("GMAIL_USER is required");
  if (!env.GMAIL_APP_PASSWORD) throw new Error("GMAIL_APP_PASSWORD is required");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
  const from = `NOJV <${env.GMAIL_USER}>`;

  return {
    async sendEmail({ to, subject, html }) {
      await transporter.sendMail({ from, to, subject, html });
    },
  };
}
