import { getWebEnv } from "../env";
import { createResendMailer } from "./resend";
import type { Mailer } from "./types";

export type { Mailer, SendEmailInput } from "./types";

const mailerFactories = {
  resend: createResendMailer,
} satisfies Record<ReturnType<typeof getWebEnv>["EMAIL_PROVIDER"], () => Mailer>;

export function getMailer(): Mailer {
  return mailerFactories[getWebEnv().EMAIL_PROVIDER]();
}
