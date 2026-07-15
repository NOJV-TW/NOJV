import { describe, expect, it, vi } from "vitest";

import {
  getSubmissionSources,
  getVerdictDetail,
  planSubmissionSources,
  putSubmissionSourcePlan,
  putVerdictDetail,
} from "../../../packages/storage/src/submission";

function fakeClient() {
  const objects = new Map<string, Buffer>();
  const send = vi.fn(async (command: { constructor: { name: string }; input: unknown }) => {
    const input = command.input as Record<string, unknown>;
    if (command.constructor.name === "PutObjectCommand") {
      const key = input.Key as string;
      if (input.IfNoneMatch !== "*" || objects.has(key)) {
        const error = new Error("PreconditionFailed");
        error.name = "PreconditionFailed";
        throw error;
      }
      objects.set(key, Buffer.from(input.Body as Buffer));
      return {};
    }
    if (command.constructor.name === "GetObjectCommand") {
      const body = objects.get(input.Key as string);
      if (!body) {
        const error = new Error("NoSuchKey");
        error.name = "NoSuchKey";
        throw error;
      }
      return {
        Body: (async function* () {
          yield body;
        })(),
      };
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  });
  return { client: { send } as never, objects };
}

describe("versioned submission storage", () => {
  const generation = "018f4f5d-27b5-7d2e-9f5a-7f4bc2b4a001";

  it("plans every immutable key before the first write and persists a verified manifest", async () => {
    const fake = fakeClient();
    const plan = planSubmissionSources("sub_1", generation, [
      { path: "main.cpp", content: "int main() {}" },
      { path: "lib/util.cpp", content: "void util();" },
    ]);

    expect(plan.pointers.map(({ key }) => key)).toEqual([
      `submissions/sub_1/source-generations/${generation}/files/main.cpp`,
      `submissions/sub_1/source-generations/${generation}/files/lib/util.cpp`,
      `submissions/sub_1/source-generations/${generation}/manifest.json`,
    ]);

    const manifest = await putSubmissionSourcePlan(fake.client, plan);
    await expect(getSubmissionSources(fake.client, manifest)).resolves.toEqual([
      { path: "lib/util.cpp", content: "void util();" },
      { path: "main.cpp", content: "int main() {}" },
    ]);
  });

  it("does not derive or list source keys when reading", async () => {
    const fake = fakeClient();
    const plan = planSubmissionSources("sub_1", generation, [
      { path: "main.cpp", content: "winner" },
    ]);
    const manifest = await putSubmissionSourcePlan(fake.client, plan);
    fake.objects.set("submissions/sub_1/sources/main.cpp", Buffer.from("legacy stale"));

    await expect(getSubmissionSources(fake.client, manifest)).resolves.toEqual([
      { path: "main.cpp", content: "winner" },
    ]);
  });

  it("writes each judge result to its run key and reads only the persisted pointer", async () => {
    const fake = fakeClient();
    const first = await putVerdictDetail(fake.client, "sub_1", "run-1", {
      verdict: "accepted",
    });
    const second = await putVerdictDetail(fake.client, "sub_1", "run-2", {
      verdict: "wrong_answer",
    });

    expect(first.key).toBe("submissions/sub_1/judge-runs/run-1/verdict-detail.json");
    expect(second.key).toBe("submissions/sub_1/judge-runs/run-2/verdict-detail.json");
    await expect(getVerdictDetail(fake.client, first)).resolves.toEqual({
      verdict: "accepted",
    });
  });
});
