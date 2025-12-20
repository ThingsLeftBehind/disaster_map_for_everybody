const PERIODIC_RE = /(定時|定期)(?:報|情報)?/;
const FORECASTISH_RE = /(可能性|見込み|参考|見通し|予想)/;

export type JmaWarningPriority = 'URGENT' | 'ADVISORY' | 'REFERENCE';

export function isJmaPeriodicWarning(kind: string | null | undefined): boolean {
  if (!kind) return false;
  return PERIODIC_RE.test(kind);
}

export function isJmaForecastishWarning(kind: string | null | undefined): boolean {
  if (!kind) return false;
  return FORECASTISH_RE.test(kind);
}

export function getJmaWarningPriority(kind: string | null | undefined): JmaWarningPriority {
  if (!kind) return 'REFERENCE';
  if (isJmaPeriodicWarning(kind) || isJmaForecastishWarning(kind)) return 'REFERENCE';
  if (/(特別警報|警報)/.test(kind) && !/注意報/.test(kind)) return 'URGENT';
  if (/注意報/.test(kind)) return 'ADVISORY';
  if (/(特別警報|警報)/.test(kind)) return 'URGENT';
  return 'REFERENCE';
}

export function isJmaLowPriorityWarning(kind: string | null | undefined): boolean {
  return getJmaWarningPriority(kind) === 'REFERENCE';
}
