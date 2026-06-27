import { readFileSync } from "node:fs";

interface TlsOptions {
  clientCertPair?: { crt: Buffer; key: Buffer };
  serverNameOverride?: string;
}

export interface TemporalConnectionOptions {
  address: string;
  namespace: string;
  tls?: boolean | TlsOptions;
  apiKey?: string;
}

export function temporalConnectionOptions(): TemporalConnectionOptions {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const apiKey = process.env.TEMPORAL_API_KEY?.trim();
  const certPath = process.env.TEMPORAL_CLIENT_CERT_PATH?.trim();
  const keyPath = process.env.TEMPORAL_CLIENT_KEY_PATH?.trim();
  const serverName = process.env.TEMPORAL_SERVER_NAME?.trim();

  let tls: boolean | TlsOptions | undefined;
  if (certPath && keyPath) {
    tls = {
      clientCertPair: { crt: readFileSync(certPath), key: readFileSync(keyPath) },
      ...(serverName ? { serverNameOverride: serverName } : {}),
    };
  } else if (apiKey || process.env.TEMPORAL_TLS?.trim() === "true") {
    tls = true;
  }

  return {
    address,
    namespace,
    ...(tls !== undefined ? { tls } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}
