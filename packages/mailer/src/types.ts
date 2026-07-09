export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export interface Mailer {
  sendEmail(input: SendEmailInput): Promise<void>;
}
