const MB = 1024 * 1024;

export function formatBudget(used: number, limit: number): string {
  return `${formatBytes(used)} / ${formatBytes(limit)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < MB) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : kb.toFixed(0)} KB`;
  }
  const mb = bytes / MB;
  return `${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB`;
}
