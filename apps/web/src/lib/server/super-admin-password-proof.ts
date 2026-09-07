import type { Cookies } from "@sveltejs/kit";

import {
  consumeSuperAdminPasswordProofTicket,
  createSuperAdminPasswordProofTicket,
  deleteSuperAdminPasswordProofTicket,
  isSuperAdminPasswordProofSessionValid,
  readSuperAdminPasswordProofTicket,
  type SuperAdminPasswordProof,
} from "@nojv/application";

import { getWebEnv } from "$lib/server/env";

export const SUPER_ADMIN_PASSWORD_PROOF_COOKIE = "nojv.super_admin_password";
const PASSWORD_PROOF_TTL_SECONDS = 600;

export { isSuperAdminPasswordProofSessionValid, type SuperAdminPasswordProof };

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: PASSWORD_PROOF_TTL_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: getWebEnv().NODE_ENV === "production",
  };
}

export async function issueSuperAdminPasswordProof(
  cookies: Cookies,
  proof: SuperAdminPasswordProof,
): Promise<void> {
  const previous = cookies.get(SUPER_ADMIN_PASSWORD_PROOF_COOKIE);
  if (previous) await deleteSuperAdminPasswordProofTicket(previous);
  const ticket = await createSuperAdminPasswordProofTicket(proof);
  cookies.set(SUPER_ADMIN_PASSWORD_PROOF_COOKIE, ticket, cookieOptions());
}

export function passwordProofTicketFromCookieHeader(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name === SUPER_ADMIN_PASSWORD_PROOF_COOKIE) return value.join("=") || null;
  }
  return null;
}

export async function readSuperAdminPasswordProof(
  ticket: string,
): Promise<SuperAdminPasswordProof | null> {
  return readSuperAdminPasswordProofTicket(ticket);
}

export async function consumeSuperAdminPasswordProof(
  ticket: string,
  userId: string,
): Promise<SuperAdminPasswordProof | null> {
  return consumeSuperAdminPasswordProofTicket(ticket, userId);
}

export async function clearSuperAdminPasswordProof(cookies: Cookies): Promise<void> {
  const ticket = cookies.get(SUPER_ADMIN_PASSWORD_PROOF_COOKIE);
  if (ticket) await deleteSuperAdminPasswordProofTicket(ticket);
  cookies.delete(SUPER_ADMIN_PASSWORD_PROOF_COOKIE, { path: "/" });
}
