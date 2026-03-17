import { describe, expect, it } from "vitest";

import { testPrisma } from "../../fixtures/factories";
import { truncateAllTables } from "../../fixtures/seed-test-db";

describe("health / DB connectivity", () => {
  it("can connect to the test database and run a raw query", async () => {
    const result = await testPrisma.$queryRaw<{ now: Date }[]>`SELECT NOW() AS now`;
    expect(result).toHaveLength(1);
    expect(result[0]!.now).toBeInstanceOf(Date);
  });

  it("can write and read a user row", async () => {
    const user = await testPrisma.user.create({
      data: {
        id: "health-check-user",
        email: "health@test.local",
        name: "Health Check",
        username: "healthcheck",
        platformRole: "student",
        locale: "en"
      }
    });

    expect(user.id).toBe("health-check-user");

    const fetched = await testPrisma.user.findUnique({
      where: { id: "health-check-user" }
    });
    expect(fetched).not.toBeNull();
    expect(fetched!.email).toBe("health@test.local");
  });

  it("truncateAllTables actually clears data", async () => {
    await testPrisma.user.create({
      data: {
        id: "to-be-truncated",
        email: "truncate@test.local",
        name: "Truncate Me",
        username: "truncateme",
        platformRole: "student",
        locale: "en"
      }
    });

    await truncateAllTables();

    const count = await testPrisma.user.count();
    expect(count).toBe(0);
  });
});
