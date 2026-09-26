import { z } from "zod";

export const plagiarismFlagCreateSchema = z.object({
  contextType: z.enum(["assessment", "exam", "contest"]),
  contextId: z.string().min(1),
  problemId: z.string().min(1),
  userAId: z.string().min(1),
  userBId: z.string().min(1),
  note: z.string().max(2000).optional().nullable(),
});
