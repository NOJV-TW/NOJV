import { once } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_READY_FRAME,
  pipeInteractiveInput,
  waitForInteractivePeer,
} from "../../../apps/sandbox-runner/src/judges/interactive-start.js";

describe("interactive startup barrier", () => {
  it("exchanges readiness without deadlocking under backpressure", async () => {
    const left = new PassThrough({ highWaterMark: 1 });
    const right = new PassThrough({ highWaterMark: 1 });
    await Promise.all([
      waitForInteractivePeer(left, right, 500),
      waitForInteractivePeer(right, left, 500),
    ]);
    expect(left.readableLength).toBe(0);
    expect(right.readableLength).toBe(0);
    left.destroy();
    right.destroy();
  });

  it("waits for the peer and preserves prefetched binary protocol bytes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const bytes = Buffer.from([0, 255, 13, 10, 128, 0, 65]);
    const ready = waitForInteractivePeer(input, output, 500);
    input.end(Buffer.concat([INTERACTIVE_READY_FRAME, bytes]));
    await ready;
    expect(output.read()).toEqual(INTERACTIVE_READY_FRAME);
    const received: Buffer[] = [];
    const destination = new Writable({
      highWaterMark: 1,
      write(chunk: Buffer, _encoding, callback) {
        received.push(chunk);
        setImmediate(callback);
      },
    });
    const completed = once(destination, "finish");
    const disconnect = pipeInteractiveInput(input, destination, () => {
      throw new Error("Unexpected input error");
    });
    await completed;
    disconnect();
    expect(Buffer.concat(received)).toEqual(bytes);
    output.destroy();
  });

  it("accepts a fragmented ready frame", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const ready = waitForInteractivePeer(input, output, 500);
    input.write(INTERACTIVE_READY_FRAME.subarray(0, 3));
    await new Promise<void>((resolve) => setImmediate(resolve));
    input.write(INTERACTIVE_READY_FRAME.subarray(3));
    await ready;
    input.destroy();
    output.destroy();
  });

  it("rejects EOF before readiness", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const result = expect(waitForInteractivePeer(input, output, 500)).rejects.toThrow("closed");
    input.end();
    await result;
    output.destroy();
  });

  it("rejects a malformed frame", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const result = expect(waitForInteractivePeer(input, output, 500)).rejects.toThrow(
      "Invalid",
    );
    input.write(Buffer.alloc(INTERACTIVE_READY_FRAME.length, 1));
    await result;
    input.destroy();
    output.destroy();
  });

  it("bounds a peer that never becomes ready", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    await expect(waitForInteractivePeer(input, output, 20)).rejects.toThrow("timed out");
    expect(input.listenerCount("readable")).toBe(0);
    input.destroy();
    output.destroy();
  });

  it("handles a failed ready write without an unhandled stream error", async () => {
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("Broken pipe"), { code: "EPIPE" }));
      },
    });
    await expect(waitForInteractivePeer(input, output, 500)).rejects.toThrow("Broken pipe");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output.listenerCount("error")).toBe(0);
    input.destroy();
  });

  it("unpipes an exited child and absorbs pending EPIPE", async () => {
    const input = new PassThrough();
    let finishWrite: ((error?: Error | null) => void) | undefined;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        finishWrite = callback;
      },
    });
    const disconnect = pipeInteractiveInput(input, output, () => {
      throw new Error("Child EPIPE is expected after exit");
    });
    input.write(Buffer.from("protocol"));
    disconnect();
    finishWrite?.(Object.assign(new Error("Broken pipe"), { code: "EPIPE" }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(input.listenerCount("data")).toBe(0);
    expect(output.listenerCount("error")).toBe(0);
    input.destroy();
  });
});
