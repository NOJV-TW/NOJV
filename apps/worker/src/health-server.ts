import { createServer, type Server, type ServerResponse } from "node:http";

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

export function createWorkerHealthServer(): Server {
  return createServer((request, response) => {
    if (request.url === "/healthz" && request.method === "GET") {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.url === "/readyz" && request.method === "GET") {
      writeJson(response, 200, { ready: true });
      return;
    }

    writeJson(response, 404, { message: "Not found." });
  });
}
