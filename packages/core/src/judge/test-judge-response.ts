import { TEST_JUDGE_RESPONSE_BYTES, type TestJudgeCaseResult } from "../schemas/test-judge";

const SHORT_ESCAPES = new Set([0x08, 0x09, 0x0a, 0x0c, 0x0d]);

function jsonCodePointBytes(code: number): number {
  if (code === 0x22 || code === 0x5c) return 2;
  if (code < 0x20) return SHORT_ESCAPES.has(code) ? 2 : 6;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code >= 0xd800 && code <= 0xdfff) return 6;
  return code < 0x10000 ? 3 : 4;
}

function jsonTextBytes(text: string): number {
  let bytes = 0;
  for (const char of text) bytes += jsonCodePointBytes(char.codePointAt(0) ?? 0);
  return bytes;
}

function truncateJsonText(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    bytes += jsonCodePointBytes(char.codePointAt(0) ?? 0);
    if (bytes > maxBytes) break;
    end += char.length;
  }
  return text.slice(0, end);
}

function mapTexts(
  result: TestJudgeCaseResult,
  map: (text: string) => string,
): TestJudgeCaseResult {
  const { teamMessage, contestantStderr, transcript } = result;
  return {
    ...result,
    ...(teamMessage === undefined ? {} : { teamMessage: map(teamMessage) }),
    ...(contestantStderr === undefined ? {} : { contestantStderr: map(contestantStderr) }),
    ...(transcript === undefined
      ? {}
      : {
          transcript: {
            toInteractor: map(transcript.toInteractor),
            toContestant: map(transcript.toContestant),
          },
        }),
  };
}

function fairShare(sizes: number[], budget: number): number {
  const ascending = [...sizes].sort((a, b) => a - b);
  let remaining = budget;
  for (const [index, size] of ascending.entries()) {
    const share = Math.floor(remaining / (ascending.length - index));
    if (size > share) return share;
    remaining -= size;
  }
  return remaining;
}

export function boundedTestJudgeOutput(cases: TestJudgeCaseResult[]): {
  ok: true;
  cases: TestJudgeCaseResult[];
} {
  const sizes: number[] = [];
  const blank = cases.map((result) =>
    mapTexts(result, (text) => {
      sizes.push(jsonTextBytes(text));
      return "";
    }),
  );
  const envelopeBytes = new TextEncoder().encode(JSON.stringify({ ok: true, cases: blank }));
  const budget = Math.max(0, TEST_JUDGE_RESPONSE_BYTES - envelopeBytes.byteLength);
  if (sizes.reduce((total, size) => total + size, 0) <= budget) return { ok: true, cases };
  const cap = fairShare(sizes, budget);
  return {
    ok: true,
    cases: cases.map((result) => mapTexts(result, (text) => truncateJsonText(text, cap))),
  };
}
