import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { fileURLToPath } from "node:url";

import { workspaceRunRequestSchema, workspaceRunResultSchema } from "@nojv/domain";

import { parseSandboxEnv, type SandboxEnv } from "./env";
import { executeHostedWorkspaceRun } from "./services/host-executor";

interface SandboxServerOptions {
  executeRun?: typeof executeHostedWorkspaceRun;
}

async function readJsonBody(request: IncomingMessage) {
  let body = "";

  for await (const chunk of request) {
    body += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }

  if (body.length === 0) {
    return {};
  }

  return JSON.parse(body) as unknown;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

export function createSandboxServer(
  environment: Pick<SandboxEnv, "SANDBOX_SHARED_TOKEN">,
  options: SandboxServerOptions = {}
): Server {
  const executeRun = options.executeRun ?? executeHostedWorkspaceRun;

  return createServer((request, response) => {
    void (async () => {
      try {
        if (request.url === "/healthz" && request.method === "GET") {
          writeJson(response, 200, { ok: true });
          return;
        }

        if (request.url !== "/execute" || request.method !== "POST") {
          writeJson(response, 404, { message: "Not found." });
          return;
        }

        const authorization = request.headers.authorization?.trim();
        if (authorization !== `Bearer ${environment.SANDBOX_SHARED_TOKEN}`) {
          writeJson(response, 401, { message: "Unauthorized sandbox request." });
          return;
        }

        const payload = workspaceRunRequestSchema.parse(await readJsonBody(request));
        const result = workspaceRunResultSchema.parse(await executeRun(payload));
        writeJson(response, 200, result);
      } catch (error) {
        writeJson(response, 400, {
          message: error instanceof Error ? error.message : "Sandbox request failed."
        });
      }
    })();
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const environment = parseSandboxEnv(process.env);
  const server = createSandboxServer(environment);

  server.listen(environment.PORT, () => {
    console.log(`[sandbox] listening on port ${String(environment.PORT)}`);
  });
}
