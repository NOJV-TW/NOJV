import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  converse,
  encodeFrame,
  FRAME_DATA,
  FrameChannel,
  InteractiveProtocolError,
} from "../../../apps/sandbox-runner/src/judges/interactive-channel.js";

function pair() {
  const leftToRight = new PassThrough();
  const rightToLeft = new PassThrough();
  return {
    left: new FrameChannel(rightToLeft, leftToRight),
    right: new FrameChannel(leftToRight, rightToLeft),
  };
}

function fakeProgram(reply: (input: string) => string) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let received = "";
  stdin.on("data", (chunk: Buffer) => (received += chunk.toString()));
  const exited = new Promise<void>((resolve) =>
    stdin.on("end", () => {
      stdout.end(reply(received));
      resolve();
    }),
  );
  return { stdin, stdout, exited, received: () => received };
}

describe("FrameChannel", () => {
  it("carries each case's conversation and end-of-stream separately", async () => {
    const { left, right } = pair();
    await Promise.all([left.ready(1_000), right.ready(1_000)]);

    for (const index of [4, 7]) {
      const solution = { stdin: new PassThrough(), stdout: new PassThrough() };
      const interactor = fakeProgram((input) => `seen ${input}`);
      const solutionDone = new Promise<void>((resolve) => solution.stdout.on("end", resolve));
      let solutionGot = "";
      solution.stdin.on("data", (chunk: Buffer) => (solutionGot += chunk.toString()));
      const conversations = Promise.all([
        converse(left, index, solution.stdin, solution.stdout, solutionDone),
        converse(right, index, interactor.stdin, interactor.stdout, interactor.exited),
      ]);
      solution.stdout.end(`case ${String(index)}`);
      await conversations;
      expect(interactor.received()).toBe(`case ${String(index)}`);
      expect(solutionGot).toBe(`seen case ${String(index)}`);
    }
  });

  it("fails the conversation on a malformed frame", async () => {
    const input = new PassThrough();
    const channel = new FrameChannel(input, new PassThrough());
    const ready = channel.ready(1_000);
    input.write(encodeFrame(1, 0));
    await ready;
    const program = fakeProgram(() => "");
    const conversation = converse(channel, 0, program.stdin, program.stdout, program.exited);
    input.write(Buffer.from([9, 0, 0, 0, 0, 0, 0, 0, 0]));
    await expect(conversation).rejects.toBeInstanceOf(InteractiveProtocolError);
  });

  it("queues frames that arrive for the next case", async () => {
    const input = new PassThrough();
    const channel = new FrameChannel(input, new PassThrough());
    const ready = channel.ready(1_000);
    input.write(encodeFrame(1, 0));
    await ready;
    input.write(encodeFrame(FRAME_DATA, 3, Buffer.from("early")));
    input.write(encodeFrame(3, 3));
    await new Promise((resolve) => setImmediate(resolve));
    const program = fakeProgram(() => "");
    await converse(channel, 3, program.stdin, program.stdout, program.exited);
    expect(program.received()).toBe("early");
  });
});
