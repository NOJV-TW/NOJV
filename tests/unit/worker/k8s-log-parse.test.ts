import { describe, expect, it } from "vitest";

import { scanJsonLinesFromEnd } from "../../../apps/worker/src/sandbox/shared/log-parse";

const CHUNK = 16384;
const stdout = Array.from({ length: 12_000 }, (_, i) => String(i)).join(" ");
const result = JSON.stringify({
  testcaseResults: [],
  rawRuns: [{ index: 3, stdout, stderr: "", exitCode: 0, timeMs: 12 }],
});
const match = (json: unknown) =>
  typeof json === "object" && json !== null && "rawRuns" in json
    ? (json as { rawRuns: { index: number; stdout: string }[] })
    : null;

describe("scanJsonLinesFromEnd", () => {
  it("parses an intact trailing result line", () => {
    const logs = `[sandbox-runner] Reading config...\n${result}`;
    expect(scanJsonLinesFromEnd(logs, match)?.rawRuns[0]?.stdout).toBe(stdout);
  });

  it("reassembles a result line the log split around an interleaved stderr entry", () => {
    const head = result.slice(0, CHUNK * 3);
    const tail = result.slice(CHUNK * 3);
    const logs = [
      "[sandbox-runner] Reading config...",
      "[sandbox-runner] Submission x: cpp / standard / full_source",
      head,
      "",
      JSON.stringify({ nojvResourceUsage: { cpuUsec: 1510000 } }),
      tail,
    ].join("\n");
    const parsed = scanJsonLinesFromEnd(logs, match);
    expect(parsed?.rawRuns[0]?.index).toBe(3);
    expect(parsed?.rawRuns[0]?.stdout).toBe(stdout);
  });

  it("reassembles across a runner log line and keeps chunk boundaries byte-exact", () => {
    const cut = result.lastIndexOf(" ", CHUNK) + 1;
    const logs = [result.slice(0, cut), "[sandbox-runner] late log", result.slice(cut)].join(
      "\n",
    );
    expect(scanJsonLinesFromEnd(logs, match)?.rawRuns[0]?.stdout).toBe(stdout);
  });

  it("separates a result and a resource-usage document kubelet joined on one line", () => {
    const usage = JSON.stringify({ nojvResourceUsage: { cpuUsec: 200000 } });
    const logs = `[sandbox-runner] Reading config...\n${result}${usage}`;
    expect(scanJsonLinesFromEnd(logs, match)?.rawRuns[0]?.stdout).toBe(stdout);
  });

  it("reassembles a split result whose last fragment was joined with the usage document", () => {
    const usage = JSON.stringify({ nojvResourceUsage: { cpuUsec: 200000 } });
    const cut = CHUNK * 2;
    const logs = [result.slice(0, cut), "", `${result.slice(cut)}${usage}`].join("\n");
    expect(scanJsonLinesFromEnd(logs, match)?.rawRuns[0]?.stdout).toBe(stdout);
  });

  it("returns null when no line completes a JSON document", () => {
    expect(scanJsonLinesFromEnd('[sandbox-runner] only logs\n{"rawRuns":[', match)).toBeNull();
  });
});
