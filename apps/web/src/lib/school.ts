type School = "ntnu" | "ntu" | "ntust";

interface SchoolEmailResult {
  school: School;
  studentId: string;
}

// NTNU: 8 digits + 1 letter
const NTNU_ID_RE = /^\d{8}[a-z]$/;
// NTU/NTUST: 1 letter + 8 digits
const NTU_NTUST_ID_RE = /^[a-z]\d{8}$/;

const SCHOOL_DOMAINS: Record<string, School> = {
  "ntnu.edu.tw": "ntnu",
  "gapps.ntnu.edu.tw": "ntnu",
  "ntu.edu.tw": "ntu",
  "g.ntu.edu.tw": "ntu",
  "mail.ntust.edu.tw": "ntust",
  "gapps.ntust.edu.tw": "ntust"
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

/** Returns true if the value looks like a student ID (any school) */
function isStudentIdFormat(value: string): boolean {
  return NTNU_ID_RE.test(value) || NTU_NTUST_ID_RE.test(value);
}

/** Returns true if the username is reserved for school verification */
export function isReservedUsername(username: string): boolean {
  // Direct student ID format
  if (isStudentIdFormat(username)) return true;

  // Prefixed format: ntu_<id>, ntust_<id>, ntnu_<id>
  for (const prefix of ["ntu_", "ntust_", "ntnu_"]) {
    if (username.startsWith(prefix)) {
      const rest = username.slice(prefix.length);
      if (isStudentIdFormat(rest)) return true;
    }
  }

  return false;
}
