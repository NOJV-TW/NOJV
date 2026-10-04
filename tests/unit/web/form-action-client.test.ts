import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$app/forms", () => ({ deserialize: (text: string): unknown => JSON.parse(text) }));

const { postProblemAction, submitFormAction } = await import("$lib/utils/actions");

function respondWith(result: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(result), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitFormAction", () => {
  it("posts the fields and returns the success data", async () => {
    const fetchMock = respondWith({ type: "success", status: 200, data: { id: "prob_2" } });

    await expect(submitFormAction("?/publish", { confirm: "yes" })).resolves.toEqual({
      id: "prob_2",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("?/publish");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("confirm")).toBe("yes");
  });

  it("rejects an HTTP-200 action failure with the server's error", async () => {
    respondWith({
      type: "failure",
      status: 409,
      data: { error: "Published problems cannot change type." },
    });

    await expect(submitFormAction("?/updateWorkspace")).rejects.toThrow(
      "Published problems cannot change type.",
    );
  });

  it("rejects a thrown action error with its message", async () => {
    respondWith({ type: "error", status: 400, error: { message: "Missing problem id" } });

    await expect(submitFormAction("?/updateWorkspace")).rejects.toThrow("Missing problem id");
  });

  it("treats a redirect as a failure", async () => {
    respondWith({ type: "redirect", status: 303, location: "/login" });

    await expect(submitFormAction("?/updateWorkspace")).rejects.toThrow(Error);
  });
});

describe("postProblemAction", () => {
  it("targets the problem edit action and surfaces failures", async () => {
    const fetchMock = respondWith({
      type: "failure",
      status: 400,
      data: { error: "weight: Too small" },
    });

    await expect(
      postProblemAction("prob_1", "updateTestcaseSet", { setId: "set_1" }),
    ).rejects.toThrow("weight: Too small");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/problems/prob_1/edit?/updateTestcaseSet");
  });
});
