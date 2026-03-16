import { z } from "zod";
import type { SandboxResult } from "@nojv/sandbox";

const sandboxTestcaseResultSchema = z.object({
  index: z.number(),
  verdict: z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  timeMs: z.number(),
  score: z.number().optional(),
  feedback: z.string().optional()
});

const rawSchema = z.object({
  compilationError: z.string().optional(),
  testcaseResults: z.array(sandboxTestcaseResultSchema)
});

export function parseSandboxResult(data: unknown) {
  const result = rawSchema.safeParse(data);
  if (!result.success) return { success: false as const };
  return { success: true as const, data: result.data as unknown as SandboxResult };
}
