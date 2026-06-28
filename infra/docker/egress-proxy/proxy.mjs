import { createServer, request as httpRequest } from "node:http";
import { connect, isIP, BlockList } from "node:net";
import { lookup } from "node:dns/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_PORTS = [80, 443];
const CONNECT_TIMEOUT_MS = 30_000;

const PRIVATE_RANGES = new BlockList();
PRIVATE_RANGES.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_RANGES.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_RANGES.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_RANGES.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_RANGES.addAddress("::1", "ipv6");
PRIVATE_RANGES.addSubnet("fc00::", 7, "ipv6");
PRIVATE_RANGES.addSubnet("fe80::", 10, "ipv6");

export function isBlockedAddress(ip) {
  if (process.env.NOJV_PROXY_ALLOW_PRIVATE === "1") return false;
  const fam = isIP(ip);
  if (fam === 4) return PRIVATE_RANGES.check(ip, "ipv4");
  if (fam === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped && isIP(mapped[1]) === 4) return PRIVATE_RANGES.check(mapped[1], "ipv4");
    return PRIVATE_RANGES.check(ip, "ipv6");
  }
  return true;
}

async function resolveGuardedAddress(host) {
  const target = normalizeHost(host);
  if (!target) return null;
  if (isIP(target)) return isBlockedAddress(target) ? null : target;
  let addresses;
  try {
    addresses = await lookup(target, { all: true });
  } catch {
    return null;
  }
  if (addresses.length === 0) return null;
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) return null;
  }
  return addresses[0].address;
}

function normalizeHost(host) {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function parsePort(portStr) {
  const port = Number(portStr);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

function parseEntry(trimmed) {
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close < 0) return null;
    const host = normalizeHost(trimmed.slice(0, close + 1));
    if (!host) return null;
    const rest = trimmed.slice(close + 1);
    if (rest === "") return { host, ports: [...DEFAULT_PORTS] };
    if (!rest.startsWith(":")) return null;
    const port = parsePort(rest.slice(1));
    return port === null ? null : { host, ports: [port] };
  }

  const colon = trimmed.indexOf(":");
  if (colon < 0) {
    return { host: normalizeHost(trimmed), ports: [...DEFAULT_PORTS] };
  }
  if (colon !== trimmed.lastIndexOf(":")) {
    return null;
  }
  const port = parsePort(trimmed.slice(colon + 1));
  if (port === null) return null;
  const host = normalizeHost(trimmed.slice(0, colon));
  return host ? { host, ports: [port] } : null;
}

export function parseAllowlist(raw) {
  const entries = [];
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const entry = parseEntry(trimmed);
    if (entry) entries.push(entry);
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

async function handleConnect(allowlist, req, clientSocket, head) {
  const [rawHost, rawPort] = req.url.split(":");
  const host = rawHost ?? "";
  const port = rawPort ? Number(rawPort) : 443;

  if (!matchesAllowlist(allowlist, host, port)) {
    logRequest(host, port, "deny");
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const ip = await resolveGuardedAddress(host);
  if (!ip) {
    logRequest(host, port, "deny-private");
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  logRequest(host, port, "allow");
  const upstream = connect(port, ip, () => {
    if (isBlockedAddress(upstream.remoteAddress ?? "")) {
      upstream.destroy();
      clientSocket.destroy();
      return;
    }
    upstream.setTimeout(0);
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  upstream.setTimeout(CONNECT_TIMEOUT_MS, () => {
    upstream.destroy();
  });

  const teardown = () => {
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on("error", teardown);
  upstream.on("close", teardown);
  clientSocket.on("error", teardown);
  clientSocket.on("close", teardown);
}

async function handleHttp(allowlist, clientReq, clientRes) {
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

  const ip = await resolveGuardedAddress(host);
  if (!ip) {
    logRequest(host, port, "deny-private");
    clientRes.writeHead(403).end("Forbidden");
    return;
  }

  logRequest(host, port, "allow");
  const upstream = httpRequest(
    {
      host: ip,
      port,
      method: clientReq.method,
      path: `${target.pathname}${target.search}`,
      headers: { ...clientReq.headers, host: clientReq.headers.host ?? host },
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
    handleHttp(allowlist, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  server.on("connect", (req, socket, head) => {
    handleConnect(allowlist, req, socket, head).catch(() => {
      socket.destroy();
    });
  });
  return server;
}

export const READY_MARKER = "NOJV_PROXY_READY";

function main() {
  const port = Number(process.env.NOJV_PROXY_PORT ?? "8888");
  const allowlist = parseAllowlist(process.env.NOJV_ALLOWLIST);
  const server = createProxyServer(allowlist);
  server.listen(port, () => {
    process.stdout.write(`${READY_MARKER} ${String(port)}\n`);
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main();
}
