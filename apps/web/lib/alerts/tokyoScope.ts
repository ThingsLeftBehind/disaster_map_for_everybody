import { isJmaLowPriorityWarning } from '../jma/filters';
export type WarningItem = { id: string; kind: string; status: string | null; source?: string };
export type TokyoGroupKey = 'tokyo-mainland' | 'tokyo-izu-north' | 'tokyo-izu-south' | 'tokyo-ogasawara';
export type TokyoGroups = Partial<Record<TokyoGroupKey, { label: string; items: WarningItem[] }>>;
export type TokyoContext = 'MAINLAND' | 'ISLANDS' | 'OTHER';

export const TOKYO_GROUP_AREA_CODES: Record<TokyoGroupKey, Set<string>> = {
  'tokyo-mainland': new Set(['130010']),
  'tokyo-izu-north': new Set(['130020']),
  'tokyo-izu-south': new Set(['130030']),
  'tokyo-ogasawara': new Set(['130040']),
};

const TOKYO_ISLAND_CLASS20_GROUPS: Record<string, TokyoGroupKey> = {
  '1336100': 'tokyo-izu-north',
  '1336200': 'tokyo-izu-north',
  '1336300': 'tokyo-izu-north',
  '1336400': 'tokyo-izu-north',
  '1338100': 'tokyo-izu-south',
  '1338200': 'tokyo-izu-south',
  '1340100': 'tokyo-izu-south',
  '1340200': 'tokyo-izu-south',
  '1342100': 'tokyo-ogasawara',
};

const TOKYO_LABEL_GROUPS: Record<string, TokyoGroupKey> = {
  東京地方: 'tokyo-mainland',
  伊豆諸島北部: 'tokyo-izu-north',
  伊豆諸島南部: 'tokyo-izu-south',
  小笠原諸島: 'tokyo-ogasawara',
};

const TOKYO_ISLAND_MUNI_GROUPS: Record<string, TokyoGroupKey> = {
  大島町: 'tokyo-izu-north',
  利島村: 'tokyo-izu-north',
  新島村: 'tokyo-izu-north',
  神津島村: 'tokyo-izu-north',
  三宅村: 'tokyo-izu-south',
  御蔵島村: 'tokyo-izu-south',
  八丈町: 'tokyo-izu-south',
  青ヶ島村: 'tokyo-izu-south',
  小笠原村: 'tokyo-ogasawara',
};

export const TOKYO_GROUP_LABELS: Record<TokyoGroupKey, string> = {
  'tokyo-mainland': '東京地方（島しょ除く）',
  'tokyo-izu-north': '伊豆諸島北部',
  'tokyo-izu-south': '伊豆諸島南部',
  'tokyo-ogasawara': '小笠原諸島',
};

export function getTokyoGroupLabel(group: TokyoGroupKey | null | undefined): string | null {
  return group ? TOKYO_GROUP_LABELS[group] ?? null : null;
}

export function getTokyoGroupFromAreaCode(code?: string | null): TokyoGroupKey | null {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) return null;
  for (const [group, codes] of Object.entries(TOKYO_GROUP_AREA_CODES) as Array<[TokyoGroupKey, Set<string>]>) {
    if (codes.has(raw)) return group;
  }
  return null;
}

export function getTokyoContextFromGroup(group: TokyoGroupKey | null | undefined): TokyoContext {
  if (!group) return 'OTHER';
  return group === 'tokyo-mainland' ? 'MAINLAND' : 'ISLANDS';
}

export function inferTokyoGroup(args: {
  prefCode?: string | null;
  muniCode?: string | null;
  label?: string | null;
}): TokyoGroupKey | null {
  const muniCodeRaw = typeof args.muniCode === 'string' ? args.muniCode : null;
  const muniDigits = muniCodeRaw ? muniCodeRaw.replace(/\D/g, '') : null;
  if (muniDigits && muniDigits.length >= 5) {
    const base5 = muniDigits.slice(0, 5);
    if (base5.startsWith('13')) {
      const class20Code = `${base5}00`;
      return TOKYO_ISLAND_CLASS20_GROUPS[class20Code] ?? 'tokyo-mainland';
    }
  }

  const label = typeof args.label === 'string' ? args.label.trim() : '';
  if (label) {
    const byLabel = TOKYO_LABEL_GROUPS[label];
    if (byLabel) return byLabel;
    if (label.includes('伊豆諸島北部')) return 'tokyo-izu-north';
    if (label.includes('伊豆諸島南部')) return 'tokyo-izu-south';
    if (label.includes('小笠原諸島')) return 'tokyo-ogasawara';
    for (const [name, group] of Object.entries(TOKYO_ISLAND_MUNI_GROUPS)) {
      if (label.includes(name)) return group;
    }
    if (label.includes('東京都')) return 'tokyo-mainland';
  }

  const prefCode = typeof args.prefCode === 'string' ? args.prefCode : null;
  if (prefCode === '13') return 'tokyo-mainland';

  return null;
}

export function getTokyoContext(args: {
  prefCode?: string | null;
  muniCode?: string | null;
  label?: string | null;
}): TokyoContext {
  return getTokyoContextFromGroup(inferTokyoGroup(args));
}

export function getTokyoContextFromMuniCode(muniCode?: string | null): TokyoContext {
  return getTokyoContext({ muniCode });
}

export function countWarningItems(items: WarningItem[]): number {
  return items.filter((it) => !isJmaLowPriorityWarning(it?.kind)).length;
}

export function getTokyoScopedItems(args: {
  items: WarningItem[];
  tokyoGroups: TokyoGroups | null;
  isTokyoArea: boolean;
  primaryGroup: TokyoGroupKey;
}): {
  primaryItems: WarningItem[];
  sharedItems: WarningItem[];
  secondaryGroups: Array<{ key: TokyoGroupKey; label: string; items: WarningItem[] }>;
} {
  const { items, tokyoGroups, isTokyoArea, primaryGroup } = args;
  if (!isTokyoArea || !tokyoGroups) {
    return { primaryItems: items, sharedItems: [], secondaryGroups: [] };
  }

  const primaryItems = tokyoGroups[primaryGroup]?.items ?? [];
  return { primaryItems, sharedItems: [], secondaryGroups: [] };
}
