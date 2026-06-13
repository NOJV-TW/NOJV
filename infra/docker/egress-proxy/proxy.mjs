import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

const DEFAULT_PORTS = [80, 443];

function normalizeHost(host) {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function parseAllowlist(raw) {
  const entries = [];
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.lastIndexOf(":");
    if (colon > 0 && colon < trimmed.length - 1) {
      const portStr = trimmed.slice(colon + 1);
      const port = Number(portStr);
      if (Number.isInteger(port) && port > 0 && port <= 65_535) {
        entries.push({ host: normalizeHost(trimmed.slice(0, colon)), ports: [port] });
        continue;
      }
    }
    entries.push({ host: normalizeHost(trimmed), ports: [...DEFAULT_PORTS] });
  }
  return entries;
}

export function matchesAllowlist(allowlist, host, port) {
  const target = normalizeHost(host);
  const targetPort = Number(port);
  if (!target || !Number.isInteger(targetPort)) return false;
  return allowlist.some((entry) => entry.host === target && entry.ports.includes(targetPort));
}

function logRequest(host, port, decision) {
  process.stdout.write(`${host}:${String(port)} ${decision}\n`);
}

function handleConnect(allowlist, req, clientSocket, head) {
  const [rawHost, rawPort] = req.url.split(":");
  const host = rawHost ?? "";
  const port = rawPort ? Number(rawPort) : 443;

  if (!matchesAllowlist(allowlist, host, port)) {
    logRequest(host, port, "deny");
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  logRequest(host, port, "allow");
  const upstream = connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  const teardown = () => {
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on("error", teardown);
  clientSocket.on("error", teardown);
}

function handleHttp(allowlist, clientReq, clientRes) {
  let target;
  try {
    target = new URL(clientReq.url);
  } catch {
    clientRes.writeHead(400).end();
    return;
  }

  const host = target.hostname;
  const port = target.port ? Number(target.port) : 80;

  if (!matchesAllowlist(allowlist, host, port)) {
    logRequest(host, port, "deny");
    clientRes.writeHead(403).end("Forbidden");
    return;
  }

  logRequest(host, port, "allow");
  const upstream = httpRequest(
    {
      host,
      port,
      method: clientReq.method,
      path: `${target.pathname}${target.search}`,
      headers: clientReq.headers,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );
  upstream.on("error", () => {
    if (!clientRes.headersSent) clientRes.writeHead(502);
    clientRes.end();
  });
  clientReq.pipe(upstream);
}

export function createProxyServer(allowlist) {
  const server = createServer();
  server.on("request", (req, res) => {
    handleHttp(allowlist, req, res);
  });
  server.on("connect", (req, socket, head) => {
    handleConnect(allowlist, req, socket, head);
  });
  return server;
}

function main() {
  const port = Number(process.env.NOJV_PROXY_PORT ?? "8888");
  const allowlist = parseAllowlist(process.env.NOJV_ALLOWLIST);
  const server = createProxyServer(allowlist);
  server.listen(port, () => {
    process.stdout.write(`egress-proxy listening on ${String(port)}\n`);
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main();
}
