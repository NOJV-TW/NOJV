import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import {
  cleanupUnreferencedStorageObject,
  courseDomain,
  problemDomain,
  userDomain,
} from "@nojv/application";
import { prismaAdapterClient as db, runTransaction } from "@nojv/db";
import * as objects from "@nojv/storage";
import {
  finalizeUploadedImage,
  reserveUploadedImage,
} from "../../../packages/application/src/shared/uploaded-image";
import { createTestCourse, createTestProblem, createTestUser } from "../../fixtures/factories";

const LIMIT = 50 * 1024 * 1024;
const actorOf = (user: {
  id: string;
  username: string | null;
  platformRole: "admin" | "teacher" | "student";
}) => {
  if (!user.username) throw new Error("Test actor must have a username.");
  return { userId: user.id, username: user.username, platformRole: user.platformRole };
};
const pointerOf = ({ key, size, sha256 }: { key: string; size: number; sha256: string }) => ({
  key,
  size,
  sha256,
});

async function seedUsage(
  owner: { userId: string; kind: "content" } | { problemId: string; kind: "problem" },
  size: number,
) {
  return db.uploadedImage.create({
    data: {
      ...owner,
      key: `quota/${"userId" in owner ? owner.userId : owner.problemId}`,
      size,
      sha256: "a".repeat(64),
      contentType: "image/png",
      ready: true,
    },
  });
}

describe("owned image quota and durable cleanup", () => {
  it("includes legacy bytes before any new user content reservation", async () => {
    const user = await createTestUser();
    await seedUsage({ userId: user.id, kind: "content" }, LIMIT - 8);
    const legacy = `users/${user.id}/images/legacy.png`;
    await objects.putImmutableObject(
      objects.createStorageClient(),
      legacy,
      Buffer.from("1234567"),
    );
    await expect(
      userDomain.uploadUserContentImage(user.id, Buffer.from("12"), "image/png"),
    ).rejects.toThrow("budget exceeded");
    expect(
      await db.uploadedImage.findUnique({
        where: { userId_key: { userId: user.id, key: legacy } },
      }),
    ).toMatchObject({ size: 7, ready: true });
    expect(await db.uploadedImage.count({ where: { userId: user.id, ready: false } })).toBe(0);
  });

  it("counts in-flight reservations and admits only available concurrent bytes", async () => {
    const user = await createTestUser({ imageInventoryComplete: true });
    await seedUsage({ userId: user.id, kind: "content" }, LIMIT - 5);
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const allowed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = objects.putImmutableObject;
    const write = vi
      .spyOn(objects, "putImmutableObject")
      .mockImplementation(async (...args) => {
        entered();
        await allowed;
        return original(...args);
      });
    const first = userDomain.uploadUserContentImage(user.id, Buffer.from("123"), "image/png");
    await writing;
    try {
      await expect(
        userDomain.uploadUserContentImage(user.id, Buffer.from("456"), "image/png"),
      ).rejects.toThrow("budget exceeded");
      expect(await db.uploadedImage.count({ where: { userId: user.id, ready: false } })).toBe(
        1,
      );
    } finally {
      release();
      await first;
      write.mockRestore();
    }
    const usage = await db.uploadedImage.aggregate({
      where: { userId: user.id },
      _sum: { size: true },
    });
    expect(usage._sum.size).toBe(LIMIT - 2);
  });

  it("does not finalize a leased cleanup guard and releases pending quota only after storage cleanup", async () => {
    const user = await createTestUser({ imageInventoryComplete: true });
    const pointer = objects.storagePointerFor(
      `users/${user.id}/images/pending.png`,
      Buffer.from("123"),
    );
    const row = await runTransaction((tx) =>
      reserveUploadedImage(tx, {
        pointer,
        contentType: "image/png",
        userId: user.id,
        kind: "content",
      }),
    );
    const dedupeKey = createHash("sha256").update(pointer.key).digest("hex");
    await db.durableWork.update({
      where: { kind_dedupeKey: { kind: "storage.object.cleanup", dedupeKey } },
      data: {
        status: "leased",
        attempt: 1,
        leaseOwner: "test",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(runTransaction((tx) => finalizeUploadedImage(tx, row.id))).rejects.toThrow(
      "no longer pending",
    );
    await objects.putImmutableObject(
      objects.createStorageClient(),
      pointer.key,
      Buffer.from("123"),
    );
    const deletion = vi
      .spyOn(objects, "deleteBlob")
      .mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(cleanupUnreferencedStorageObject({ pointer })).rejects.toThrow("AccessDenied");
    deletion.mockRestore();
    expect(await db.uploadedImage.findUnique({ where: { id: row.id } })).toMatchObject({
      ready: false,
      cleanupStarted: true,
      size: 3,
    });
    await expect(runTransaction((tx) => finalizeUploadedImage(tx, row.id))).rejects.toThrow(
      "expired",
    );
    await cleanupUnreferencedStorageObject({ pointer });
    expect(await db.uploadedImage.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("preserves grace when deleting an owner with an in-flight write", async () => {
    const user = await createTestUser({
      imageInventoryComplete: true,
      avatarInventoryComplete: true,
    });
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const allowed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = objects.putImmutableObject;
    const write = vi
      .spyOn(objects, "putImmutableObject")
      .mockImplementation(async (...args) => {
        entered();
        await allowed;
        return original(...args);
      });
    const first = userDomain.uploadUserContentImage(user.id, Buffer.from("123"), "image/png");
    const rejected = expect(first).rejects.toThrow("unavailable");
    await writing;
    const row = await db.uploadedImage.findFirstOrThrow({
      where: { userId: user.id, ready: false },
    });
    try {
      await expect(userDomain.deleteUser(true, user.id)).resolves.toMatchObject({
        mode: "hard",
      });
      const guard = await db.durableWork.findFirstOrThrow({
        where: { kind: "storage.object.cleanup" },
      });
      expect(guard.status).toBe("pending");
      expect(guard.availableAt.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
    } finally {
      release();
      await rejected;
      write.mockRestore();
    }
    await expect(
      objects.getVerifiedObject(objects.createStorageClient(), pointerOf(row)),
    ).resolves.toEqual(Buffer.from("123"));
    await cleanupUnreferencedStorageObject({ pointer: pointerOf(row) });
    await expect(
      objects.getVerifiedObject(objects.createStorageClient(), pointerOf(row)),
    ).rejects.toMatchObject({ name: "NoSuchKey" });
  });

  it.each(["testcase", "workspace", "judge", "bundle"] as const)(
    "checks shared image + binary budget at the %s commit",
    async (kind) => {
      const author = await createTestUser({ platformRole: "teacher" });
      const problem = await createTestProblem({
        authorId: author.id,
        status: "draft",
        visibility: "private",
        imageInventoryComplete: true,
      });
      await seedUsage({ problemId: problem.id, kind: "problem" }, LIMIT - 5);
      const actor = actorOf(author);
      const zip = new JSZip();
      zip.file("testcases/1/input.txt", "123456");
      const write =
        kind === "testcase"
          ? problemDomain.createProblemTestcaseSetRecord(actor, problem.id, {
              description: "",
              weight: 1,
              cases: [{ input: "12", output: "3" }],
            })
          : kind === "workspace"
            ? problemDomain.updateProblemWorkspace(actor, problem.id, {
                files: [
                  {
                    language: "python",
                    path: "main.py",
                    content: "12",
                    description: "",
                    visibility: "editable",
                  },
                ],
              })
            : kind === "judge"
              ? problemDomain.saveProblemJudgeConfig(actor, problem.id, {
                  judgeConfig: { type: "checker", checkerLanguage: "python" },
                  checkerScript: "12",
                })
              : problemDomain.importBundle(
                  actor,
                  problem.id,
                  await zip.generateAsync({ type: "nodebuffer" }),
                );
      await expect(write).rejects.toThrow("budget exceeded");
      expect(
        (await db.problem.findUniqueOrThrow({ where: { id: problem.id } })).activeStorageBytes,
      ).toBe(4);
    },
  );

  it("allows same-size binary replacement at the combined cap", async () => {
    const author = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({
      authorId: author.id,
      status: "draft",
      visibility: "private",
      imageInventoryComplete: true,
    });
    await seedUsage({ problemId: problem.id, kind: "problem" }, LIMIT - 4);
    const testcase = await db.testcase.findFirstOrThrow({
      where: { testcaseSet: { problemId: problem.id } },
    });
    await expect(
      problemDomain.updateTestcaseRecord(actorOf(author), problem.id, testcase.id, {
        input: "4 5",
      }),
    ).resolves.toEqual({ id: testcase.id });
    expect((await problemDomain.getProblemStorageUsage(problem.id)).used).toBe(LIMIT);
    await expect(
      problemDomain.uploadProblemImage(
        actorOf(author),
        problem.id,
        Buffer.from("1"),
        "image/png",
      ),
    ).rejects.toThrow("budget exceeded");
  });

  it("pins shared image keys for new and untouched legacy forks before source deletion", async () => {
    const author = await createTestUser({ platformRole: "teacher" });
    const source = await createTestProblem({
      authorId: author.id,
      status: "draft",
      visibility: "private",
    });
    const key = `problems/${source.id}/images/legacy.png`;
    const pointer = await objects.putImmutableObject(
      objects.createStorageClient(),
      key,
      Buffer.from("123"),
    );
    const url = `/api/storage/problem-images/${source.id}/legacy.png`;
    await db.problemStatement.update({
      where: { problemId: source.id },
      data: { bodyMarkdown: `![old](${url})` },
    });
    const legacy = await db.problem.create({
      data: {
        authorId: author.id,
        title: "Legacy fork",
        status: "draft",
        visibility: "private",
        timeLimitMs: 1000,
        memoryLimitMb: 256,
      },
    });
    await db.problemStatement.create({
      data: { problemId: legacy.id, bodyMarkdown: `![fork](${url})` },
    });
    await problemDomain.uploadProblemImage(
      actorOf(author),
      source.id,
      Buffer.from("new"),
      "image/png",
    );
    const fork = await runTransaction((tx) =>
      problemDomain.forkProblemInTransaction(tx, source.id, {
        authorId: author.id,
        published: false,
        requirePublishedPublicSource: false,
      }),
    );
    expect(await db.uploadedImage.count({ where: { problemId: fork.id, ready: true } })).toBe(
      2,
    );
    await problemDomain.deleteProblemRecord(actorOf(author), source.id);
    expect(
      await db.uploadedImage.findUnique({
        where: { problemId_key: { problemId: legacy.id, key } },
      }),
    ).toMatchObject({ ready: true, size: 3 });
    await cleanupUnreferencedStorageObject({ pointer });
    await expect(
      objects.getVerifiedObject(objects.createStorageClient(), pointer),
    ).resolves.toEqual(Buffer.from("123"));
  });

  it("rejects unauthorized target access before inventorying private source objects", async () => {
    const owner = await createTestUser({ platformRole: "teacher" });
    const student = await createTestUser();
    const course = await createTestCourse({ ownerId: owner.id });
    const problem = await createTestProblem({
      authorId: owner.id,
      status: "draft",
      visibility: "private",
    });
    const inventory = vi.spyOn(objects, "listImageObjectInventory");
    await expect(
      courseDomain.addCourseProblems(actorOf(student), course.id, [problem.id]),
    ).rejects.toThrow("permission");
    expect(inventory).not.toHaveBeenCalled();
    inventory.mockRestore();
    expect(
      (await db.problem.findUniqueOrThrow({ where: { id: problem.id } }))
        .imageInventoryComplete,
    ).toBe(false);
  });
});
