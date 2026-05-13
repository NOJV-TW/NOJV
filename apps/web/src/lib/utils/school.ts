export { isReservedUsername } from "@nojv/core";

type School = "ntnu" | "ntu" | "ntust";

interface SchoolEmailResult {
  school: School;
  studentId: string;
}

const NTNU_ID_RE = /^\d{8}[a-z]$/;
const NTU_NTUST_ID_RE = /^[a-z]\d{8}$/;

const SCHOOL_DOMAINS: Record<string, School> = {
  "ntnu.edu.tw": "ntnu",
  "gapps.ntnu.edu.tw": "ntnu",
  "ntu.edu.tw": "ntu",
  "g.ntu.edu.tw": "ntu",
  "mail.ntust.edu.tw": "ntust",
  "gapps.ntust.edu.tw": "ntust",
};

function isValidStudentIdForSchool(id: string, school: School): boolean {
  if (school === "ntnu") return NTNU_ID_RE.test(id);
  return NTU_NTUST_ID_RE.test(id);
}

export function parseSchoolEmail(email: string): SchoolEmailResult | null {
  const atIndex = email.indexOf("@");
  if (atIndex < 0) return null;

  const localPart = email.slice(0, atIndex).toLowerCase();
  const domain = email.slice(atIndex + 1).toLowerCase();

  const school = SCHOOL_DOMAINS[domain];
  if (!school) return null;

  if (!isValidStudentIdForSchool(localPart, school)) return null;

  return { school, studentId: localPart };
}

export function extractStudentId(school: School, studentId: string): string {
  if (school === "ntnu") return studentId;
  return `${school}_${studentId}`;
}
