import { getWebEnv } from "../env";
import { createResendMailer } from "./resend";
import type { Mailer } from "./types";

export type { Mailer, SendEmailInput } from "./types";

export function getMailer(): Mailer {
  const provider = getWebEnv().EMAIL_PROVIDER;
  switch (provider) {
    case "resend":
      return createResendMailer();
    case "gmail":
      throw new Error("Gmail mailer is not implemented yet");
  }
}
