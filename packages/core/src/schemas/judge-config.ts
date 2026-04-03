import { z } from "zod";
import { judgeTypeSchema } from "../types";
import {
  staticAnalysisConfigSchema,
  scoringConfigSchema,
  artifactConfigSchema,
  networkAccessConfigSchema,
  pipelineStageSchema,
  customScriptConfigSchema
} from "../pipeline";

export const judgeConfigSchema = z.object({
  type: judgeTypeSchema.default("standard"),
  checkerScript: z.string().max(200_000).optional(),
  interactorScript: z.string().max(200_000).optional(),

  scoring: scoringConfigSchema.optional(),

  pipeline: z
    .object({
      stages: z.array(pipelineStageSchema).min(1).max(20)
    })
    .optional(),

  staticAnalysis: staticAnalysisConfigSchema.optional(),
  artifacts: artifactConfigSchema.optional(),
  networkAccess: networkAccessConfigSchema.optional(),
  customScripts: z
    .array(
      customScriptConfigSchema.extend({
        name: z.string().min(1).max(100)
      })
    )
    .max(10)
    .optional()
});

export type JudgeConfig = z.infer<typeof judgeConfigSchema>;
