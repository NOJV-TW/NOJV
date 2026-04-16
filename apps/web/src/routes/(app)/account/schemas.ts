import { z } from "zod";

export const nameSchema = z.object({
  name: z.string().trim().min(1).max(64)
});

export const usernameSchema = z.object({
  username: z.string().trim().min(1).max(64)
});
