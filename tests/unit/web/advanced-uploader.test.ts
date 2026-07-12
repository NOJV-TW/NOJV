import { describe, expect, it } from "vitest";

import { MAX_SUBMISSION_SOURCE_FILE_CHARS } from "@nojv/core";
import { stageUploadedFile } from "$lib/components/features/problem/advanced/AdvancedUploader.svelte";

describe("AdvancedUploader submission limits", () => {
  it("accepts the server's exact per-file limit", async () => {
    const file = new File(["x".repeat(MAX_SUBMISSION_SOURCE_FILE_CHARS)], "main.py");

    await expect(stageUploadedFile(file, [])).resolves.toMatchObject({ ok: true });
  });

  it("rejects one character beyond the server's per-file limit", async () => {
    const file = new File(["x".repeat(MAX_SUBMISSION_SOURCE_FILE_CHARS + 1)], "main.py");

    await expect(stageUploadedFile(file, [])).resolves.toMatchObject({ ok: false });
  });

  it("rejects content whose JSON encoding exceeds the shared request-body limit", async () => {
    const file = new File(["\0".repeat(400_000)], "payload.txt");

    await expect(stageUploadedFile(file, [])).resolves.toMatchObject({ ok: false });
  });
});
