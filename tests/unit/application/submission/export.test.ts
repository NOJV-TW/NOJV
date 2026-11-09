import JSZip from "jszip";
import { setTimeout as delay } from "node:timers/promises";
import { beforeEach, expect, it, vi } from "vitest";

const { list, sources, submission } = vi.hoisted(() => ({
  list: vi.fn(),
  sources: vi.fn(),
  submission: vi.fn(),
}));
vi.mock("../../../../packages/application/src/submission/history", () => ({
  listContextSubmissionsPaged: list,
}));
vi.mock("../../../../packages/application/src/submission/details", () => ({
  getSubmissionById: submission,
  readSubmissionSources: sources,
}));
import { exportContextSubmissions } from "../../../../packages/application/src/submission/export";

const actor = {
  userId: "teacher",
  username: "teacher",
  platformRole: "teacher" as const,
  displayName: "Teacher",
  email: "teacher@example.test",
};
const context = { type: "exam" as const, id: "exam1" };
const row = (id: string) => ({
  id,
  user: { id: "student1", username: "student", name: '王, "同學"\n二' },
  problem: { id: "problem1", displayId: 1, title: "=1+1" },
  createdAt: "2026-11-09T00:00:00.000Z",
  language: "cpp",
  status: "wrong_answer",
  score: 0,
  runtimeMs: 10,
  memoryKb: 100,
});
beforeEach(() => {
  vi.clearAllMocks();
  submission.mockResolvedValue({ sourceStorage: {} });
  list.mockResolvedValue({ items: [row("sub1")], totalPages: 1, snapshot: "anchor" });
  sources.mockResolvedValue([{ path: "src/main.cpp", content: "int main() {}\n" }]);
});

it.each(["assignment", "exam", "contest"] as const)(
  "exports every page of %s using the original snapshot",
  async (type) => {
    list
      .mockResolvedValueOnce({
        items: Array.from({ length: 50 }, (_, i) => row(`sub${i}`)),
        totalPages: 2,
        snapshot: "anchor",
      })
      .mockResolvedValueOnce({ items: [row("sub50")], totalPages: 2, snapshot: "anchor" });
    const result = await exportContextSubmissions(actor, { ...context, type }, "csv");
    const bytes = new Uint8Array(await new Response(result.body).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv.match(/"sub\d+"/g)).toHaveLength(51);
    expect(csv).toContain('"王, ""同學""\n二"');
    expect(csv).toContain('"\'=1+1"');
    expect(list).toHaveBeenLastCalledWith({
      actor,
      context: { ...context, type },
      limit: 50,
      page: 2,
      snapshot: "anchor",
    });
    expect(sources).not.toHaveBeenCalled();
  },
);

it("preserves nested source files and separates attempts under student/problem/submission", async () => {
  list.mockResolvedValue({
    items: [row("sub1"), row("sub2")],
    totalPages: 1,
    snapshot: "anchor",
  });
  const { body } = await exportContextSubmissions(actor, context, "zip");
  const zip = await JSZip.loadAsync(await new Response(body).arrayBuffer());
  const files = Object.values(zip.files).filter((file) => !file.dir);
  expect(files.map((file) => file.name)).toEqual([
    "student1/problem1/sub1/src/main.cpp",
    "student1/problem1/sub2/src/main.cpp",
  ]);
  expect(await files[0]!.async("string")).toBe("int main() {}\n");
});

it.each(["../escape", "/absolute", "back\\slash", "a/../../escape"])(
  "rejects unsafe source path %s",
  async (path) => {
    sources.mockResolvedValue([{ path, content: "bad" }]);
    const { body } = await exportContextSubmissions(actor, context, "zip");
    await expect(new Response(body).arrayBuffer()).rejects.toThrow();
  },
);

it.each(["all", "csv", "zip"] as const)(
  "rejects unauthorized %s before any source read",
  async (format) => {
    list.mockRejectedValue(new Error("Not authorized"));
    await expect(exportContextSubmissions(actor, context, format)).rejects.toThrow(
      "Not authorized",
    );
    expect(sources).not.toHaveBeenCalled();
  },
);

it("does not silently skip a source storage failure", async () => {
  sources.mockRejectedValue(new Error("Source missing"));
  const { body } = await exportContextSubmissions(actor, context, "zip");
  await expect(new Response(body).arrayBuffer()).rejects.toThrow("Source missing");
});

it("stops source reads after cancellation", async () => {
  list.mockResolvedValue({
    items: Array.from({ length: 50 }, (_, i) => row(`sub${i}`)),
    totalPages: 1,
    snapshot: "anchor",
  });
  const { body } = await exportContextSubmissions(actor, context, "zip");
  await body.cancel();
  await delay(30);
  expect(sources.mock.calls.length).toBeLessThanOrEqual(1);
});

it("exports an empty activity as a valid empty ZIP or header-only CSV", async () => {
  list.mockResolvedValue({ items: [], totalPages: 1, snapshot: "anchor" });
  const zipResult = await exportContextSubmissions(actor, context, "zip");
  expect(
    Object.keys(
      (await JSZip.loadAsync(await new Response(zipResult.body).arrayBuffer())).files,
    ),
  ).toEqual([]);
  const csvResult = await exportContextSubmissions(actor, context, "csv");
  expect((await new Response(csvResult.body).text()).split("\r\n")).toHaveLength(2);
});

it("includes an explicit marker for submissions whose source upload never completed", async () => {
  list.mockResolvedValue({
    items: [row("failed"), row("normal")],
    totalPages: 1,
    snapshot: "anchor",
  });
  submission
    .mockResolvedValueOnce({ sourceStorage: null })
    .mockResolvedValueOnce({ sourceStorage: {} });
  const { body } = await exportContextSubmissions(actor, context, "zip");
  const zip = await JSZip.loadAsync(await new Response(body).arrayBuffer());
  expect(
    await zip.file("student1/problem1/failed/SOURCE_UNAVAILABLE.txt")!.async("string"),
  ).toContain("has no stored source files");
  expect(await zip.file("student1/problem1/normal/src/main.cpp")!.async("string")).toBe(
    "int main() {}\n",
  );
  expect(sources).toHaveBeenCalledTimes(1);
});

it("bundles CSV and source files in one ZIP for the default export", async () => {
  const { body, fileName } = await exportContextSubmissions(actor, context, "all");
  expect(fileName).toBe("exam-exam1-submissions.zip");
  const zip = await JSZip.loadAsync(await new Response(body).arrayBuffer());
  expect(await zip.file("submissions.csv")!.async("string")).toContain('"sub1"');
  expect(await zip.file("student1/problem1/sub1/src/main.cpp")!.async("string")).toBe(
    "int main() {}\n",
  );
});
