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

interface Credentials {
  username: string;
  password: string;
}

function parseBasicAuth(header: string | null): Credentials | null {
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
  credentials: Credentials | null,
): Promise<registryDomain.RegistryPrincipal> {
  const env = getWebEnv();
  if (!credentials || credentials.username === "") return { kind: "anonymous" };

  const failClosed = async () => {
    await signInRateLimiter.consume(`registry:${getClientIp(event)}`).catch(() => {
      error(429, "Too many attempts");
    });
    unauthorized();
  };

  if (credentials.username === JUDGE_PULL_USER) {
    if (
      !registryDomain.verifyServiceAccountSecret(
        credentials.password,
        env.REGISTRY_PULL_PASSWORD_HASH,
      )
    ) {
      return failClosed();
    }
    return { kind: "judge" };
  }

  if (credentials.username === CI_PUSH_USER) {
    if (
      !registryDomain.verifyServiceAccountSecret(
        credentials.password,
        env.REGISTRY_CI_PASSWORD_HASH,
      )
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

async function issueToken(
  event: RequestEvent,
  credentials: Credentials | null,
  service: string | null,
  scopeStrings: string[],
): Promise<Response> {
  if (!isRegistryTokenConfigured()) {
    error(404, "Not found");
  }

  const env = getWebEnv();
  if (service !== env.REGISTRY_PUBLIC_HOST) {
    error(400, "Unknown registry service");
  }

  const principal = await resolvePrincipal(event, credentials);
  const requested = registryDomain.parseRegistryScopes(scopeStrings);
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
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const credentials = parseBasicAuth(event.request.headers.get("authorization"));
  return issueToken(
    event,
    credentials,
    event.url.searchParams.get("service"),
    event.url.searchParams.getAll("scope"),
  );
});

export const POST: RequestHandler = apiHandler(async (event) => {
  const form = await event.request.formData().catch(() => {
    error(400, "Invalid request body");
  });
  const bodyUsername = form.get("username");
  const bodyPassword = form.get("password");
  const credentials: Credentials | null =
    typeof bodyUsername === "string" && typeof bodyPassword === "string"
      ? { username: bodyUsername, password: bodyPassword }
      : parseBasicAuth(event.request.headers.get("authorization"));

  const service = form.get("service");
  const scopeField = form.get("scope");
  const scopeStrings =
    typeof scopeField === "string" ? scopeField.split(" ").filter((s) => s.length > 0) : [];

  return issueToken(
    event,
    credentials,
    typeof service === "string" ? service : null,
    scopeStrings,
  );
});
