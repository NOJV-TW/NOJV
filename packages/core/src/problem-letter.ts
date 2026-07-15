export function problemLetter(ordinal: number): string {
  if (ordinal < 1) return String(ordinal);
  let n = ordinal;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCodePoint(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}
