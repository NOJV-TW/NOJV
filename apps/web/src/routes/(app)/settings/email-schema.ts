import { z } from "zod";

export const changeEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().pipe(z.email()),
});

export type ChangeEmailData = z.infer<typeof changeEmailSchema>;
