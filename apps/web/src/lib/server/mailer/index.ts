import { createGmailMailer } from "./gmail";
import type { Mailer } from "./types";

export type { Mailer, SendEmailInput } from "./types";

export function getMailer(): Mailer {
  return createGmailMailer();
}
