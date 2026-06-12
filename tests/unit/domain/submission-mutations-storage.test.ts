import { beforeEach, describe, expect, it, vi } from "vitest";

import { submissionSourceKey } from "../../../packages/storage/src/keys";
import { createInMemoryStorage } from "../_fixtures/storage";

const {
  problemFindById,
  userFindById,
  userCreate,
  userUpdate,
  workspaceFindByProblemId,
  submissionCreate,
  submissionUpdateStatus,
  examSessionFindActiveForUser,
  txAssessmentProblemFindFirst,
  txContestProblemFindFirst,
  storageRef,
} = vi.hoisted(() => ({
  problemFindById: vi.fn(),
  userFindById: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  workspaceFindByProblemId: vi.fn(),
  submissionCreate: vi.fn(),
  submissionUpdateStatus: vi.fn(),
  examSessionFindActiveForUser: vi.fn(),
  txAssessmentProblemFindFirst: vi.fn(),
  txContestProblemFindFirst: vi.fn(),
  storageRef: { client: null as unknown as { send: (cmd: unknown) => Promise<unknown> } },
}));

vi.mock("@nojv/db", () => ({
  problemRepo: { withTx: () => ({ findById: problemFindById }) },
  userRepo: {
    withTx: () => ({ findById: userFindById, create: userCreate, update: userUpdate }),
  },
  courseRepo: { withTx: () => ({ findById: vi.fn() }) },
  courseMembershipRepo: { withTx: () => ({ findByComposite: vi.fn() }) },
  assessmentRepo: { withTx: () => ({ findByCompositeId: vi.fn() }) },
  contestRepo: { withTx: () => ({ findById: vi.fn() }) },
  examSessionRepo: { withTx: () => ({ findActiveForUser: examSessionFindActiveForUser }) },
  examRepo: { withTx: () => ({ findById: vi.fn() }) },
  problemWorkspaceFileRepo: { findByProblemId: workspaceFindByProblemId },
  submissionRepo: {
    withTx: () => ({
      countForUserAssessmentProblemSince: vi.fn(),
      create: submissionCreate,
    }),
    updateStatus: submissionUpdateStatus,
  },
  runTransaction: async <T>(
    fn: (tx: {
      assessmentProblem: { findFirst: typeof txAssessmentProblemFindFirst };
      contestProblem: { findFirst: typeof txContestProblemFindFirst };
    }) => Promise<T>,
  ): Promise<T> =>
    fn({
      assessmentProblem: { findFirst: txAssessmentProblemFindFirst },
      contestProblem: { findFirst: txContestProblemFindFirst },
    }),
}));

vi.mock("../../../packages/domain/src/shared/storage-singleton", () => ({
  storage: () => storageRef.client,
  __setStorageClientForTests: (c: unknown) => {
    storageRef.client = c as typeof storageRef.client;
  },
}));

import { ConflictError, submissionDomain } from "@nojv/domain";

const { createQueuedSubmissionRecord } = submissionDomain;

const fakeActor = {
  userId: "usr_student",
  username: "student",
  platformRole: "student" as const,
  displayName: "Student One",
  email: "student@example.com",
};

function setupPracticeDefaults(problemType: "full_source" | "multi_file" | "special_env") {
  storageRef.client = createInMemoryStorage() as unknown as typeof storageRef.client;

  const user = {
    id: fakeActor.userId,
    name: fakeActor.displayName,
    email: fakeActor.email,
    username: fakeActor.username,
    platformRole: fakeActor.platformRole,
  };
  userFindById.mockResolvedValue(user);
  userUpdate.mockResolvedValue(user);
  userCreate.mockResolvedValue(user);
  examSessionFindActiveForUser.mockResolvedValue(null);
  txAssessmentProblemFindFirst.mockResolvedValue(null);
  txContestProblemFindFirst.mockResolvedValue(null);

  problemFindById.mockResolvedValue({
    id: "prob_writepath",
    authorId: "usr_teacher",
    visibility: "public",
    type: problemType,
    advancedRequiredPaths: [],
  });

  workspaceFindByProblemId.mockResolvedValue(
    problemType === "multi_file"
      ? [{ language: "python", path: "main.py", visibility: "editable", content: "" }]
      : [],
  );

  submissionCreate.mockImplementation(async (data: unknown) => ({
    id: (data as { id?: string }).id ?? "sub_unknown",
    ...(data as object),
  }));
  submissionUpdateStatus.mockImplementation(async (id: string, status: string) => ({
    id,
    status,
  }));
}

const baseDraft = {
  problemId: "prob_writepath",
  language: "python" as const,
  sourceCode: "print('hi')",
  sampleOnly: false,
};

describe("createQueuedSubmissionRecord — write path → S3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("single-file submission writes one source object at main.<ext>", async () => {
    setupPracticeDefaults("full_source");

    const row = await createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1");

    expect(submissionCreate).toHaveBeenCalledTimes(1);
    const createArg = submissionCreate.mock.calls[0]![0] as {
      id: string;
      sourceStoragePrefix: string;
      ipAddress: string | null;
      status: string;
    };
    expect(createArg.id).toBeTruthy();
    expect(createArg.status).toBe("pending_upload");
    expect(createArg.sourceStoragePrefix).toBe(`submissions/${createArg.id}/sources/`);
    expect(createArg.ipAddress).toBe("127.0.0.1");
    expect(submissionUpdateStatus).toHaveBeenCalledWith(createArg.id, "queued");

    expect((row as { id: string }).id).toBe(createArg.id);

    const store = (storageRef.client as unknown as { store: Map<string, string> }).store;
    expect([...store.keys()]).toEqual([`submissions/${createArg.id}/sources/main.py`]);
    expect(store.get(`submissions/${createArg.id}/sources/main.py`)).toBe("print('hi')");
  });

  it("multi-file submission writes one source object per file", async () => {
    setupPracticeDefaults("multi_file");

    await createQueuedSubmissionRecord(
      {
        ...baseDraft,
        sourceFiles: [
          { path: "main.py", content: "from util import f\nf()" },
          { path: "util.py", content: "def f(): pass" },
          { path: "lib/helpers.py", content: "# nested" },
        ],
      },
      fakeActor,
      "127.0.0.1",
    );

    const createArg = submissionCreate.mock.calls[0]![0] as { id: string };
    const store = (storageRef.client as unknown as { store: Map<string, string> }).store;
    expect([...store.keys()].sort((a, b) => Number(a > b) - Number(a < b))).toEqual([
      `submissions/${createArg.id}/sources/lib/helpers.py`,
      `submissions/${createArg.id}/sources/main.py`,
      `submissions/${createArg.id}/sources/util.py`,
    ]);
  });

  it("special_env multi-file submission writes all uploaded files", async () => {
    setupPracticeDefaults("special_env");

    await createQueuedSubmissionRecord(
      {
        ...baseDraft,
        sourceFiles: [
          { path: "src/main.c", content: "int main(){}" },
          { path: "Makefile", content: "all:\n\tgcc -o app src/main.c" },
        ],
      },
      fakeActor,
      "127.0.0.1",
    );

    const createArg = submissionCreate.mock.calls[0]![0] as { id: string };
    const store = (storageRef.client as unknown as { store: Map<string, string> }).store;
    expect([...store.keys()].sort((a, b) => Number(a > b) - Number(a < b))).toEqual([
      `submissions/${createArg.id}/sources/Makefile`,
      `submissions/${createArg.id}/sources/src/main.c`,
    ]);
  });

  it("rejects a submission with a parent-traversal path before any S3 write", async () => {
    setupPracticeDefaults("multi_file");

    await expect(
      createQueuedSubmissionRecord(
        {
          ...baseDraft,
          sourceFiles: [{ path: "../etc/passwd", content: "root:x:0:0" }],
        },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toThrow();

    expect(submissionCreate).not.toHaveBeenCalled();
    const store = (storageRef.client as unknown as { store: Map<string, string> }).store;
    expect(store.size).toBe(0);
  });

  it("rejects a submission exceeding 1 MB total before any S3 write", async () => {
    setupPracticeDefaults("multi_file");

    const half = "x".repeat(600_000);

    await expect(
      createQueuedSubmissionRecord(
        {
          ...baseDraft,
          sourceFiles: [
            { path: "main.py", content: half },
            { path: "lib.py", content: half },
          ],
        },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(submissionCreate).not.toHaveBeenCalled();
    const store = (storageRef.client as unknown as { store: Map<string, string> }).store;
    expect(store.size).toBe(0);
  });

  it("when S3 put fails post-commit, the submission row is marked system_error and the error is rethrown", async () => {
    setupPracticeDefaults("multi_file");

    const inMem = storageRef.client as unknown as {
      failOnPut: (n: number) => void;
      store: Map<string, string>;
    };
    inMem.failOnPut(1);

    await expect(
      createQueuedSubmissionRecord(
        {
          ...baseDraft,
          sourceFiles: [
            { path: "main.py", content: "ok" },
            { path: "util.py", content: "boom" },
          ],
        },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toThrow(/Simulated storage failure/);

    expect(submissionCreate).toHaveBeenCalledTimes(1);
    expect(submissionUpdateStatus).toHaveBeenCalledTimes(1);
    const createdId = (submissionCreate.mock.calls[0]![0] as { id: string }).id;
    expect(submissionUpdateStatus).toHaveBeenCalledWith(createdId, "system_error");
  });

  it("on partial-put failure, partially-uploaded blobs are wiped BEFORE the system_error status update", async () => {
    setupPracticeDefaults("multi_file");

    const inMem = storageRef.client as unknown as {
      failOnPut: (n: number) => void;
      store: Map<string, string>;
      send: ReturnType<typeof vi.fn>;
    };
    inMem.failOnPut(1);

    let deleteCalledAt: number | null = null;
    let statusUpdatedAt: number | null = null;
    let tick = 0;
    const origSend = inMem.send;
    inMem.send = vi.fn(async (cmd: { constructor: { name: string }; input: unknown }) => {
      if (
        cmd.constructor.name === "DeleteObjectsCommand" ||
        cmd.constructor.name === "DeleteObjectCommand"
      ) {
        tick += 1;
        deleteCalledAt = tick;
      }
      return origSend(cmd);
    }) as typeof origSend;
    submissionUpdateStatus.mockImplementation(async () => {
      tick += 1;
      statusUpdatedAt = tick;
      return {};
    });

    await expect(
      createQueuedSubmissionRecord(
        {
          ...baseDraft,
          sourceFiles: [
            { path: "main.py", content: "ok" },
            { path: "util.py", content: "boom" },
          ],
        },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toThrow(/Simulated storage failure/);

    expect(inMem.store.size).toBe(0);
    expect(deleteCalledAt).not.toBeNull();
    expect(statusUpdatedAt).not.toBeNull();
    expect(deleteCalledAt!).toBeLessThan(statusUpdatedAt!);
  });

  it("if orphan cleanup ALSO fails, the original storage error still propagates and status update still attempted", async () => {
    setupPracticeDefaults("multi_file");

    const inMem = storageRef.client as unknown as {
      failOnPut: (n: number) => void;
      failNext: (pred: (commandName: string) => boolean) => void;
    };
    inMem.failOnPut(1);
    inMem.failNext((name) => name === "ListObjectsV2Command");

    await expect(
      createQueuedSubmissionRecord(
        {
          ...baseDraft,
          sourceFiles: [
            { path: "main.py", content: "ok" },
            { path: "util.py", content: "boom" },
          ],
        },
        fakeActor,
        "127.0.0.1",
      ),
    ).rejects.toThrow(/Simulated storage failure on PutObjectCommand/);

    expect(submissionUpdateStatus).toHaveBeenCalledTimes(1);
    const createdId = (submissionCreate.mock.calls[0]![0] as { id: string }).id;
    expect(submissionUpdateStatus).toHaveBeenCalledWith(createdId, "system_error");
  });

  it("if the system_error fallback ALSO fails, the original storage error still propagates", async () => {
    setupPracticeDefaults("full_source");

    const inMem = storageRef.client as unknown as { failOnPut: (n: number) => void };
    inMem.failOnPut(0); // first (only) put fails
    submissionUpdateStatus.mockRejectedValueOnce(new Error("DB down"));

    await expect(
      createQueuedSubmissionRecord(baseDraft, fakeActor, "127.0.0.1"),
    ).rejects.toThrow(/Simulated storage failure/); // original error wins, not "DB down"

    expect(submissionUpdateStatus).toHaveBeenCalledTimes(1);
  });
});

void submissionSourceKey;
