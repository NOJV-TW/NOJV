import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiAuth: vi.fn(),
  assertProblemEditAccess: vi.fn(),
  readImageUpload: vi.fn(),
  uploadProblemImage: vi.fn(),
  uploadUserContentImage: vi.fn(),
}));
vi.mock("$lib/server/auth", () => ({ requireApiAuth: mocks.requireApiAuth }));
vi.mock("@nojv/application", () => ({
  problemDomain: { assertProblemEditAccess: mocks.assertProblemEditAccess },
}));
vi.mock("$lib/server/shared/api-handler", () => ({
  writeApiHandler: (handler: unknown) => handler,
}));
vi.mock("$lib/server/image-upload", () => ({ readImageUpload: mocks.readImageUpload }));
vi.mock("$lib/server/storage/problem-image", () => ({
  uploadProblemImage: mocks.uploadProblemImage,
}));
vi.mock("$lib/server/storage/user-content-image", () => ({
  uploadUserContentImage: mocks.uploadUserContentImage,
}));

const { POST: problemUpload } = await import("$lib/../routes/api/problems/[id]/images/+server");
const { POST: userUpload } = await import("$lib/../routes/api/uploads/image/+server");
const actor = { userId: "author", platformRole: "student", username: "author" };
const problemEvent = { params: { id: "problem" } } as unknown as Parameters<
  typeof problemUpload
>[0];
const userEvent = {} as Parameters<typeof userUpload>[0];
const image = { buffer: Buffer.from("image"), contentType: "image/png" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireApiAuth.mockReturnValue(actor);
  mocks.readImageUpload.mockResolvedValue(image);
  mocks.uploadProblemImage.mockResolvedValue("/api/storage/problem-images/problem/a.png");
  mocks.uploadUserContentImage.mockResolvedValue(
    "/api/storage/user-content-images/author/a.png",
  );
});

describe("owned image upload routes", () => {
  it("checks problem editing permission before reading or fetching an image", async () => {
    mocks.assertProblemEditAccess.mockRejectedValue(new Error("Denied"));
    await expect(problemUpload(problemEvent)).rejects.toThrow("Denied");
    expect(mocks.readImageUpload).not.toHaveBeenCalled();
    expect(mocks.uploadProblemImage).not.toHaveBeenCalled();
  });
  it("uploads problem images under the editable problem", async () => {
    const response = await problemUpload(problemEvent);
    expect(await response.json()).toEqual({ url: "/api/storage/problem-images/problem/a.png" });
    expect(mocks.uploadProblemImage).toHaveBeenCalledWith(
      actor,
      "problem",
      image.buffer,
      image.contentType,
    );
  });
  it("uploads generic images under the authenticated author", async () => {
    const response = await userUpload(userEvent);
    expect(await response.json()).toEqual({
      url: "/api/storage/user-content-images/author/a.png",
    });
    expect(mocks.uploadUserContentImage).toHaveBeenCalledWith(
      "author",
      image.buffer,
      image.contentType,
    );
  });
  it.each(["problem", "user"])(
    "authenticates %s uploads before reading or fetching",
    async (scope) => {
      mocks.requireApiAuth.mockImplementation(() => {
        throw new Error("Unauthorized");
      });
      await expect(
        scope === "problem" ? problemUpload(problemEvent) : userUpload(userEvent),
      ).rejects.toThrow("Unauthorized");
      expect(mocks.readImageUpload).not.toHaveBeenCalled();
    },
  );
});
