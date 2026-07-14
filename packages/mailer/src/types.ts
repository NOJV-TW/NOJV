export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export type SendEmailResult = "accepted" | "suppressed";

export interface Mailer {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}
