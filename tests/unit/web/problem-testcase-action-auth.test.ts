import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTestcaseSetRecord, requireAuth } = vi.hoisted(() => ({
  createTestcaseSetRecord: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("$lib/server/auth", () => ({ requireAuth }));
vi.mock("$lib/server/shared/action-handlers", () => ({
  withAction: (handler: (event: RequestEvent) => Promise<unknown>) => handler,
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
    createProblemTestcaseSetRecord: createTestcaseSetRecord,
  },
  registryDomain: {},
}));

const { actions } = await import("$lib/../routes/(app)/problems/[problemId]/edit/+page.server");

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockImplementation(() => {
    throw new Error("Authentication required");
  });
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
      expect(createTestcaseSetRecord).not.toHaveBeenCalled();
    },
  );
});
