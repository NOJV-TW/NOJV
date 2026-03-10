import { describe, expect, it } from "vitest";

import {
  attachProblemToCourseMutation,
  createCourseMutation,
  createProblemMutation,
  createProblemTestcaseSetMutation,
  enrollCourseMemberMutation,
  joinCourseMutation,
  publishCourseAssessmentMutation
} from "../src/lib/client/course-management-client";

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status
  });
}

function createFetcherRecorder(responseBody: unknown, status = 200) {
  const calls: { init: RequestInit | undefined; input: string }[] = [];

  return {
    calls,
    fetcher: (input: string, init?: RequestInit) => {
      calls.push({ init, input });

      return Promise.resolve(createJsonResponse(responseBody, status));
    }
  };
}

describe("course management client mutations", () => {
  it("sends course creation requests", async () => {
    const { calls, fetcher } = createFetcherRecorder({ slug: "compiler-design-2026" }, 201);

    await createCourseMutation(
      {
        description: "Compiler construction course.",
        locale: "zh-TW",
        slug: "compiler-design-2026",
        title: "Compiler Design"
      },
      fetcher
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/courses");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        description: "Compiler construction course.",
        locale: "zh-TW",
        slug: "compiler-design-2026",
        title: "Compiler Design"
      })
    );
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json"
    });
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("sends problem authoring requests", async () => {
    const { calls, fetcher } = createFetcherRecorder({ slug: "compiler-intro" }, 201);

    await createProblemMutation(
      {
        difficulty: "easy",
        inputFormat: "",
        judgeType: "standard",
        outputFormat: "",
        slug: "compiler-intro",
        statement: "Write a recursive descent parser for the input grammar.",
        summary: "",
        tags: [],
        title: "Compiler Intro",
        visibility: "public"
      },
      fetcher
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/problems");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        difficulty: "easy",
        inputFormat: "",
        judgeType: "standard",
        outputFormat: "",
        slug: "compiler-intro",
        statement: "Write a recursive descent parser for the input grammar.",
        summary: "",
        tags: [],
        title: "Compiler Intro",
        visibility: "public"
      })
    );
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json"
    });
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("targets the course join endpoint with join payloads", async () => {
    const { calls, fetcher } = createFetcherRecorder({ status: "joined" });

    await joinCourseMutation(
      {
        courseSlug: "os-lab-spring-2026",
        joinMethod: "join_code",
        joinToken: "OSLAB2026"
      },
      fetcher
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/courses/os-lab-spring-2026/join");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        courseSlug: "os-lab-spring-2026",
        joinMethod: "join_code",
        joinToken: "OSLAB2026"
      })
    );
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json"
    });
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("targets the course membership endpoint for manual enrollment", async () => {
    const { calls, fetcher } = createFetcherRecorder({ status: "enrolled" }, 201);

    await enrollCourseMemberMutation(
      {
        courseSlug: "os-lab-spring-2026",
        displayName: "Carol Tsai",
        email: "carol@nojv.local",
        handle: "stu_carol",
        role: "student"
      },
      fetcher
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/courses/os-lab-spring-2026/members");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        courseSlug: "os-lab-spring-2026",
        displayName: "Carol Tsai",
        email: "carol@nojv.local",
        handle: "stu_carol",
        role: "student"
      })
    );
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json"
    });
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("targets the course problem endpoint for problem attachment", async () => {
    const { calls, fetcher } = createFetcherRecorder({ status: "attached" }, 201);

    await attachProblemToCourseMutation(
      {
        courseSlug: "os-lab-spring-2026",
        problemSlug: "compiler-intro"
      },
      fetcher
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/courses/os-lab-spring-2026/problems");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        courseSlug: "os-lab-spring-2026",
        problemSlug: "compiler-intro"
      })
    );
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json"
    });
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("targets the course assessment endpoint for publishing assessments", async () => {
    const { calls, fetcher } = createFetcherRecorder({ status: "published" }, 201);

    await publishCourseAssessmentMutation(
      {
        closesAt: "2026-03-25T15:00:00.000Z",
        courseSlug: "os-lab-spring-2026",
        dueAt: "2026-03-23T15:00:00.000Z",
        ipLockEnabled: false,
        opensAt: "2026-03-17T09:00:00.000Z",
        pageLockEnabled: false,
        problemSlugs: ["compiler-intro"],
        slug: "hw1-parser",
        summary: "First compiler homework.",
        title: "Homework 1",
        type: "assignment"
      },
      fetcher
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/courses/os-lab-spring-2026/assessments");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        closesAt: "2026-03-25T15:00:00.000Z",
        courseSlug: "os-lab-spring-2026",
        dueAt: "2026-03-23T15:00:00.000Z",
        ipLockEnabled: false,
        opensAt: "2026-03-17T09:00:00.000Z",
        pageLockEnabled: false,
        problemSlugs: ["compiler-intro"],
        slug: "hw1-parser",
        summary: "First compiler homework.",
        title: "Homework 1",
        type: "assignment"
      })
    );
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json"
    });
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("targets the testcase-set endpoint for authored problems", async () => {
    const { calls, fetcher } = createFetcherRecorder({ status: "created" }, 201);

    await createProblemTestcaseSetMutation(
      "compiler-intro",
      {
        cases: [
          {
            expectedStdout: "3\n",
            stdin: "1 2\n"
          }
        ],
        isHidden: false,
        name: "Samples",
        weight: 1
      },
      fetcher
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("/api/problems/compiler-intro/testcase-sets");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        cases: [
          {
            expectedStdout: "3\n",
            stdin: "1 2\n"
          }
        ],
        isHidden: false,
        name: "Samples",
        weight: 1
      })
    );
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json"
    });
    expect(calls[0]?.init?.method).toBe("POST");
  });
});
