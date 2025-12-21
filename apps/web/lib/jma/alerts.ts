import { getJmaWarningPriority, type JmaWarningPriority } from './filters';
import { getTokyoScopedItems, inferTokyoGroup, type TokyoGroupKey, type TokyoGroups, type WarningItem } from '../alerts/tokyoScope';

export type WarningGroup = {
  key: string;
  kind: string;
  count: number;
  statuses: string[];
  priority: JmaWarningPriority;
};

export type WarningBuckets = {
  urgent: WarningGroup[];
  advisory: WarningGroup[];
  reference: WarningGroup[];
};

export type WarningCounts = {
  urgent: number;
  advisory: number;
  reference: number;
  total: number;
};

const PRIORITY_RANK: Record<JmaWarningPriority, number> = { URGENT: 2, ADVISORY: 1, REFERENCE: 0 };

function maxPriority(a: JmaWarningPriority, b: JmaWarningPriority): JmaWarningPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

function priorityFromStatus(status: string | null | undefined): JmaWarningPriority | null {
  const s = String(status ?? '').trim();
  if (!s) return null;
  if (/(特別警報|警報)/.test(s) && !/注意報/.test(s)) return 'URGENT';
  if (/注意報/.test(s)) return 'ADVISORY';
  if (/(特別警報|警報)/.test(s)) return 'URGENT';
  return null;
}

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

export function buildWarningBuckets(items: WarningItem[]): WarningBuckets {
  const groups: WarningGroup[] = [];
  const grouped = groupByKind(items);
  for (const [kind, groupItems] of grouped.entries()) {
    if (groupItems.length === 0) continue;
    const representative = pickRepresentative(groupItems);
    const base = getJmaWarningPriority(kind);
    const statusPriority = priorityFromStatus(representative.status);
    const itemPriority = statusPriority ? maxPriority(base, statusPriority) : base;
    groups.push({
      key: kind,
      kind,
      count: groupItems.length,
      statuses: representative.status ? [representative.status] : [],
      priority: itemPriority,
    });
  }

  return {
    urgent: groups.filter((g) => g.priority === 'URGENT'),
    advisory: groups.filter((g) => g.priority === 'ADVISORY'),
    reference: groups.filter((g) => g.priority === 'REFERENCE'),
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
    urgent: buckets.urgent.length,
    advisory: buckets.advisory.length,
    reference: buckets.reference.length,
    total: buckets.urgent.length + buckets.advisory.length,
  };

  return {
    primaryItems,
    buckets,
    counts,
    isTokyoArea,
    tokyoGroup: isTokyoArea ? primaryGroup : null,
  };
}
