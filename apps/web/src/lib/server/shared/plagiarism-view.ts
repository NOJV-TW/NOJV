interface PlagiarismReportLike<S extends string> {
  status: S;
  reportUrl: string | null;
  triggeredAt: Date | null;
  completedAt: Date | null;
  results: unknown;
}

export function serializePlagiarismReport<S extends string>(
  report: PlagiarismReportLike<S> | null,
) {
  return report
    ? {
        status: report.status,
        reportUrl: report.reportUrl,
        triggeredAt: report.triggeredAt?.toISOString() ?? null,
        completedAt: report.completedAt?.toISOString() ?? null,
        results: report.results,
      }
    : null;
}

interface PlagiarismFlagLike {
  id: string;
  pairKey: string;
  flaggedBy: string;
  flaggedAt: Date;
  note: string | null;
}

export function serializePlagiarismFlags(flags: readonly PlagiarismFlagLike[]) {
  return flags.map((flag) => ({
    id: flag.id,
    pairKey: flag.pairKey,
    flaggedBy: flag.flaggedBy,
    flaggedAt: flag.flaggedAt.toISOString(),
    note: flag.note,
  }));
}
