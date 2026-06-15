import { z } from "zod";

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, "account_changePassword_tooShort"),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "account_changePassword_mismatch",
    path: ["confirmPassword"],
  });
