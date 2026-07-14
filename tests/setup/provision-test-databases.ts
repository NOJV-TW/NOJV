import { execFileSync } from "node:child_process";

const databases = [
  { marker: "NOJV_TEST_DATABASE:nojv_test", name: "nojv_test" },
  { marker: "NOJV_TEST_DATABASE:nojv_e2e_test", name: "nojv_e2e_test" },
] as const;

const postgresUser = process.env.POSTGRES_USER ?? "postgres";

function dockerPostgres(args: string[]): string {
  return execFileSync("docker", ["compose", "exec", "-T", "postgres", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

for (const database of databases) {
  const exists = dockerPostgres([
    "psql",
    "-U",
    postgresUser,
    "-d",
    "postgres",
    "-tAc",
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${database.name}')`,
  ]).trim();
  if (exists !== "t") {
    dockerPostgres(["createdb", "-U", postgresUser, database.name]);
  }
  dockerPostgres([
    "psql",
    "-U",
    postgresUser,
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `COMMENT ON DATABASE ${database.name} IS '${database.marker}'`,
  ]);
  console.info(`Provisioned ${database.name} with marker ${database.marker}`);
}
