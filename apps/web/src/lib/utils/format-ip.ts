// Strip `::ffff:` so v4-mapped v6 addresses display as plain IPv4.
export function formatIpForDisplay(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped?.[1] ?? ip;
}
