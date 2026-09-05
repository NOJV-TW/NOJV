import { compileOutputSchema, sandboxOutputSchema, validateOutputSchema } from "@nojv/core";

export const parseSandboxResult = (data: unknown) => sandboxOutputSchema.safeParse(data);
export const parseCompileOutput = (data: unknown) => compileOutputSchema.safeParse(data);
export const parseValidateOutput = (data: unknown) => validateOutputSchema.safeParse(data);
