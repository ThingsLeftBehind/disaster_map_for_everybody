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

function warningDedupKey(item: WarningItem): string | null {
  const warningCode = typeof (item as any).warningCode === 'string' ? String((item as any).warningCode).trim() : '';
  const kind = String(item.kind ?? '').trim();
  if (!kind) return null;
  if (warningCode) return `code:${warningCode}`;
  const status = String(item.status ?? '').trim();
  return `status:${status}|kind:${kind}`;
}

export function buildWarningBuckets(items: WarningItem[]): WarningBuckets {
  const map = new Map<string, WarningGroup>();
  for (const it of items) {
    const key = warningDedupKey(it);
    if (!key) continue;
    const kind = String(it.kind ?? '').trim();
    if (!kind) continue;
    const base = getJmaWarningPriority(kind);
    const statusPriority = priorityFromStatus(it.status);
    const itemPriority = statusPriority ? maxPriority(base, statusPriority) : base;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        kind,
        count: 1,
        statuses: it.status ? [it.status] : [],
        priority: itemPriority,
      });
      continue;
    }
    existing.count += 1;
    if (it.status && !existing.statuses.includes(it.status)) existing.statuses.push(it.status);
    existing.priority = maxPriority(existing.priority, itemPriority);
  }

  const grouped = Array.from(map.values());
  return {
    urgent: grouped.filter((g) => g.priority === 'URGENT'),
    advisory: grouped.filter((g) => g.priority === 'ADVISORY'),
    reference: grouped.filter((g) => g.priority === 'REFERENCE'),
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
