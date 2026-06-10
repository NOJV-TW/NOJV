import { beforeEach, describe, expect, it, vi } from "vitest";

const { findByComposite, updateRole, removeFromCourse, runTransaction } = vi.hoisted(() => ({
  findByComposite: vi.fn(),
  updateRole: vi.fn(),
  removeFromCourse: vi.fn(),
  runTransaction: vi.fn(
    <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({ $executeRaw: async () => 0 }),
  ),
}));

vi.mock("@nojv/db", () => ({
  courseMembershipRepo: { findByComposite, withTx: () => ({ findByComposite }) },
  courseMembershipAdminRepo: {
    updateRole,
    removeFromCourse,
    withTx: () => ({ updateRole, removeFromCourse }),
  },
  runTransaction,
}));

import {
  changeMemberRole,
  removeMember,
  bulkAddByHandle,
} from "../../../packages/domain/src/course/members";
import { canManageMembers } from "../../../packages/domain/src/shared/permissions";

type Role = "student" | "ta" | "teacher";

const COURSE = "crs_1";

function setMemberships(map: Record<string, { role: Role; status?: string }>) {
  findByComposite.mockImplementation((_courseId: string, userId: string) => {
    const m = map[userId];
    if (!m) return Promise.resolve(null);
    return Promise.resolve({
      courseId: COURSE,
      userId,
      role: m.role,
      status: m.status ?? "active",
    });
  });
}

function actor(
  overrides: Partial<{ userId: string; platformRole: "admin" | "teacher" | "student" }> = {},
) {
  return {
    userId: overrides.userId ?? "usr_actor",
    username: "actor",
    platformRole: overrides.platformRole ?? ("student" as const),
    displayName: "Actor",
    email: "actor@example.com",
  };
}

const teacher = () => actor({ userId: "usr_teacher", platformRole: "teacher" });
const ta = () => actor({ userId: "usr_ta", platformRole: "student" });
const admin = () => actor({ userId: "usr_admin", platformRole: "admin" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canManageMembers", () => {
  it("admits admins and teachers but not TAs or students", () => {
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("teacher")).toBe(true);
    expect(canManageMembers("ta")).toBe(false);
    expect(canManageMembers("student")).toBe(false);
    expect(canManageMembers(null)).toBe(false);
  });
});

describe("changeMemberRole", () => {
  it("blocks a TA from promoting themselves to teacher", async () => {
    setMemberships({ usr_ta: { role: "ta" } });
    await expect(changeMemberRole(ta(), COURSE, "usr_ta", "teacher")).rejects.toThrow(
      /teachers or admins/i,
    );
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("blocks a TA from changing any other member's role", async () => {
    setMemberships({ usr_ta: { role: "ta" }, usr_student: { role: "student" } });
    await expect(changeMemberRole(ta(), COURSE, "usr_student", "ta")).rejects.toThrow(
      /teachers or admins/i,
    );
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("blocks a plain student", async () => {
    setMemberships({ usr_student: { role: "student" } });
    await expect(
      changeMemberRole(actor({ userId: "usr_student" }), COURSE, "usr_other", "ta"),
    ).rejects.toThrow(/teachers or admins/i);
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("lets a teacher move a student to TA", async () => {
    setMemberships({ usr_teacher: { role: "teacher" }, usr_student: { role: "student" } });
    await changeMemberRole(teacher(), COURSE, "usr_student", "ta");
    expect(updateRole).toHaveBeenCalledWith(COURSE, "usr_student", "ta");
  });

  it("forbids a teacher from promoting anyone to teacher", async () => {
    setMemberships({ usr_teacher: { role: "teacher" }, usr_student: { role: "student" } });
    await expect(changeMemberRole(teacher(), COURSE, "usr_student", "teacher")).rejects.toThrow(
      /admin/i,
    );
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("forbids a teacher from demoting another teacher", async () => {
    setMemberships({ usr_teacher: { role: "teacher" }, usr_coteacher: { role: "teacher" } });
    await expect(
      changeMemberRole(teacher(), COURSE, "usr_coteacher", "student"),
    ).rejects.toThrow(/another teacher/i);
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("forbids a teacher from changing their own role", async () => {
    setMemberships({ usr_teacher: { role: "teacher" } });
    await expect(changeMemberRole(teacher(), COURSE, "usr_teacher", "ta")).rejects.toThrow(
      /your own role/i,
    );
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("lets an admin promote a student to teacher", async () => {
    setMemberships({ usr_student: { role: "student" } });
    await changeMemberRole(admin(), COURSE, "usr_student", "teacher");
    expect(updateRole).toHaveBeenCalledWith(COURSE, "usr_student", "teacher");
  });
});

describe("removeMember", () => {
  it("blocks a TA from removing anyone", async () => {
    setMemberships({ usr_ta: { role: "ta" }, usr_student: { role: "student" } });
    await expect(removeMember(ta(), COURSE, "usr_student")).rejects.toThrow(
      /teachers or admins/i,
    );
    expect(removeFromCourse).not.toHaveBeenCalled();
  });

  it("lets a teacher remove a student", async () => {
    setMemberships({ usr_teacher: { role: "teacher" }, usr_student: { role: "student" } });
    await removeMember(teacher(), COURSE, "usr_student");
    expect(removeFromCourse).toHaveBeenCalledWith(COURSE, "usr_student");
  });

  it("forbids a teacher from removing another teacher", async () => {
    setMemberships({ usr_teacher: { role: "teacher" }, usr_coteacher: { role: "teacher" } });
    await expect(removeMember(teacher(), COURSE, "usr_coteacher")).rejects.toThrow(
      /another teacher/i,
    );
    expect(removeFromCourse).not.toHaveBeenCalled();
  });

  it("forbids a teacher from removing themselves", async () => {
    setMemberships({ usr_teacher: { role: "teacher" } });
    await expect(removeMember(teacher(), COURSE, "usr_teacher")).rejects.toThrow(/yourself/i);
    expect(removeFromCourse).not.toHaveBeenCalled();
  });

  it("lets an admin remove a teacher", async () => {
    setMemberships({ usr_coteacher: { role: "teacher" } });
    await removeMember(admin(), COURSE, "usr_coteacher");
    expect(removeFromCourse).toHaveBeenCalledWith(COURSE, "usr_coteacher");
  });
});

describe("bulkAddByHandle", () => {
  it("blocks a TA from adding teaching assistants", async () => {
    setMemberships({ usr_ta: { role: "ta" } });
    await expect(
      bulkAddByHandle(ta(), COURSE, { handles: ["alice"], role: "ta" }),
    ).rejects.toThrow(/teaching assistants/i);
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
