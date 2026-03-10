import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError } from "../src/lib/server/api-errors";

const createProblemTestcaseSetRecord = vi.fn();

interface MockActor {
  displayName: string;
  email: string;
  handle: string;
  platformRole: "admin" | "student" | "teacher";
  userId: string;
}

let currentActor: MockActor = {
  displayName: "Teacher Amelia",
  email: "amelia@nojv.local",
  handle: "teacher_amelia",
  platformRole: "teacher",
  userId: "usr_teacher_amelia"
};

vi.mock("@/lib/server/actor-context", () => ({
  getActorContext: vi.fn(() => currentActor)
}));

vi.mock("@/lib/server/data-access/problems", () => ({
  createProblemTestcaseSetRecord
}));

describe("problem testcase authoring routes", () => {
  beforeEach(() => {
    currentActor = {
      displayName: "Teacher Amelia",
      email: "amelia@nojv.local",
      handle: "teacher_amelia",
      platformRole: "teacher",
      userId: "usr_teacher_amelia"
    };
    vi.clearAllMocks();
  });

  it("allows teachers to create testcase sets for authored problems", async () => {
    createProblemTestcaseSetRecord.mockResolvedValue({
      caseCount: 2,
      id: "tcs_hidden_01",
      isHidden: true,
      name: "Hidden Set"
    });

    const { POST } = await import("../src/app/api/problems/[slug]/testcase-sets/route");
    const response = await POST(
      new Request("http://localhost/api/problems/warmup-sum/testcase-sets", {
        body: JSON.stringify({
          cases: [
            {
              expectedStdout: "3\n",
              stdin: "1 2\n"
            },
            {
              expectedStdout: "300\n",
              stdin: "100 200\n"
            }
          ],
          isHidden: true,
          name: "Hidden Set",
          weight: 1
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }),
      {
        params: Promise.resolve({
          slug: "warmup-sum"
        })
      }
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      caseCount: 2,
      id: "tcs_hidden_01",
      isHidden: true,
      name: "Hidden Set"
    });
  });

  it("blocks students from creating testcase sets", async () => {
    currentActor = {
      displayName: "Student Bob",
      email: "bob@nojv.local",
      handle: "stu_bob",
      platformRole: "student",
      userId: "usr_student_bob"
    };
    createProblemTestcaseSetRecord.mockRejectedValue(
      new ForbiddenError("Problem testcases can only be managed by the author or an admin.")
    );

    const { POST } = await import("../src/app/api/problems/[slug]/testcase-sets/route");
    const response = await POST(
      new Request("http://localhost/api/problems/warmup-sum/testcase-sets", {
        body: JSON.stringify({
          cases: [
            {
              expectedStdout: "3\n",
              stdin: "1 2\n"
            }
          ],
          isHidden: false,
          name: "Samples",
          weight: 1
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }),
      {
        params: Promise.resolve({
          slug: "warmup-sum"
        })
      }
    );

    expect(response.status).toBe(403);
  });

  it("maps duplicate testcase-set names to a conflict response", async () => {
    createProblemTestcaseSetRecord.mockRejectedValue(
      new ConflictError('Unique constraint failed on the fields: ("problemId", "name")')
    );

    const { POST } = await import("../src/app/api/problems/[slug]/testcase-sets/route");
    const response = await POST(
      new Request("http://localhost/api/problems/warmup-sum/testcase-sets", {
        body: JSON.stringify({
          cases: [
            {
              expectedStdout: "3\n",
              stdin: "1 2\n"
            }
          ],
          isHidden: true,
          name: "Hidden Set",
          weight: 1
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      }),
      {
        params: Promise.resolve({
          slug: "warmup-sum"
        })
      }
    );

    expect(response.status).toBe(409);
  });
});
