import { expect, it } from "vitest";
import { userDomain } from "@nojv/application";
import { createTestUser, testPrisma } from "../../fixtures/factories";

it("revokes all sessions when disabling a user and never resurrects them on enable", async () => {
  const user = await createTestUser();
  await testPrisma.session.createMany({
    data: ["first", "second"].map((suffix) => ({
      id: `${user.id}-${suffix}`,
      userId: user.id,
      token: `synthetic-${user.id}-${suffix}`,
      expiresAt: new Date(Date.now() + 60_000),
    })),
  });
  await userDomain.setUserDisabled(true, user.id, true);
  expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(0);
  await userDomain.setUserDisabled(true, user.id, false);
  expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(0);
});
