import type { Readable, Writable } from "node:stream";

export const FRAME_READY = 1;
export const FRAME_DATA = 2;
export const FRAME_EOF = 3;

const HEADER_BYTES = 9;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;

export interface Frame {
  type: number;
  index: number;
  payload: Buffer;
}

export class InteractiveProtocolError extends Error {}

export function encodeFrame(
  type: number,
  index: number,
  payload: Buffer = Buffer.alloc(0),
): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(index, 1);
  header.writeUInt32BE(payload.length, 5);
  return Buffer.concat([header, payload]);
}

export class FrameChannel {
  private pending: Buffer = Buffer.alloc(0);
  private readonly queued = new Map<number, Frame[]>();
  private queuedBytes = 0;
  private readonly finished = new Set<number>();
  private active: { index: number; handler: (frame: Frame) => void } | null = null;
  private peerReady = false;
  private failure: Error | null = null;
  private onReady: (() => void) | null = null;
  private readonly listeners = new Set<(error: Error) => void>();

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {
    input.on("data", (chunk: Buffer) => this.receive(chunk));
    input.once("end", () =>
      this.fail(new InteractiveProtocolError("Interactive peer closed the channel.")),
    );
    input.once("error", (error: Error) => this.fail(error));
    output.on("error", (error: Error) => this.fail(error));
  }

  send(type: number, index: number, payload?: Buffer): boolean {
    return this.output.write(encodeFrame(type, index, payload));
  }

  onceDrain(listener: () => void): void {
    this.output.once("drain", listener);
  }

  pauseInput(): void {
    this.input.pause();
  }

  resumeInput(): void {
    this.input.resume();
  }

  onFailure(listener: (error: Error) => void): () => void {
    if (this.failure) {
      listener(this.failure);
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ready(timeoutMs: number): Promise<void> {
    this.send(FRAME_READY, 0);
    return new Promise((resolve, reject) => {
      if (this.peerReady) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        stop();
        reject(new InteractiveProtocolError("Interactive startup timed out."));
      }, timeoutMs);
      const stop = this.onFailure((error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.onReady = () => {
        clearTimeout(timer);
        stop();
        resolve();
      };
    });
  }

  subscribe(index: number, handler: (frame: Frame) => void): void {
    this.active = { index, handler };
    const frames = this.queued.get(index) ?? [];
    this.queued.delete(index);
    for (const frame of frames) {
      this.queuedBytes -= frame.payload.length;
      handler(frame);
    }
  }

  finish(index: number): void {
    if (this.active?.index === index) this.active = null;
    this.finished.add(index);
    for (const frame of this.queued.get(index) ?? []) this.queuedBytes -= frame.payload.length;
    this.queued.delete(index);
  }

  private receive(chunk: Buffer): void {
    if (this.failure) return;
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= HEADER_BYTES) {
      const type = this.pending.readUInt8(0);
      const index = this.pending.readUInt32BE(1);
      const length = this.pending.readUInt32BE(5);
      if (
        (type !== FRAME_READY && type !== FRAME_DATA && type !== FRAME_EOF) ||
        length > MAX_PAYLOAD_BYTES ||
        (type !== FRAME_DATA && length !== 0)
      ) {
        this.fail(new InteractiveProtocolError("Malformed interactive frame."));
        return;
      }
      if (this.pending.length < HEADER_BYTES + length) return;
      const payload = Buffer.from(this.pending.subarray(HEADER_BYTES, HEADER_BYTES + length));
      this.pending = this.pending.subarray(HEADER_BYTES + length);
      if (!this.dispatch({ type, index, payload })) return;
    }
  }

  private dispatch(frame: Frame): boolean {
    if (frame.type === FRAME_READY) {
      if (this.peerReady)
        return this.fail(new InteractiveProtocolError("Duplicate interactive ready frame."));
      this.peerReady = true;
      this.onReady?.();
      return true;
    }
    if (!this.peerReady)
      return this.fail(new InteractiveProtocolError("Interactive frame before readiness."));
    if (this.finished.has(frame.index)) return true;
    if (this.active?.index === frame.index) {
      this.active.handler(frame);
      return true;
    }
    this.queuedBytes += frame.payload.length;
    if (this.queuedBytes > MAX_QUEUED_BYTES)
      return this.fail(new InteractiveProtocolError("Too much interactive data queued ahead."));
    const frames = this.queued.get(frame.index) ?? [];
    frames.push(frame);
    this.queued.set(frame.index, frames);
    return true;
  }

  private fail(error: Error): false {
    if (this.failure) return false;
    this.failure = error;
    for (const listener of this.listeners) listener(error);
    this.listeners.clear();
    return false;
  }
}

export function converse(
  channel: FrameChannel,
  index: number,
  stdin: Writable,
  stdout: Readable,
  exited: Promise<unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let ownEof = false;
    let peerEof = false;
    let childDone = false;
    let settled = false;
    let waitingForDrain = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      stopFailure();
      channel.finish(index);
      channel.resumeInput();
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (ownEof && peerEof && childDone) settle();
    };
    const endOwn = () => {
      if (ownEof) return;
      ownEof = true;
      channel.send(FRAME_EOF, index);
      check();
    };
    const stopFailure = channel.onFailure((error) => settle(error));

    stdin.on("error", () => undefined);
    stdin.once("close", () => channel.resumeInput());
    stdout.on("data", (chunk: Buffer) => {
      for (let offset = 0; offset < chunk.length; offset += MAX_PAYLOAD_BYTES) {
        const accepted = channel.send(
          FRAME_DATA,
          index,
          chunk.subarray(offset, offset + MAX_PAYLOAD_BYTES),
        );
        if (!accepted && !waitingForDrain) {
          waitingForDrain = true;
          stdout.pause();
          channel.onceDrain(() => {
            waitingForDrain = false;
            stdout.resume();
          });
        }
      }
    });
    stdout.once("end", endOwn);
    stdout.once("close", endOwn);

    channel.subscribe(index, (frame) => {
      if (frame.type === FRAME_EOF) {
        peerEof = true;
        stdin.end();
        check();
        return;
      }
      if (stdin.writableEnded || stdin.destroyed) return;
      if (!stdin.write(frame.payload)) {
        channel.pauseInput();
        stdin.once("drain", () => channel.resumeInput());
      }
    });
    void exited.then(() => {
      childDone = true;
      check();
    });
  });
}
