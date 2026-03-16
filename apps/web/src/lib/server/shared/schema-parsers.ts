import { judgeTypeSchema, problemDifficultySchema, submissionTypeSchema } from "@nojv/core";

export const parseDifficulty = (v: unknown) => problemDifficultySchema.catch("medium").parse(v);
export const parseJudgeType = (v: unknown) => judgeTypeSchema.catch("standard").parse(v);
export const parseSubmissionType = (v: unknown) => submissionTypeSchema.catch("full_source").parse(v);
