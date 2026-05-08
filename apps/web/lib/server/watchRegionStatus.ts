import { getHokkaidoWarningOfficeCodes } from 'lib/jma/areaHierarchy';
import { getJmaWarnings } from 'lib/jma/service';
import type { NormalizedWarningItem } from 'lib/jma/types';
import { toJmaClass20 } from 'lib/muni-helper';
import type { SavedPlaceRegion } from './watchRegions';

export type WatchRegionFetchStatus = 'OK' | 'EMPTY' | 'PARTIAL' | 'DOWN';
export type RiskLevel = 'normal' | 'advisory' | 'warning' | 'emergency' | 'unknown';

export type RegionStatus = {
  riskLevel: RiskLevel;
  label: '通常' | '注意' | '警戒' | '危険' | '不明';
  summary: string;
  warnings: Array<{
    name: string;
    kind: 'advisory' | 'warning' | 'emergency';
    areaName: string | null;
    areaCode: string | null;
    status: string | null;
  }>;
  fetchStatus: WatchRegionFetchStatus;
  updatedAt: string | null;
};

export type RegionJmaSelection = {
  prefCode: string | null;
  muniCode: string | null;
  areaCode: string | null;
  class20Code: string | null;
  address: string | null;
};

export type RegionWithStatus = SavedPlaceRegion & {
  status: RegionStatus;
  alertLink: string;
  jma: RegionJmaSelection;
};

export type RegionNotificationCandidate = {
  fingerprint: string;
  title: string;
  body: string;
  url: string;
  riskLevel: Exclude<RiskLevel, 'normal' | 'unknown'>;
};

type ReverseGeocodeResult = {
  prefCode: string | null;
  muniCode: string | null;
  address: string | null;
};

const REVERSE_GEOCODER_TIMEOUT_MS = 4500;
const MAX_VISIBLE_WARNINGS = 5;

function computeLocalGovCheckDigit(code5: string): string {
  const digits = code5.split('').map((ch) => Number(ch));
  if (digits.length !== 5 || digits.some((d) => !Number.isFinite(d))) return '0';
  const weights = [6, 5, 4, 3, 2];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const remainder = sum % 11;
  const cd = (11 - remainder) % 11;
  return cd === 10 ? '0' : String(cd);
}

function normalizeMuniCode(raw: unknown): { muniCode: string | null; prefCode: string | null } {
  if (typeof raw !== 'string') return { muniCode: null, prefCode: null };
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { muniCode: null, prefCode: null };

  if (digits.length === 6) {
    const prefCode = digits.slice(0, 2);
    return { muniCode: digits, prefCode: /^\d{2}$/.test(prefCode) ? prefCode : null };
  }

  if (digits.length <= 5) {
    const base5 = digits.padStart(5, '0');
    if (!/^\d{5}$/.test(base5)) return { muniCode: null, prefCode: null };
    const prefCode = base5.slice(0, 2);
    return { muniCode: `${base5}${computeLocalGovCheckDigit(base5)}`, prefCode };
  }

  return { muniCode: null, prefCode: null };
}

async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocodeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVERSE_GEOCODER_TIMEOUT_MS);
  try {
    const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${encodeURIComponent(
      lon
    )}&lat=${encodeURIComponent(lat)}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GSI reverse geocoder HTTP ${res.status}`);
    const json = await res.json();
    const results = json?.results ?? null;
    const { muniCode, prefCode } = normalizeMuniCode(results?.muniCd);
    const address = [results?.lv01Nm, results?.lv02Nm, results?.lv03Nm, results?.lv04Nm]
      .filter((v: unknown) => typeof v === 'string' && v.trim())
      .join('');
    return { prefCode, muniCode, address: address || null };
  } finally {
    clearTimeout(timeout);
  }
}

function isInactiveStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim();
  if (!s) return true;
  if (/解除/.test(s)) return true;
  if (/発表警報・注意報は?なし/.test(s)) return true;
  if (/発表警報・注意報は?ありません/.test(s)) return true;
  return false;
}

function warningRank(item: NormalizedWarningItem): 0 | 1 | 2 | 3 {
  const kind = item.kind ?? '';
  if (/特別警報/.test(kind)) return 3;
  if (/警報/.test(kind) && !/注意報/.test(kind)) return 2;
  if (/注意報/.test(kind)) return 1;
  return 0;
}

function warningKind(item: NormalizedWarningItem): 'advisory' | 'warning' | 'emergency' {
  const rank = warningRank(item);
  if (rank >= 3) return 'emergency';
  if (rank >= 2) return 'warning';
  return 'advisory';
}

function dedupeItems(items: NormalizedWarningItem[]): NormalizedWarningItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.areaCode ?? ''}|${item.kind}|${item.status ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterItemsForClass20(items: NormalizedWarningItem[], class20: string | null): NormalizedWarningItem[] {
  const active = items.filter((item) => !isInactiveStatus(item.status));
  if (!class20) return active;
  const exact = active.filter((item) => item.areaCode === class20);
  return exact.length > 0 ? exact : [];
}

export async function fetchWarningsForRegionArea(areaCode: string, class20: string | null): Promise<{
  items: NormalizedWarningItem[];
  fetchStatus: WatchRegionFetchStatus;
  updatedAt: string | null;
}> {
  if (areaCode === '010000') {
    const officeCodes = await getHokkaidoWarningOfficeCodes();
    const settled = await Promise.allSettled(officeCodes.map((officeCode) => getJmaWarnings(officeCode)));
    let succeeded = 0;
    let failed = 0;
    let updatedAt: string | null = null;
    const items: NormalizedWarningItem[] = [];

    for (const result of settled) {
      if (result.status === 'rejected') {
        failed += 1;
        continue;
      }
      const data = result.value;
      if (data.fetchStatus === 'DOWN' && !data.updatedAt) failed += 1;
      else succeeded += 1;
      if (data.updatedAt && (!updatedAt || Date.parse(data.updatedAt) > Date.parse(updatedAt))) updatedAt = data.updatedAt;
      items.push(...filterItemsForClass20(data.items, class20));
    }

    if (succeeded === 0) return { items: [], fetchStatus: 'DOWN', updatedAt };
    const deduped = dedupeItems(items);
    return {
      items: deduped,
      fetchStatus: failed > 0 ? 'PARTIAL' : deduped.length > 0 ? 'OK' : 'EMPTY',
      updatedAt,
    };
  }

  const data = await getJmaWarnings(areaCode);
  const items = dedupeItems(filterItemsForClass20(data.items, class20));
  const fetchStatus: WatchRegionFetchStatus =
    data.fetchStatus === 'DOWN' ? 'DOWN' : items.length > 0 ? 'OK' : data.fetchStatus === 'OK' ? 'EMPTY' : 'PARTIAL';
  return { items, fetchStatus, updatedAt: data.updatedAt };
}

export function buildRegionStatus(args: {
  items: NormalizedWarningItem[];
  fetchStatus: WatchRegionFetchStatus;
  updatedAt: string | null;
}): RegionStatus {
  if (args.fetchStatus === 'DOWN') {
    return {
      riskLevel: 'unknown',
      label: '不明',
      summary: '情報を取得できませんでした',
      warnings: [],
      fetchStatus: args.fetchStatus,
      updatedAt: args.updatedAt,
    };
  }

  const items = args.items
    .filter((item) => warningRank(item) > 0)
    .sort((a, b) => warningRank(b) - warningRank(a) || String(a.kind).localeCompare(String(b.kind), 'ja'));
  const highest = items.reduce((rank, item) => Math.max(rank, warningRank(item)), 0);
  const riskLevel: RiskLevel = highest >= 3 ? 'emergency' : highest >= 2 ? 'warning' : highest >= 1 ? 'advisory' : 'normal';
  const label = riskLevel === 'emergency' ? '危険' : riskLevel === 'warning' ? '警戒' : riskLevel === 'advisory' ? '注意' : '通常';
  const summary =
    riskLevel === 'normal'
      ? '該当なし'
      : riskLevel === 'emergency'
        ? '特別警報あり'
        : riskLevel === 'warning'
          ? '警報あり'
          : '注意報あり';

  return {
    riskLevel,
    label,
    summary,
    warnings: items.slice(0, MAX_VISIBLE_WARNINGS).map((item) => ({
      name: item.kind,
      kind: warningKind(item),
      areaName: item.areaName ?? null,
      areaCode: item.areaCode ?? null,
      status: item.status ?? null,
    })),
    fetchStatus: args.fetchStatus,
    updatedAt: args.updatedAt,
  };
}

function unknownStatus(): RegionStatus {
  return {
    riskLevel: 'unknown',
    label: '不明',
    summary: '情報を取得できませんでした',
    warnings: [],
    fetchStatus: 'DOWN',
    updatedAt: null,
  };
}

function unknownJmaSelection(): RegionJmaSelection {
  return {
    prefCode: null,
    muniCode: null,
    areaCode: null,
    class20Code: null,
    address: null,
  };
}

export function buildAlertLink(regionId: string): string {
  return `/alerts?watchRegionId=${encodeURIComponent(regionId)}`;
}

export async function resolveRegionStatus(region: SavedPlaceRegion): Promise<RegionWithStatus> {
  try {
    const geocode = await reverseGeocode(region.latitude, region.longitude);
    const prefCode = geocode.prefCode;
    const areaCode = prefCode && /^\d{2}$/.test(prefCode) ? `${prefCode}0000` : null;
    const class20Code = toJmaClass20(geocode.muniCode);
    const jma: RegionJmaSelection = {
      prefCode,
      muniCode: geocode.muniCode,
      areaCode,
      class20Code,
      address: geocode.address,
    };

    if (!areaCode) {
      return { ...region, status: unknownStatus(), alertLink: buildAlertLink(region.id), jma };
    }

    const warningResult = await fetchWarningsForRegionArea(areaCode, class20Code);
    return {
      ...region,
      address: region.address ?? geocode.address,
      status: buildRegionStatus(warningResult),
      alertLink: buildAlertLink(region.id),
      jma,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[watch-region-status] region_status_failed', { regionId: region.id, error: message });
    return { ...region, status: unknownStatus(), alertLink: buildAlertLink(region.id), jma: unknownJmaSelection() };
  }
}

export function buildRegionNotificationCandidate(region: RegionWithStatus): RegionNotificationCandidate | null {
  if (region.status.riskLevel === 'normal' || region.status.riskLevel === 'unknown') return null;
  if (region.status.warnings.length === 0) return null;

  const warningKeys = region.status.warnings
    .map((warning) => `${warning.areaCode ?? ''}:${warning.name}:${warning.status ?? ''}`)
    .sort();
  const fingerprint = [
    'jma-warning',
    region.id,
    region.jma.areaCode ?? 'unknown-area',
    region.jma.class20Code ?? 'all',
    region.status.updatedAt ?? 'unknown-time',
    warningKeys.join('|'),
  ].join(':');
  const warningNames = region.status.warnings.map((warning) => warning.name).slice(0, 3);
  const suffix = region.status.warnings.length > 3 ? `ほか${region.status.warnings.length - 3}件` : '';
  return {
    fingerprint,
    title: `${region.label}に${region.status.summary}`,
    body: [warningNames.join('、'), suffix].filter(Boolean).join('、') || '警報・注意報が発表されています。',
    url: buildAlertLink(region.id),
    riskLevel: region.status.riskLevel,
  };
}
