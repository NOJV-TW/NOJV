import { z } from "zod";
import { userHandleSchema } from "@nojv/core";

export const nameSchema = z.object({
  name: z.string().trim().min(1).max(64),
});

export const usernameSchema = z.object({
  username: userHandleSchema,
});
