const NTNU_ID_RE = /^\d{8}[a-z]$/;
const NTU_NTUST_ID_RE = /^[a-z]\d{8}$/;

function isStudentIdFormat(value: string): boolean {
  return NTNU_ID_RE.test(value) || NTU_NTUST_ID_RE.test(value);
}

export function isReservedUsername(username: string): boolean {
  if (isStudentIdFormat(username)) return true;

  for (const prefix of ["ntu_", "ntust_", "ntnu_"]) {
    if (username.startsWith(prefix)) {
      const rest = username.slice(prefix.length);
      if (isStudentIdFormat(rest)) return true;
    }
  }

  return false;
}
