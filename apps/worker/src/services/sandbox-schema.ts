import { compileOutputSchema, sandboxOutputSchema, validateOutputSchema } from "@nojv/core";

export const parseSandboxResult = (data: unknown) => sandboxOutputSchema.safeParse(data);
export const parseCompileOutput = (data: unknown) => compileOutputSchema.safeParse(data);
export function parseValidateOutput(data: unknown, expectedIndices: readonly number[]) {
  const expected = new Set(expectedIndices);
  return validateOutputSchema
    .refine(
      ({ validatorOutcomes }) =>
        validatorOutcomes === undefined ||
        (validatorOutcomes.length === expected.size &&
          new Set(validatorOutcomes.map(({ index }) => index)).size === expected.size &&
          validatorOutcomes.every(({ index }) => expected.has(index))),
      "Validator outcomes must match the expected testcase indices exactly once.",
    )
    .safeParse(data);
}
