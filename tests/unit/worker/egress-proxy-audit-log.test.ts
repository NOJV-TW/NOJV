import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
}));

import { collectEgressProxyLogs } from "../../../apps/worker/src/services/egress-proxy";

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin: { end: () => void };
}

function fakeChild(stdoutChunks: string[], stderrChunks: string[] = []): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = Readable.from(stdoutChunks);
  child.stderr = Readable.from(stderrChunks);
  child.stdin = { end: () => undefined };

  let pending = 2;
  const maybeClose = () => {
    pending -= 1;
    if (pending === 0) setImmediate(() => child.emit("close", 0));
  };
  child.stdout.on("end", maybeClose);
  child.stderr.on("end", maybeClose);
  return child;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("collectEgressProxyLogs", () => {
  it("returns the streamed audit log content", async () => {
    spawnMock.mockReturnValue(
      fakeChild(["api.example.com:443 allow\n", "evil.test:80 deny\n"]),
    );

    const logs = await collectEgressProxyLogs("proxy-1");

    expect(logs).toContain("api.example.com:443 allow");
    expect(logs).toContain("evil.test:80 deny");
    expect(logs).not.toContain("[output truncated");
  });

  it("TRUNCATES an oversized log with the marker instead of dropping all of it", async () => {
    const head = "first.host:443 allow\n";
    const flood = "x".repeat(20 * 1024 * 1024);
    spawnMock.mockReturnValue(fakeChild([head, flood]));

    const logs = await collectEgressProxyLogs("proxy-1");

    expect(logs.startsWith("first.host:443 allow")).toBe(true);
    expect(logs).toContain("[output truncated");
  });

  it("resolves to an empty string when docker logs cannot spawn", async () => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = Readable.from([]);
    child.stderr = Readable.from([]);
    child.stdin = { end: () => undefined };
    spawnMock.mockReturnValue(child);
    setImmediate(() => child.emit("error", new Error("spawn ENOENT")));

    const logs = await collectEgressProxyLogs("proxy-1");
    expect(logs).toBe("");
  });
});
