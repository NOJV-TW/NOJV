import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn() }));

vi.mock("$lib/server/auth", () => ({ requireAuth: mocks.requireAuth }));
const { load } = await import("$lib/../routes/(app)/admin/+layout.server");

describe("Admin layout authorization", () => {
  it("rejects ordinary users", () => {
    mocks.requireAuth.mockReturnValue({ platformRole: "teacher" });
    let thrown: unknown;
    try {
      load({} as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      status: 403,
      body: { message: "Admin access required." },
    });
  });

  it("returns the Admin actor", () => {
    const actor = { platformRole: "admin", userId: "admin_1" };
    mocks.requireAuth.mockReturnValue(actor);
    expect(load({} as never)).toEqual({ actor });
  });
});
