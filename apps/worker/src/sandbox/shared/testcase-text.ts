import type { SandboxRequest, SandboxTestcaseObject, SandboxText } from "@nojv/core";

export type TestcaseReader = (object: SandboxTestcaseObject) => Promise<Buffer>;

export async function loadSandboxTestcases(
  request: SandboxRequest,
  read: TestcaseReader | undefined,
): Promise<SandboxRequest> {
  const text = async (value: SandboxText): Promise<string> => {
    if (typeof value === "string") return value;
    if (!read) throw new Error(`No testcase reader is configured for ${value.key}.`);
    return (await read(value)).toString("utf8");
  };
  return {
    ...request,
    testcases: await Promise.all(
      request.testcases.map(async ({ input, output, ...testcase }) => ({
        ...testcase,
        input: await text(input),
        ...(output !== undefined ? { output: await text(output) } : {}),
      })),
    ),
  };
}
