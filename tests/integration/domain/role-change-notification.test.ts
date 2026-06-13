import { describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import { userDomain } from "@nojv/application";

import { createTestUser } from "../../fixtures/factories";

describe("updateUserRole notifications", () => {
  it("writes a role_changed notification when the role actually changes", async () => {
    const target = await createTestUser({ platformRole: "student" });

    await userDomain.updateUserRole(target.id, "teacher");

    const rows = await notificationRepo.listRecent(target.id, 10);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.type).toBe("role_changed");
    expect(row.linkUrl).toBe("/account");
    const params = row.params as { oldRole: string; newRole: string };
    expect(params.oldRole).toBe("student");
    expect(params.newRole).toBe("teacher");
  });

  it("does NOT write a notification when role is unchanged", async () => {
    const target = await createTestUser({ platformRole: "teacher" });

    await userDomain.updateUserRole(target.id, "teacher");

    const rows = await notificationRepo.listRecent(target.id, 10);
    expect(rows).toHaveLength(0);
  });

  it("writes exactly one row per actual transition across multiple calls", async () => {
    const target = await createTestUser({ platformRole: "student" });

    await userDomain.updateUserRole(target.id, "teacher"); // student -> teacher
    await userDomain.updateUserRole(target.id, "teacher"); // no-op
    await userDomain.updateUserRole(target.id, "admin"); // teacher -> admin

    const rows = await notificationRepo.listRecent(target.id, 10);
    expect(rows).toHaveLength(2);
    const latest = rows[0]!.params as { oldRole: string; newRole: string };
    expect(latest.oldRole).toBe("teacher");
    expect(latest.newRole).toBe("admin");
  });
});
