import { AccessibilityLevel, CongestionLevel } from '@jp-evac/shared';
import { SiteStatusReport } from '@prisma/client';

type CountMap<T extends string> = Record<T, number>;

type Summary = {
  congestion: CongestionLevel | null;
  accessibility: AccessibilityLevel | null;
  counts: number;
  updatedAt: Date | null;
};

function topKey<T extends string>(counts: CountMap<T>) {
  return Object.entries(counts).reduce<{ key: T | null; count: number }>((acc, [key, value]) => {
    if (value > acc.count) return { key: key as T, count: value };
    return acc;
  }, { key: null, count: 0 }).key;
}

export function summarizeReports(reports: SiteStatusReport[]): Summary {
  const congestionCounts = reports.reduce<CountMap<CongestionLevel>>(
    (acc, report) => ({ ...acc, [report.congestionLevel]: (acc[report.congestionLevel] ?? 0) + 1 }),
    { low: 0, normal: 0, high: 0 }
  );
  const accessibilityCounts = reports.reduce<CountMap<AccessibilityLevel>>(
    (acc, report) => ({ ...acc, [report.accessibility]: (acc[report.accessibility] ?? 0) + 1 }),
    { accessible: 0, blocked: 0, unknown: 0 }
  );
  const updatedAt = reports.length ? reports.reduce((latest, report) => (report.reportedAt > latest ? report.reportedAt : latest), reports[0].reportedAt) : null;
  return {
    congestion: topKey(congestionCounts),
    accessibility: topKey(accessibilityCounts),
    counts: reports.length,
    updatedAt
  };
}
