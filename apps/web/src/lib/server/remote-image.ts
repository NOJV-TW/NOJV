import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

import { MAX_IMAGE_SIZE, detectImageMime } from "$lib/server/shared/file-validation";

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 5000;

export type RemoteImageErrorCode =
  "blocked" | "invalid_type" | "invalid_url" | "redirect" | "too_large" | "upstream";

export class RemoteImageError extends Error {
  constructor(
    readonly code: RemoteImageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RemoteImageError";
  }
}

export interface RemoteImageAddress {
  address: string;
  family: 4 | 6;
}

export interface RemoteImageHop {
  status: number;
  body: Buffer;
  location?: string;
}

export type RemoteImageResolver = (hostname: string) => Promise<RemoteImageAddress[]>;
export type RemoteImageRequest = (
  url: URL,
  address: RemoteImageAddress,
) => Promise<RemoteImageHop>;

interface RemoteImageOptions {
  forbiddenHostname?: string;
  request?: RemoteImageRequest;
  resolve?: RemoteImageResolver;
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

function publicAddress(address: RemoteImageAddress): boolean {
  if (isIP(address.address) !== address.family) return false;
  if (address.family === 4) return !blockedIpv4.check(address.address, "ipv4");
  return (
    globalIpv6.check(address.address, "ipv6") && !blockedIpv6.check(address.address, "ipv6")
  );
}

function bareHostname(hostname: string): string {
  const unbracketed = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

export function normalizeRemoteImageUrl(rawUrl: string, forbiddenHostname?: string): URL {
  if (rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    throw new RemoteImageError("invalid_url", "Invalid remote image URL");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteImageError("invalid_url", "Invalid remote image URL");
  }

  const hostname = bareHostname(url.hostname);
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0 ||
    hostname.length === 0
  ) {
    throw new RemoteImageError("invalid_url", "Invalid remote image URL");
  }
  if (forbiddenHostname && hostname === bareHostname(forbiddenHostname)) {
    throw new RemoteImageError("blocked", "Remote image host is not allowed");
  }

  url.hostname = hostname;
  url.hash = "";
  return url;
}

const resolveHostname: RemoteImageResolver = async (hostname) => {
  const family = isIP(hostname);
  if (family === 4 || family === 6) return [{ address: hostname, family }];
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => {
    if (family !== 4 && family !== 6) {
      throw new RemoteImageError("upstream", "Remote image host returned an unknown address");
    }
    return { address, family };
  });
};

function contentLength(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

const requestPinned: RemoteImageRequest = (url, address) =>
  new Promise((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      if (_options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    };
    const request = httpsRequest(
      url,
      {
        headers: {
          accept: "image/png,image/jpeg,image/gif,image/webp",
          "user-agent": "NOJV-Image-Proxy/1.0",
        },
        family: address.family,
        lookup: pinnedLookup,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status < 200 || status >= 300) {
          response.resume();
          resolve({ status, body: Buffer.alloc(0), ...(location ? { location } : {}) });
          return;
        }

        const declaredLength = contentLength(response.headers["content-length"]);
        if (declaredLength !== null && declaredLength > MAX_IMAGE_SIZE) {
          response.destroy();
          reject(new RemoteImageError("too_large", "Remote image is too large"));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (rawChunk: Buffer | Uint8Array) => {
          const chunk = Buffer.from(rawChunk);
          received += chunk.byteLength;
          if (received > MAX_IMAGE_SIZE) {
            response.destroy();
            reject(new RemoteImageError("too_large", "Remote image is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => resolve({ status, body: Buffer.concat(chunks, received) }));
        response.once("error", reject);
      },
    );
    request.once("error", (error) => {
      reject(
        error instanceof RemoteImageError
          ? error
          : new RemoteImageError("upstream", "Remote image request failed"),
      );
    });
    request.end();
  });

function redirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function fetchRemoteImage(
  rawUrl: string,
  options: RemoteImageOptions = {},
): Promise<{ body: Buffer; contentType: string }> {
  const resolveAddresses = options.resolve ?? resolveHostname;
  const request = options.request ?? requestPinned;
  let url = normalizeRemoteImageUrl(rawUrl, options.forbiddenHostname);
  let redirects = 0;

  for (;;) {
    let addresses: RemoteImageAddress[];
    try {
      const hostname = bareHostname(url.hostname);
      const literalFamily = isIP(hostname);
      addresses =
        literalFamily === 4 || literalFamily === 6
          ? [{ address: hostname, family: literalFamily }]
          : await resolveAddresses(hostname);
    } catch (error) {
      if (error instanceof RemoteImageError) throw error;
      throw new RemoteImageError("upstream", "Remote image host resolution failed");
    }

    if (addresses.length === 0 || addresses.some((address) => !publicAddress(address))) {
      throw new RemoteImageError("blocked", "Remote image host is not public");
    }
    const address = addresses.find((candidate) => candidate.family === 4) ?? addresses[0];
    if (!address) throw new RemoteImageError("upstream", "Remote image host did not resolve");

    const response = await request(url, address);
    if (redirectStatus(response.status)) {
      if (!response.location || redirects >= MAX_REDIRECTS) {
        throw new RemoteImageError("redirect", "Remote image redirected too many times");
      }
      url = normalizeRemoteImageUrl(
        new URL(response.location, url).href,
        options.forbiddenHostname,
      );
      redirects += 1;
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new RemoteImageError("upstream", "Remote image request failed");
    }
    if (response.body.byteLength > MAX_IMAGE_SIZE) {
      throw new RemoteImageError("too_large", "Remote image is too large");
    }

    const contentType = detectImageMime(response.body);
    if (!contentType) {
      throw new RemoteImageError("invalid_type", "Remote response is not a supported image");
    }
    return { body: response.body, contentType };
  }
}
