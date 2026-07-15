import { isIP } from "node:net";

export const DESTRUCTIVE_TEST_DATABASES = ["nojv_test", "nojv_e2e_test"] as const;

export type DestructiveTestDatabase = (typeof DESTRUCTIVE_TEST_DATABASES)[number];

export interface TestDatabaseProof {
  currentDatabase: string;
  marker: string;
  serverAddress: string;
  serverPort: number;
}

interface TestDatabaseProofRow {
  currentDatabase: string;
  marker: string | null;
  serverAddress: string | null;
  serverPort: number | null;
}

export interface TestDatabaseQuery {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PromiseLike<T>;
}

const TEST_DATABASE_PROOF_QUERY = `
SELECT
  current_database() AS "currentDatabase",
  inet_server_addr()::text AS "serverAddress",
  inet_server_port() AS "serverPort",
  shobj_description(database.oid, 'pg_database') AS "marker"
FROM pg_database AS database
WHERE database.datname = current_database()
`;

function isDestructiveTestDatabase(value: string): value is DestructiveTestDatabase {
  return (DESTRUCTIVE_TEST_DATABASES as readonly string[]).includes(value);
}

function requiredEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required for destructive database tests.`);
  return value;
}

export function destructiveTestDatabaseFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DestructiveTestDatabase {
  const value = requiredEnvironmentValue(env, "NOJV_DESTRUCTIVE_TEST_DATABASE");
  if (!isDestructiveTestDatabase(value)) {
    throw new Error(
      `NOJV_DESTRUCTIVE_TEST_DATABASE must be exactly one of: ${DESTRUCTIVE_TEST_DATABASES.join(", ")}.`,
    );
  }
  return value;
}

export function resolveDestructiveTestDatabase(
  expectedDatabase: DestructiveTestDatabase,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const marker = requiredEnvironmentValue(env, "NOJV_DESTRUCTIVE_TEST_DATABASE");
  if (marker !== expectedDatabase) {
    throw new Error(
      `NOJV_DESTRUCTIVE_TEST_DATABASE must equal ${expectedDatabase}; received ${marker}.`,
    );
  }

  const rawUrl = requiredEnvironmentValue(env, "TEST_DATABASE_URL");
  if (rawUrl.trim() !== rawUrl) {
    throw new Error("TEST_DATABASE_URL must not contain surrounding whitespace.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use the postgresql protocol.");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") {
    throw new Error("TEST_DATABASE_URL host must be the literal loopback 127.0.0.1 or ::1.");
  }
  if (url.pathname !== `/${expectedDatabase}`) {
    throw new Error(`TEST_DATABASE_URL pathname must be exactly /${expectedDatabase}.`);
  }
  if (url.search || url.hash) {
    throw new Error("TEST_DATABASE_URL must not contain a query string or fragment.");
  }
  return rawUrl;
}

export function resolveConfiguredDestructiveTestDatabase(
  env: NodeJS.ProcessEnv = process.env,
): { databaseUrl: string; expectedDatabase: DestructiveTestDatabase } {
  const expectedDatabase = destructiveTestDatabaseFromEnvironment(env);
  return {
    databaseUrl: resolveDestructiveTestDatabase(expectedDatabase, env),
    expectedDatabase,
  };
}

function validServerAddress(value: string): boolean {
  const withoutCidr = value.replace(/\/\d+$/, "");
  return isIP(withoutCidr) !== 0;
}

export async function assertLiveTestDatabase(
  database: TestDatabaseQuery,
  expectedDatabase: DestructiveTestDatabase,
): Promise<TestDatabaseProof> {
  const rows = await database.$queryRawUnsafe<TestDatabaseProofRow[]>(
    TEST_DATABASE_PROOF_QUERY,
  );
  const row = rows[0];
  if (!row || row.currentDatabase !== expectedDatabase) {
    throw new Error(
      `Live database identity mismatch: expected ${expectedDatabase}, received ${row?.currentDatabase ?? "no row"}.`,
    );
  }
  if (!row.serverAddress || !validServerAddress(row.serverAddress)) {
    throw new Error("Live database proof requires a non-null valid inet_server_addr().");
  }
  if (!Number.isInteger(row.serverPort) || (row.serverPort ?? 0) <= 0) {
    throw new Error("Live database proof requires a non-null valid inet_server_port().");
  }
  const expectedMarker = `NOJV_TEST_DATABASE:${expectedDatabase}`;
  if (row.marker !== expectedMarker) {
    throw new Error(
      `Live database COMMENT must be exactly ${expectedMarker}; received ${row.marker ?? "null"}. Run the explicit test database provisioning command.`,
    );
  }
  return {
    currentDatabase: row.currentDatabase,
    marker: row.marker,
    serverAddress: row.serverAddress,
    serverPort: row.serverPort!,
  };
}

export function formatTestDatabaseProof(proof: TestDatabaseProof): string {
  return [
    `database=${proof.currentDatabase}`,
    `server=${proof.serverAddress}:${String(proof.serverPort)}`,
    `marker=${proof.marker}`,
  ].join(" ");
}
