import { z } from "zod";

export const rejudgeBatchSchema = z.object({
  problemId: z.string().min(1),
  contestId: z.string().optional(),
  assessmentId: z.string().optional(),
  examId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});
