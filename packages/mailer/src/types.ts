export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  messageId?: string;
}

export type SendEmailResult = "accepted" | "suppressed";

export interface Mailer {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}
