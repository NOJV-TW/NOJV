import type { Readable, Writable } from "node:stream";
import { COMPILATION_TIMEOUT_MS } from "@nojv/core";

export const INTERACTIVE_READY_FRAME = Buffer.from("\0NOJV_INTERACTIVE_READY_V1\0");

export function waitForInteractivePeer(
  input: Readable,
  output: Writable,
  timeoutMs = COMPILATION_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let received = false;
    let writeStarted = false;
    let writeDone = false;
    let writeFailed = false;
    let outputErrorSeen = false;

    const releaseOutputListener = () => {
      if (writeDone && (!writeFailed || outputErrorSeen)) output.off("error", onOutputError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off("readable", readReady);
      input.off("end", onClosed);
      input.off("close", onClosed);
      input.off("error", onInputError);
      releaseOutputListener();
      if (error) reject(error);
      else resolve();
    };
    const readReady = () => {
      if (settled || !writeStarted || received) return;
      const frame: unknown = input.read(INTERACTIVE_READY_FRAME.length);
      if (frame === null) return;
      if (!Buffer.isBuffer(frame) || !frame.equals(INTERACTIVE_READY_FRAME)) {
        finish(new Error("Invalid interactive peer ready frame."));
        return;
      }
      received = true;
      if (writeDone && !writeFailed) finish();
    };
    const onClosed = () => {
      readReady();
      if (!received) finish(new Error("Interactive peer closed before readiness."));
    };
    const onInputError = (error: Error) => finish(error);
    const onOutputError = (error: Error) => {
      outputErrorSeen = true;
      finish(error);
      releaseOutputListener();
    };
    const timer = setTimeout(
      () => finish(new Error("Interactive startup timed out.")),
      timeoutMs,
    );
    input.on("readable", readReady);
    input.once("end", onClosed);
    input.once("close", onClosed);
    input.once("error", onInputError);
    output.on("error", onOutputError);
    try {
      writeStarted = true;
      output.write(INTERACTIVE_READY_FRAME, (error?: Error | null) => {
        writeDone = true;
        writeFailed = Boolean(error);
        if (error) finish(error);
        else if (received) finish();
        if (settled) releaseOutputListener();
      });
      readReady();
      if (input.readableEnded || input.destroyed) onClosed();
    } catch (error) {
      writeDone = true;
      finish(error instanceof Error ? error : new Error("Interactive ready write failed."));
    }
  });
}

export function pipeInteractiveInput(
  input: Readable,
  destination: Writable,
  onError: (error: Error) => void,
): () => void {
  const disconnect = () => {
    input.unpipe(destination);
    input.pause();
    input.off("error", onInputError);
  };
  const onInputError = (error: Error) => {
    disconnect();
    onError(error);
  };
  const onDestinationError = (error: NodeJS.ErrnoException) => {
    disconnect();
    if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") onError(error);
  };
  destination.on("error", onDestinationError);
  destination.once("close", () => {
    disconnect();
    destination.off("error", onDestinationError);
  });
  input.on("error", onInputError);
  input.pipe(destination);
  return disconnect;
}
