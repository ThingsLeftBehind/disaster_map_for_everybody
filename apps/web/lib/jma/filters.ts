const PERIODIC_RE = /(定時|定期)(?:報|情報)?/;
const FORECASTISH_RE = /(可能性|見込み|参考|見通し|予想|予報|明日|明後日)/;
const INACTIVE_STATUS_RE = /(解除|解消|取消|取り消し|中止|終了|なし|ありません)/;

export type WarningLevel = 'special' | 'warning' | 'advisory';

export type JmaWarningPriority = 'URGENT' | 'ADVISORY' | 'REFERENCE';

export function isJmaPeriodicWarning(kind: string | null | undefined): boolean {
  if (!kind) return false;
  return PERIODIC_RE.test(kind);
}

export function isJmaForecastishWarning(kind: string | null | undefined): boolean {
  if (!kind) return false;
  return FORECASTISH_RE.test(kind);
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

export function getWarningLevel(kind: string | null | undefined, status?: string | null): WarningLevel | null {
  const combined = `${normalizeText(kind)} ${normalizeText(status)}`.trim();
  if (!combined) return null;
  if (/特別警報/.test(combined)) return 'special';
  if (/警報/.test(combined) && !/注意報/.test(combined)) return 'warning';
  if (/注意報/.test(combined)) return 'advisory';
  if (/警報/.test(combined)) return 'warning';
  return null;
}

export function isActiveWarningItem(item: { kind?: string | null; status?: string | null }): boolean {
  const kind = normalizeText(item.kind);
  const status = normalizeText(item.status);
  const combined = `${kind} ${status}`.trim();
  if (!getWarningLevel(kind, status)) return false;
  if (isJmaForecastishWarning(kind) || FORECASTISH_RE.test(status) || FORECASTISH_RE.test(combined)) return false;
  if (INACTIVE_STATUS_RE.test(status) || INACTIVE_STATUS_RE.test(combined)) return false;
  return true;
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
