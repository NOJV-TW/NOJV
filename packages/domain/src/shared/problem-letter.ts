// 1-based: 1→A, 26→Z, 27→AA, 28→AB.
export function problemLetter(ordinal: number): string {
  if (ordinal < 1) return String(ordinal);
  let n = ordinal;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function problemLetterByIndex(index: number): string {
  return problemLetter(index + 1);
}
