import { z } from "zod";

export const examCredentialPasswordSchema = z.string().min(12).max(64);

export const examCredentialEmailPayloadSchema = z
  .object({
    credentialId: z.string().min(1),
    revision: z.number().int().positive(),
  })
  .strict();

export interface ExamCredentialEntry {
  membershipId: string;
  userId: string | null;
  username: string;
  name: string;
  email: string | null;
  password: string | null;
  status:
    | "pending_account"
    | "not_issued"
    | "ready"
    | "email_pending"
    | "email_sent"
    | "email_failed"
    | "email_unavailable"
    | "expired"
    | "unavailable";
  emailSentAt: string | null;
  revision: number | null;
}
