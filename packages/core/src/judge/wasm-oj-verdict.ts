export function wasmOjTerminationVerdict(
  termination: string,
  exitCode: number,
): "AC" | "TLE" | "MLE" | "RE" {
  if (
    termination === "instruction-limit" ||
    termination === "logical-time-limit" ||
    termination === "wall-time-limit"
  ) {
    return "TLE";
  }
  if (termination === "memory-limit") return "MLE";
  if (termination === "exited" && exitCode === 0) return "AC";
  return "RE";
}
