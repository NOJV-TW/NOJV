import { Decimal } from "decimal.js";

const JudgeNumber = Decimal.clone({ precision: 40 });

export interface CompareOptions {
  caseSensitive?: boolean | undefined;
  floatTolerance?: number | null | undefined;
}

function tokenize(s: string): string[] {
  return s.split(/[ \t\n\r\v\f]+/).filter((t) => t.length > 0);
}

function parseNumber(token: string): Decimal | null {
  if (/^[+-]?nan(?:\([a-z0-9_]*\))?$/i.test(token)) return new JudgeNumber(NaN);
  if (/^[+-]?inf(?:inity)?$/i.test(token)) {
    return new JudgeNumber(token.startsWith("-") ? -Infinity : Infinity);
  }
  const hex = /^([+-]?)0x([a-f0-9]+(?:\.[a-f0-9]*)?|\.[a-f0-9]+)(?:p([+-]?\d+))?$/i.exec(token);
  let value: Decimal;
  if (hex) {
    const mantissa = hex[2] ?? "";
    const point = mantissa.indexOf(".");
    const fractionDigits = point < 0 ? 0 : mantissa.length - point - 1;
    const digits = mantissa.replace(".", "").replace(/^0+/, "");
    if (!digits) return new JudgeNumber(0);
    // 128 retained bits exceed native long-double precision; bound base conversion work.
    const retained = digits.slice(0, 32);
    const power =
      Number(hex[3] ?? 0) - 4 * fractionDigits + 4 * (digits.length - retained.length);
    value =
      power > 20_000
        ? new JudgeNumber(Infinity)
        : power < -20_000
          ? new JudgeNumber(0)
          : new JudgeNumber(BigInt(`0x${retained}`).toString()).times(
              new JudgeNumber(2).pow(power),
            );
    if (hex[1] === "-") value = value.negated();
  } else {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) return null;
    value = new JudgeNumber(token);
  }
  if (value.isFinite() && value.e > 4932) {
    return new JudgeNumber(value.isNegative() ? -Infinity : Infinity);
  }
  if (value.isFinite() && value.e < -4966) return new JudgeNumber(0);
  return value;
}

function tokensMatch(actual: string, expected: string, opts: CompareOptions): boolean {
  const tol = opts.floatTolerance;
  if (tol != null) {
    const reference = parseNumber(expected);
    if (reference !== null) {
      const value = parseNumber(actual);
      if (value === null) return false;
      if (reference.isNaN()) return value.isNaN();
      if (!reference.isFinite() || !value.isFinite()) return reference.eq(value);
      const diff = value.minus(reference).abs();
      return diff.lte(tol) || diff.lte(reference.abs().times(tol));
    }
  }
  if (opts.caseSensitive === false) {
    const fold = (token: string) => token.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    return fold(actual) === fold(expected);
  }
  return actual === expected;
}

export function compareStandard(
  actual: string,
  expected: string,
  opts: CompareOptions = {},
): boolean {
  const actualTokens = tokenize(actual);
  const expectedTokens = tokenize(expected);
  if (actualTokens.length !== expectedTokens.length) return false;
  return actualTokens.every((token, i) => tokensMatch(token, expectedTokens[i] ?? "", opts));
}
