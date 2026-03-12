import { createServer, type Server, type ServerResponse } from "node:http";

import { registry } from "./metrics.js";

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

    if (request.url === "/metrics" && request.method === "GET") {
      registry
        .metrics()
        .then((metrics) => {
          response.writeHead(200, { "Content-Type": registry.contentType });
          response.end(metrics);
        })
        .catch(() => {
          writeJson(response, 500, { message: "Failed to collect metrics." });
        });
      return;
    }

    writeJson(response, 404, { message: "Not found." });
  });
}
