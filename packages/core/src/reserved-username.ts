const NTNU_ID_RE = /^\d{8}[a-z]$/;
const NTU_NTUST_ID_RE = /^[a-z]\d{8}$/;

function isStudentIdFormat(value: string): boolean {
  return NTNU_ID_RE.test(value) || NTU_NTUST_ID_RE.test(value);
}

// "Verified" state is inferred from the username format; a non-verified user
// claiming one of these handles would fake the verified badge. This check
// gates manual rename in both the app layer (`$lib/school`) and the domain
// layer (`@nojv/domain/user`) — it lives in `@nojv/core` so the client bundle
// stays free of server-only dependencies.
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
