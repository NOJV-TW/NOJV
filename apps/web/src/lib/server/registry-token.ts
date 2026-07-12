import { randomUUID } from "node:crypto";

import { importPKCS8, SignJWT, type CryptoKey } from "jose";
import type { registryDomain } from "@nojv/application";

import { getWebEnv } from "./env";

const TOKEN_TTL_SECONDS = 300;

function decodePemEnv(value: string): string {
  if (value.includes("-----BEGIN")) return value;
  return Buffer.from(value, "base64").toString("utf8");
}

function pemBodyToDerBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
}

let cachedKey: { pem: string; key: CryptoKey } | undefined;

async function signingKey(pem: string): Promise<CryptoKey> {
  if (cachedKey?.pem === pem) return cachedKey.key;
  const key = await importPKCS8(pem, "ES256");
  cachedKey = { pem, key };
  return key;
}

export function isRegistryTokenConfigured(): boolean {
  const env = getWebEnv();
  return (
    env.REGISTRY_PUBLIC_HOST !== "" &&
    env.REGISTRY_TOKEN_PRIVATE_KEY !== "" &&
    env.REGISTRY_TOKEN_CERT !== ""
  );
}

export interface RegistryTokenResponse {
  token: string;
  access_token: string;
  expires_in: number;
  issued_at: string;
}

export async function signRegistryToken(
  subject: string,
  service: string,
  access: registryDomain.RegistryAccessEntry[],
): Promise<RegistryTokenResponse> {
  const env = getWebEnv();
  const keyPem = decodePemEnv(env.REGISTRY_TOKEN_PRIVATE_KEY);
  const certPem = decodePemEnv(env.REGISTRY_TOKEN_CERT);
  const key = await signingKey(keyPem);

  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ access })
    .setProtectedHeader({ alg: "ES256", typ: "JWT", x5c: [pemBodyToDerBase64(certPem)] })
    .setIssuer(env.REGISTRY_TOKEN_ISSUER)
    .setSubject(subject)
    .setAudience(service)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt - 10)
    .setExpirationTime(issuedAt + TOKEN_TTL_SECONDS)
    .sign(key);

  return {
    token,
    access_token: token,
    expires_in: TOKEN_TTL_SECONDS,
    issued_at: new Date(issuedAt * 1000).toISOString(),
  };
}
