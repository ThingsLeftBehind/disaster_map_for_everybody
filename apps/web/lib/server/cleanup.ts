import { prisma, Prisma } from 'lib/db/prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
const SAFETY_RETENTION_DAYS = 7;
const SITE_DELETED_RETENTION_DAYS = 7;
const SITE_REPORTED_RETENTION_DAYS = 10;

export type CleanupCutoffs = {
  safetyDeletedBefore: string;
  safetyExpiredBefore: string;
  siteDeletedBefore: string;
  siteReportedBefore: string;
};

export type CleanupResult = {
  ok: boolean;
  dryRun: boolean;
  deletedSafetyStatusCount: number;
  deletedSiteStatusReportCount: number;
  cutoffs: CleanupCutoffs;
  errors: string[];
};

function createCutoffs(now: Date): {
  safetyDeletedBefore: Date;
  safetyExpiredBefore: Date;
  siteDeletedBefore: Date;
  siteReportedBefore: Date;
} {
  return {
    safetyDeletedBefore: new Date(now.getTime() - SAFETY_RETENTION_DAYS * DAY_MS),
    safetyExpiredBefore: new Date(now.getTime() - SAFETY_RETENTION_DAYS * DAY_MS),
    siteDeletedBefore: new Date(now.getTime() - SITE_DELETED_RETENTION_DAYS * DAY_MS),
    siteReportedBefore: new Date(now.getTime() - SITE_REPORTED_RETENTION_DAYS * DAY_MS),
  };
}

export function buildCleanupFilters(now = new Date()): {
  cutoffs: CleanupCutoffs;
  safetyStatusWhere: Prisma.SafetyStatusWhereInput;
  siteStatusReportWhere: Prisma.SiteStatusReportWhereInput;
} {
  const cutoffDates = createCutoffs(now);
  const cutoffs: CleanupCutoffs = {
    safetyDeletedBefore: cutoffDates.safetyDeletedBefore.toISOString(),
    safetyExpiredBefore: cutoffDates.safetyExpiredBefore.toISOString(),
    siteDeletedBefore: cutoffDates.siteDeletedBefore.toISOString(),
    siteReportedBefore: cutoffDates.siteReportedBefore.toISOString(),
  };

  const safetyStatusWhere: Prisma.SafetyStatusWhereInput = {
    OR: [
      { deletedAt: { lt: cutoffDates.safetyDeletedBefore } },
      { expiresAt: { lt: cutoffDates.safetyExpiredBefore } },
    ],
  };

  const siteStatusReportWhere: Prisma.SiteStatusReportWhereInput = {
    OR: [
      { deletedAt: { lt: cutoffDates.siteDeletedBefore } },
      { reportedAt: { lt: cutoffDates.siteReportedBefore } },
    ],
  };

  return { cutoffs, safetyStatusWhere, siteStatusReportWhere };
}

export async function runCleanup(args: { dryRun: boolean; now?: Date }): Promise<CleanupResult> {
  const { cutoffs, safetyStatusWhere, siteStatusReportWhere } = buildCleanupFilters(args.now ?? new Date());

  if (args.dryRun) {
    const [deletedSafetyStatusCount, deletedSiteStatusReportCount] = await Promise.all([
      prisma.safetyStatus.count({ where: safetyStatusWhere }),
      prisma.siteStatusReport.count({ where: siteStatusReportWhere }),
    ]);

    return {
      ok: true,
      dryRun: true,
      deletedSafetyStatusCount,
      deletedSiteStatusReportCount,
      cutoffs,
      errors: [],
    };
  }

  const [safetyDeleteResult, siteDeleteResult] = await prisma.$transaction([
    prisma.safetyStatus.deleteMany({ where: safetyStatusWhere }),
    prisma.siteStatusReport.deleteMany({ where: siteStatusReportWhere }),
  ]);

  return {
    ok: true,
    dryRun: false,
    deletedSafetyStatusCount: safetyDeleteResult.count,
    deletedSiteStatusReportCount: siteDeleteResult.count,
    cutoffs,
    errors: [],
  };
}
