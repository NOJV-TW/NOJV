import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assertProblemEditAccess: vi.fn(),
  updateProblemRecord: vi.fn(),
  updateProblemWorkspace: vi.fn(),
}));

vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: async () => null,
}));
vi.mock("$lib/server/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock("$lib/server/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("sveltekit-superforms", () => import("sveltekit-superforms/server"));
vi.mock("@nojv/application", async (original) => {
  const actual = await original<typeof import("@nojv/application")>();
  return {
    ...actual,
    problemDomain: {
      ...actual.problemDomain,
      assertProblemEditAccess: mocks.assertProblemEditAccess,
      updateProblemRecord: mocks.updateProblemRecord,
      updateProblemWorkspace: mocks.updateProblemWorkspace,
    },
  };
});

const { ConflictError } = await import("@nojv/application");
const { actions } = await import("$lib/../routes/(app)/problems/[problemId]/edit/+page.server");

const actor = { userId: "usr_1", username: "author", platformRole: "teacher" as const };

function actionEvent(name: string, body: URLSearchParams | FormData) {
  const url = new URL(`http://localhost/problems/prob_1/edit?/${name}`);
  return {
    params: { problemId: "prob_1" },
    request: new Request(url, { method: "POST", body }),
    url,
    locals: {},
  } as never;
}

const basicFields = {
  title: "Sum",
  difficulty: "easy",
  statement: "Add two numbers.",
  inputFormat: "",
  outputFormat: "One integer.",
  interactionFormat: "x",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockReturnValue(actor);
  mocks.assertProblemEditAccess.mockResolvedValue(undefined);
  mocks.updateProblemRecord.mockResolvedValue({ id: "prob_1" });
  mocks.updateProblemWorkspace.mockResolvedValue({ id: "prob_1", fileCount: 1 });
});

describe("update (Basic info)", () => {
  it("writes only the Basic fields that were sent", async () => {
    const result = await actions.update!(
      actionEvent(
        "update",
        new URLSearchParams({ ...basicFields, type: "multi_file", judgeConfig: "x" }),
      ),
    );

    expect(result).toMatchObject({ form: { message: { kind: "success" } } });
    const payload = mocks.updateProblemRecord.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload).toMatchObject(basicFields);
    for (const key of [
      "type",
      "judgeConfig",
      "visibility",
      "adminMayPublish",
      "timeLimitMs",
      "memoryLimitMb",
    ])
      expect(payload[key]).toBeUndefined();
  });

  it("returns a domain failure as a Superforms error message", async () => {
    mocks.updateProblemRecord.mockRejectedValue(
      new ConflictError("Published Advanced-mode judge configuration cannot be changed."),
    );

    const result = await actions.update!(
      actionEvent("update", new URLSearchParams({ ...basicFields, timeLimitMs: "2000" })),
    );

    expect(result).toMatchObject({
      status: 409,
      data: {
        form: {
          message: {
            kind: "error",
            text: "Published Advanced-mode judge configuration cannot be changed.",
          },
        },
      },
    });
  });
});

describe("updateWorkspace", () => {
  it("persists file descriptions", async () => {
    const body = new FormData();
    body.set(
      "data",
      JSON.stringify({
        files: [
          {
            language: "python",
            path: "main.py",
            content: "print(1)\n",
            description: "Implement solve().",
            visibility: "editable",
            orderIndex: 0,
          },
        ],
      }),
    );

    await actions.updateWorkspace!(actionEvent("updateWorkspace", body));

    expect(mocks.updateProblemWorkspace).toHaveBeenCalledWith(
      actor,
      "prob_1",
      expect.objectContaining({
        files: [expect.objectContaining({ description: "Implement solve()." })],
      }),
    );
  });
});
