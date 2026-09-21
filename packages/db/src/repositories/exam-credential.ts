import { prisma } from "../client";
import type { TransactionClient } from "../transaction";

const credentialInclude = {
  exam: { include: { course: { select: { archived: true } } } },
  user: {
    select: {
      id: true,
      username: true,
      email: true,
      emailVerified: true,
      disabled: true,
      isSuperAdmin: true,
      platformRole: true,
      securityGeneration: true,
      courseMemberships: { select: { courseId: true, role: true, status: true } },
    },
  },
} as const;

export const examCredentialRepo = {
  findById(id: string) {
    return prisma.examCredential.findUnique({ where: { id }, include: credentialInclude });
  },

  findForUsername(username: string, now: Date) {
    return prisma.examCredential.findMany({
      where: {
        revokedAt: null,
        user: { username, disabled: false, isSuperAdmin: false, platformRole: "student" },
        exam: {
          status: "published",
          startsAt: { lte: new Date(now.getTime() + 86_400_000) },
          endsAt: { gt: now },
          course: { archived: false },
        },
      },
      include: credentialInclude,
      orderBy: { exam: { endsAt: "asc" } },
    });
  },

  findSession(sessionId: string) {
    return prisma.session.findUnique({
      where: { id: sessionId },
      include: { examCredential: { include: { credential: { include: credentialInclude } } } },
    });
  },

  listDueRecipients(now: Date, take = 100) {
    return prisma.$queryRaw<{ examId: string; userId: string }[]>`
      SELECT e.id AS "examId", u.id AS "userId"
      FROM "Exam" e
      JOIN "Course" c ON c.id = e."courseId" AND c.archived = false
      JOIN "CourseMembership" m ON m."courseId" = c.id AND m.role = 'student' AND m.status = 'active'
      JOIN "User" u ON u.id = m."userId" AND u.disabled = false AND u."isSuperAdmin" = false
        AND u."platformRole" = 'student' AND u.username IS NOT NULL
      LEFT JOIN "ExamCredential" ec ON ec."examId" = e.id AND ec."userId" = u.id
      WHERE e.status = 'published' AND e."startsAt" <= ${new Date(now.getTime() + 86_400_000)}
        AND e."endsAt" > ${now}
        AND NOT EXISTS (SELECT 1 FROM "CourseMembership" staff WHERE staff."userId" = u.id
          AND staff.status = 'active' AND staff.role IN ('teacher', 'ta'))
        AND (ec.id IS NULL OR ec."revokedAt" IS NOT NULL
          OR ec."emailScheduledFor" != e."startsAt" - interval '24 hours'
          OR (ec."emailStatus" = 'unverified' AND u."emailVerified" = true))
      ORDER BY e."startsAt", e.id, u.id LIMIT ${take}
    `;
  },

  listInvalidCredentials(now: Date, take = 100) {
    return prisma.$queryRaw<{ id: string }[]>`
      SELECT ec.id FROM "ExamCredential" ec
      JOIN "Exam" e ON e.id = ec."examId"
      JOIN "Course" c ON c.id = e."courseId"
      JOIN "User" u ON u.id = ec."userId"
      WHERE ec."revokedAt" IS NULL AND (
        e.status != 'published' OR e."endsAt" <= ${now} OR c.archived = true
        OR u.disabled = true OR u."isSuperAdmin" = true OR u."platformRole" != 'student'
        OR EXISTS (SELECT 1 FROM "CourseMembership" staff WHERE staff."userId" = u.id
          AND staff.status = 'active' AND staff.role IN ('teacher', 'ta'))
        OR NOT EXISTS (SELECT 1 FROM "CourseMembership" m WHERE m."courseId" = c.id
          AND m."userId" = u.id AND m.role = 'student' AND m.status = 'active')
      ) ORDER BY ec.id LIMIT ${take}
    `;
  },

  withTx(tx: TransactionClient) {
    return {
      findById(id: string) {
        return tx.examCredential.findUnique({ where: { id }, include: credentialInclude });
      },
      lock(id: string) {
        return tx.$queryRaw`SELECT id FROM "ExamCredential" WHERE id = ${id} FOR UPDATE`;
      },
    };
  },
};

export type ExamCredentialRecord = NonNullable<
  Awaited<ReturnType<typeof examCredentialRepo.findById>>
>;
