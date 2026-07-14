import path from "node:path";

export const ORIGIN = "http://127.0.0.1:5174";

export const adminAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/admin.json",
);
export const teacherAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/teacher.json",
);
export const studentAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/student.json",
);
export const newStudentAuth = path.resolve(
  import.meta.dirname,
  "../fixtures/auth-states/new-student.json",
);

export const apiWriteHeaders = {
  origin: ORIGIN,
  "x-requested-with": "fetch",
} as const;

export const formActionHeaders = {
  origin: ORIGIN,
} as const;
