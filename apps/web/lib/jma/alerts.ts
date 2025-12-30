import { getWarningLevel, isActiveWarningItem, type WarningLevel } from './filters';
import { getTokyoScopedItems, inferTokyoGroup, type TokyoGroupKey, type TokyoGroups, type WarningItem } from '../alerts/tokyoScope';

export type WarningGroup = {
  key: string;
  kind: string;
  count: number;
  statuses: string[];
  level: WarningLevel;
};

export type WarningBuckets = {
  special: WarningGroup[];
  warning: WarningGroup[];
  advisory: WarningGroup[];
};

export type WarningCounts = {
  special: number;
  warning: number;
  advisory: number;
  total: number;
};

const LEVEL_ORDER: Record<WarningLevel, number> = { special: 3, warning: 2, advisory: 1 };

function statusRank(status: string | null | undefined): number {
  const s = String(status ?? '').trim();
  if (!s) return 0;
  if (s.includes('継続')) return 2;
  if (s.includes('発表')) return 1;
  return 0;
}

function warningUpdatedAt(item: WarningItem): number {
  const candidates = [(item as any).updatedAt, (item as any).updated, (item as any).time, (item as any).published];
  for (const raw of candidates) {
    if (!raw) continue;
    const t = Date.parse(String(raw));
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function pickRepresentative(items: WarningItem[]): WarningItem {
  let best = items[0];
  let bestRank = statusRank(best.status);
  let bestUpdated = warningUpdatedAt(best);
  for (let i = 1; i < items.length; i += 1) {
    const candidate = items[i];
    const rank = statusRank(candidate.status);
    if (rank > bestRank) {
      best = candidate;
      bestRank = rank;
      bestUpdated = warningUpdatedAt(candidate);
      continue;
    }
    if (rank === bestRank) {
      const updated = warningUpdatedAt(candidate);
      if (updated > bestUpdated) {
        best = candidate;
        bestUpdated = updated;
      }
    }
  }
  return best;
}

function groupByKind(items: WarningItem[]): Map<string, WarningItem[]> {
  const map = new Map<string, WarningItem[]>();
  for (const it of items) {
    const kind = String(it.kind ?? '').trim();
    if (!kind) continue;
    const bucket = map.get(kind);
    if (bucket) bucket.push(it);
    else map.set(kind, [it]);
  }
  return map;
}


// Helper for normalizing full-width chars
function normalizeString(s: string | null | undefined): string {
  if (!s) return '';
  // Normalize full-width alphanumeric to half-width
  const half = s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  return half.trim().replace(/\s+/g, ' ');
}

export function uniqByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const m = new Map<string, T>();
  for (const it of items) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, it);
  }
  return Array.from(m.values());
}

export function deduplicateWarnings(items: WarningItem[], defaultAreaCode?: string | null): WarningItem[] {
  return uniqByKey(items, (item) => {
    // Stable key construction
    const kindCode = (item as any).kindCode || (item as any).code || '';
    const kind = normalizeString(item.kind);
    const status = normalizeString(item.status);
    const level = getWarningLevel(kind, status) ?? '';

    // key = `${areaCode}|${kindCode}|${kind}|${level}`
    // If kindCode matches, we are confident. If not, we rely on kind string + level.
    return `${defaultAreaCode ?? ''}|${kindCode}|${kind}|${level}`;
  });
}

// Helper to dedupe purely by 'kind' label for display (e.g. chips)
export function deduplicateKindsForDisplay(items: WarningItem[]): WarningItem[] {
  return uniqByKey(items, (item) => normalizeString(item.kind));
}

export function buildWarningBuckets(items: WarningItem[]): WarningBuckets {
  // Deduplicate first!
  const activeItems = items.filter((item) => isActiveWarningItem(item));
  const uniqueItems = deduplicateWarnings(activeItems);

  const groups: WarningGroup[] = [];
  const grouped = groupByKind(uniqueItems);
  for (const [kind, groupItems] of grouped.entries()) {
    if (groupItems.length === 0) continue;
    const representative = pickRepresentative(groupItems);
    const level = getWarningLevel(kind, representative.status);
    if (!level) continue;
    groups.push({
      key: kind,
      kind,
      count: groupItems.length,
      statuses: representative.status ? [representative.status] : [],
      level,
    });
  }

  return {
    special: groups.filter((g) => g.level === 'special').sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]),
    warning: groups.filter((g) => g.level === 'warning').sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]),
    advisory: groups.filter((g) => g.level === 'advisory').sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]),
  };
}

export function shapeAlertWarnings(args: {
  warnings: { area?: string | null; items?: WarningItem[]; tokyoGroups?: TokyoGroups | null } | null | undefined;
  area: { prefCode?: string | null; muniCode?: string | null; label?: string | null };
}): {
  primaryItems: WarningItem[];
  buckets: WarningBuckets;
  counts: WarningCounts;
  isTokyoArea: boolean;
  tokyoGroup: TokyoGroupKey | null;
} {
  const items = Array.isArray(args.warnings?.items) ? (args.warnings?.items as WarningItem[]) : [];
  const tokyoGroups = (args.warnings?.tokyoGroups as TokyoGroups | null) ?? null;
  const isTokyoArea = Boolean(tokyoGroups && args.warnings?.area === '130000');
  const inferredTokyoGroup = inferTokyoGroup({
    prefCode: args.area.prefCode ?? null,
    muniCode: args.area.muniCode ?? null,
    label: args.area.label ?? null,
  });
  const primaryGroup: TokyoGroupKey = inferredTokyoGroup ?? 'mainland';
  const { primaryItems } = getTokyoScopedItems({
    items,
    tokyoGroups,
    isTokyoArea,
    primaryGroup,
  });
  const buckets = buildWarningBuckets(primaryItems);
  const counts = {
    special: buckets.special.length,
    warning: buckets.warning.length,
    advisory: buckets.advisory.length,
    total: buckets.special.length + buckets.warning.length + buckets.advisory.length,
  };

  return {
    primaryItems,
    buckets,
    counts,
    isTokyoArea,
    tokyoGroup: isTokyoArea ? primaryGroup : null,
  };
}
