import { error, json, type RequestEvent } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { registryDomain } from "@nojv/application";
import { getWebEnv } from "$lib/server/env";
import { apiHandler } from "$lib/server/shared/api-handler";
import { getClientIp } from "$lib/server/shared/client-ip";
import { signInRateLimiter } from "$lib/server/shared/rate-limiter";
import { isRegistryTokenConfigured, signRegistryToken } from "$lib/server/registry-token";

const JUDGE_PULL_USER = "judge-pull";
const CI_PUSH_USER = "ci-push";

function parseBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

function unauthorized(): never {
  error(401, "Invalid registry credentials");
}

async function resolvePrincipal(
  event: RequestEvent,
): Promise<registryDomain.RegistryPrincipal> {
  const env = getWebEnv();
  const credentials = parseBasicAuth(event.request.headers.get("authorization"));
  if (!credentials) return { kind: "anonymous" };

  const failClosed = async () => {
    await signInRateLimiter.consume(`registry:${getClientIp(event)}`).catch(() => {
      error(429, "Too many attempts");
    });
    unauthorized();
  };

  if (credentials.username === JUDGE_PULL_USER) {
    if (
      !(await registryDomain.verifyServiceAccountSecret(
        credentials.password,
        env.REGISTRY_PULL_PASSWORD_HASH,
      ))
    ) {
      return failClosed();
    }
    return { kind: "judge" };
  }

  if (credentials.username === CI_PUSH_USER) {
    if (
      !(await registryDomain.verifyServiceAccountSecret(
        credentials.password,
        env.REGISTRY_CI_PASSWORD_HASH,
      ))
    ) {
      return failClosed();
    }
    return { kind: "ci" };
  }

  const teacher = await registryDomain.verifyRegistryLogin(
    credentials.username,
    credentials.password,
  );
  if (!teacher) return failClosed();
  return teacher;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  if (!isRegistryTokenConfigured()) {
    error(404, "Not found");
  }

  const env = getWebEnv();
  const service = event.url.searchParams.get("service");
  if (service !== env.REGISTRY_PUBLIC_HOST) {
    error(400, "Unknown registry service");
  }

  const principal = await resolvePrincipal(event);
  const requested = registryDomain.parseRegistryScopes(event.url.searchParams.getAll("scope"));
  const access = registryDomain.authorizeRegistryAccess(principal, requested);

  const subject =
    principal.kind === "teacher"
      ? principal.namespace
      : principal.kind === "anonymous"
        ? ""
        : principal.kind;

  const response = await signRegistryToken(subject, service, access);
  return json(response, {
    headers: { "cache-control": "no-store" },
  });
});
