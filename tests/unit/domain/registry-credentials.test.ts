import { beforeEach, describe, expect, it, vi } from "vitest";

const { credFindByUserId, credFindByUsername, credUpsert, credMarkUsed, userFindById } =
  vi.hoisted(() => ({
    credFindByUserId: vi.fn(),
    credFindByUsername: vi.fn(),
    credUpsert: vi.fn(),
    credMarkUsed: vi.fn(),
    userFindById: vi.fn(),
  }));

vi.mock("@nojv/db", () => ({
  assessmentProblemRepo: {},
  contestProblemRepo: {},
  courseMembershipRepo: {},
  examProblemRepo: {},
  problemRepo: {},
  problemWorkspaceFileRepo: {},
  userRepo: { findById: userFindById },
  registryCredentialRepo: {
    findByUserId: credFindByUserId,
    findByUsername: credFindByUsername,
    upsertForUser: credUpsert,
    markUsed: credMarkUsed,
  },
}));

import { ForbiddenError, registryDomain } from "@nojv/application";

const {
  generateRegistryCredential,
  verifyRegistryLogin,
  registryNamespaceFor,
  hashRegistrySecret,
  verifyServiceAccountSecret,
} = registryDomain;

describe("registryNamespaceFor", () => {
  it("lowercases a clean username", () => {
    expect(registryNamespaceFor("Alice", "usr_1")).toBe("alice");
  });

  it("falls back to the user id when the username has invalid characters", () => {
    expect(registryNamespaceFor("郭老師", "USR9")).toBe("u-usr9");
    expect(registryNamespaceFor(null, "usr_2")).toBe("u-usr_2");
  });
});

describe("generateRegistryCredential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindById.mockResolvedValue({ canCreateAdvancedProblems: true });
    credUpsert.mockResolvedValue({});
  });

  const actor = { userId: "usr_t", username: "teacher", platformRole: "teacher" as const };

  it("denies actors without the advanced flag", async () => {
    userFindById.mockResolvedValue({ canCreateAdvancedProblems: false });
    await expect(generateRegistryCredential(actor)).rejects.toBeInstanceOf(ForbiddenError);
    expect(credUpsert).not.toHaveBeenCalled();
  });

  it("issues a credential with the username-derived namespace", async () => {
    credFindByUserId.mockResolvedValue(null);
    credFindByUsername.mockResolvedValue(null);

    const issued = await generateRegistryCredential(actor);

    expect(issued.username).toBe("teacher");
    expect(issued.password.length).toBeGreaterThanOrEqual(24);
    const [userId, username, storedHash] = credUpsert.mock.calls[0]!;
    expect(userId).toBe("usr_t");
    expect(username).toBe("teacher");
    expect(verifyServiceAccountSecret(issued.password, storedHash as string)).toBe(true);
  });

  it("keeps the stored username on rotation", async () => {
    credFindByUserId.mockResolvedValue({ username: "teacher-old" });

    const issued = await generateRegistryCredential(actor);

    expect(issued.username).toBe("teacher-old");
    expect(credFindByUsername).not.toHaveBeenCalled();
  });

  it("falls back to the user-id namespace when the name is taken by someone else", async () => {
    credFindByUserId.mockResolvedValue(null);
    credFindByUsername.mockResolvedValue({ userId: "someone_else" });

    const issued = await generateRegistryCredential(actor);

    expect(issued.username).toBe("u-usr_t");
  });
});

describe("verifyRegistryLogin", () => {
  const password = "s3cret-password-value";
  let passwordHash: string;

  function credRow(user: Record<string, unknown>) {
    return {
      id: "cred_1",
      userId: "usr_t",
      username: "teacher",
      passwordHash,
      user: {
        id: "usr_t",
        disabled: false,
        platformRole: "teacher",
        canCreateAdvancedProblems: true,
        ...user,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    credMarkUsed.mockResolvedValue({});
    passwordHash = hashRegistrySecret(password);
  });

  it("accepts a valid login and marks it used", async () => {
    credFindByUsername.mockResolvedValue(credRow({}));
    await expect(verifyRegistryLogin("teacher", password)).resolves.toEqual({
      kind: "teacher",
      namespace: "teacher",
    });
    expect(credMarkUsed).toHaveBeenCalledWith("cred_1");
  });

  it("rejects a wrong password", async () => {
    credFindByUsername.mockResolvedValue(credRow({}));
    await expect(verifyRegistryLogin("teacher", "wrong")).resolves.toBeNull();
  });

  it("rejects when the advanced flag was revoked", async () => {
    credFindByUsername.mockResolvedValue(credRow({ canCreateAdvancedProblems: false }));
    await expect(verifyRegistryLogin("teacher", password)).resolves.toBeNull();
  });

  it("rejects disabled users", async () => {
    credFindByUsername.mockResolvedValue(credRow({ disabled: true }));
    await expect(verifyRegistryLogin("teacher", password)).resolves.toBeNull();
  });

  it("admins stay valid without the flag and get the admin principal", async () => {
    credFindByUsername.mockResolvedValue(
      credRow({ platformRole: "admin", canCreateAdvancedProblems: false }),
    );
    await expect(verifyRegistryLogin("teacher", password)).resolves.toEqual({
      kind: "admin",
    });
  });
});

describe("verifyServiceAccountSecret", () => {
  it("matches only the exact secret and rejects empty hashes", () => {
    const hash = hashRegistrySecret("svc-secret");
    expect(verifyServiceAccountSecret("svc-secret", hash)).toBe(true);
    expect(verifyServiceAccountSecret("other", hash)).toBe(false);
    expect(verifyServiceAccountSecret("svc-secret", "")).toBe(false);
  });
});
