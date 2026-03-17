import { describe, expect, it } from "vitest";

import { createTestUser, testPrisma } from "../../fixtures/factories";

describe("auth integration", () => {
  it("createTestUser creates a user persisted in the database", async () => {
    const user = await createTestUser({ name: "Alice Auth" });

    const fetched = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Alice Auth");
    expect(fetched!.platformRole).toBe("student");
  });

  it("createTestUser respects platformRole override", async () => {
    const admin = await createTestUser({ platformRole: "admin" });
    const teacher = await createTestUser({ platformRole: "teacher" });

    expect(admin.platformRole).toBe("admin");
    expect(teacher.platformRole).toBe("teacher");

    const fetchedAdmin = await testPrisma.user.findUnique({ where: { id: admin.id } });
    expect(fetchedAdmin!.platformRole).toBe("admin");
  });

  it("each factory user gets a unique id and email", async () => {
    const u1 = await createTestUser();
    const u2 = await createTestUser();

    expect(u1.id).not.toBe(u2.id);
    expect(u1.email).not.toBe(u2.email);
  });
});
