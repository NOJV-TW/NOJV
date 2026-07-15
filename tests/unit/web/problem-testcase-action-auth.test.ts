import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertProblemEditAccess,
  canAuthorProblems,
  createTestcaseSetRecord,
  deleteTestcaseRecord,
  deleteTestcaseSetRecord,
  importBundle,
  requireApiAuth,
  requireAuth,
  updateTestcaseRecord,
  updateTestcaseSetRecord,
} = vi.hoisted(() => ({
  assertProblemEditAccess: vi.fn(),
  canAuthorProblems: vi.fn(),
  createTestcaseSetRecord: vi.fn(),
  deleteTestcaseRecord: vi.fn(),
  deleteTestcaseSetRecord: vi.fn(),
  importBundle: vi.fn(),
  requireApiAuth: vi.fn(),
  requireAuth: vi.fn(),
  updateTestcaseRecord: vi.fn(),
  updateTestcaseSetRecord: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({ requireApiAuth, requireAuth }));
vi.mock("$lib/server/shared/action-handlers", () => ({
  withAction: (handler: (event: RequestEvent) => Promise<unknown>) => handler,
}));
vi.mock("$lib/server/shared/api-handler", () => ({
  apiHandler: (handler: (event: RequestEvent) => Promise<unknown>) => handler,
  writeApiHandler: (handler: (event: RequestEvent) => Promise<unknown>) => handler,
}));
vi.mock("$lib/server/shared/load-wrapper", () => ({
  handleLoad: (handler: (event: RequestEvent) => Promise<unknown>) => handler,
}));
vi.mock("$app/stores", () => ({ page: { subscribe: vi.fn() } }));
vi.mock("$app/navigation", () => ({
  beforeNavigate: vi.fn(),
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));
vi.mock("$app/forms", () => ({
  applyAction: vi.fn(),
  deserialize: vi.fn(),
  enhance: vi.fn(),
}));
vi.mock("sveltekit-superforms", () => ({ message: vi.fn(), superValidate: vi.fn() }));
vi.mock("sveltekit-superforms/adapters", () => ({ zod4: vi.fn() }));
vi.mock("@nojv/application", () => ({
  problemDomain: {
    assertProblemEditAccess,
    canAuthorProblems,
    createProblemTestcaseSetRecord: createTestcaseSetRecord,
    deleteTestcaseRecord,
    deleteTestcaseSetRecord,
    importBundle,
    updateTestcaseRecord,
    updateTestcaseSetRecord,
  },
  registryDomain: {},
}));

const { actions } = await import("$lib/../routes/(app)/problems/[problemId]/edit/+page.server");
const { POST: importProblemBundle } =
  await import("$lib/../routes/api/problems/[id]/bundle/+server");

const actor = {
  emailVerified: true,
  platformRole: "teacher" as const,
  userId: "usr_author",
  username: "author",
};

const mutationFunctions = [
  createTestcaseSetRecord,
  updateTestcaseSetRecord,
  deleteTestcaseSetRecord,
  updateTestcaseRecord,
  deleteTestcaseRecord,
];

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockReturnValue(actor);
  requireApiAuth.mockReturnValue(actor);
  assertProblemEditAccess.mockResolvedValue(undefined);
  canAuthorProblems.mockResolvedValue(true);
  createTestcaseSetRecord.mockResolvedValue({ id: "set_1" });
  importBundle.mockResolvedValue({ id: "prob_1", testcaseCount: 1, workspaceCount: 0 });
});

describe("problem testcase action authentication", () => {
  it.each([
    "createTestcaseSet",
    "updateTestcaseSet",
    "deleteTestcaseSet",
    "updateTestcase",
    "deleteTestcase",
  ] as const)(
    "blocks unauthenticated %s before parsing or domain side effects",
    async (name) => {
      requireAuth.mockImplementation(() => {
        throw new Error("Authentication required");
      });
      const action = actions[name];
      if (!action) throw new Error(`Missing action: ${name}`);
      const formData = vi.fn();
      const event = {
        locals: {},
        params: { problemId: "prob_1" },
        request: { formData },
      } as unknown as Parameters<typeof action>[0];

      await expect(action(event)).rejects.toThrow("Authentication required");

      expect(formData).not.toHaveBeenCalled();
      for (const mutate of mutationFunctions) expect(mutate).not.toHaveBeenCalled();
    },
  );

  it.each([
    "createTestcaseSet",
    "updateTestcaseSet",
    "deleteTestcaseSet",
    "updateTestcase",
    "deleteTestcase",
  ] as const)("blocks a non-owner %s before parsing or domain side effects", async (name) => {
    assertProblemEditAccess.mockRejectedValue(
      new Error("Only the author or an admin can modify this problem."),
    );
    const action = actions[name];
    if (!action) throw new Error(`Missing action: ${name}`);
    const formData = vi.fn();
    const event = {
      locals: {},
      params: { problemId: "prob_1" },
      request: { formData },
    } as unknown as Parameters<typeof action>[0];

    await expect(action(event)).rejects.toThrow(/author or an admin/i);

    expect(assertProblemEditAccess).toHaveBeenCalledWith(actor, "prob_1");
    expect(formData).not.toHaveBeenCalled();
    for (const mutate of mutationFunctions) expect(mutate).not.toHaveBeenCalled();
  });

  it("allows an admin through ownership before parsing a testcase mutation", async () => {
    const admin = { ...actor, platformRole: "admin" as const };
    requireAuth.mockReturnValue(admin);
    const form = new FormData();
    form.set(
      "data",
      JSON.stringify({
        cases: [{ input: "1", output: "1" }],
        description: "",
        name: "sample",
        weight: 1,
      }),
    );
    const formData = vi.fn().mockResolvedValue(form);
    const action = actions.createTestcaseSet;
    if (!action) throw new Error("Missing action: createTestcaseSet");

    await expect(
      action({
        locals: {},
        params: { problemId: "prob_1" },
        request: { formData },
      } as unknown as Parameters<typeof action>[0]),
    ).resolves.toEqual({ id: "set_1", success: true });

    expect(assertProblemEditAccess).toHaveBeenCalledWith(admin, "prob_1");
    expect(assertProblemEditAccess.mock.invocationCallOrder[0]).toBeLessThan(
      formData.mock.invocationCallOrder[0]!,
    );
    expect(createTestcaseSetRecord).toHaveBeenCalledWith(
      admin,
      "prob_1",
      expect.objectContaining({ name: "sample" }),
    );
  });
});

describe("problem bundle import authorization", () => {
  it("blocks a non-owner before buffering or importing the bundle", async () => {
    assertProblemEditAccess.mockRejectedValue(
      new Error("Only the author or an admin can modify this problem."),
    );
    const arrayBuffer = vi.fn();
    const getHeader = vi.fn();

    await expect(
      importProblemBundle({
        params: { id: "prob_1" },
        request: { arrayBuffer, headers: { get: getHeader } },
      } as unknown as Parameters<typeof importProblemBundle>[0]),
    ).rejects.toThrow(/author or an admin/i);

    expect(assertProblemEditAccess).toHaveBeenCalledWith(actor, "prob_1");
    expect(getHeader).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("allows an admin through ownership before buffering the bundle", async () => {
    const admin = { ...actor, platformRole: "admin" as const };
    requireApiAuth.mockReturnValue(admin);
    const arrayBuffer = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const getHeader = vi.fn().mockReturnValue("3");

    await importProblemBundle({
      params: { id: "prob_1" },
      request: { arrayBuffer, headers: { get: getHeader } },
    } as unknown as Parameters<typeof importProblemBundle>[0]);

    expect(assertProblemEditAccess).toHaveBeenCalledWith(admin, "prob_1");
    expect(assertProblemEditAccess.mock.invocationCallOrder[0]).toBeLessThan(
      getHeader.mock.invocationCallOrder[0]!,
    );
    expect(getHeader.mock.invocationCallOrder[0]).toBeLessThan(
      arrayBuffer.mock.invocationCallOrder[0]!,
    );
    expect(importBundle).toHaveBeenCalledWith(
      expect.objectContaining({ platformRole: "admin", userId: admin.userId }),
      "prob_1",
      Buffer.from([1, 2, 3]),
    );
  });
});
