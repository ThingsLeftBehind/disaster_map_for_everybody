import { isJmaLowPriorityWarning } from '../jma/filters';
export type WarningItem = { id: string; kind: string; status: string | null; source?: string };
export type TokyoGroupKey = 'mainland' | 'izu' | 'ogasawara';
export type TokyoGroups = Partial<Record<TokyoGroupKey, { label: string; items: WarningItem[] }>>;

const TOKYO_ISLAND_CLASS20_GROUPS: Record<string, TokyoGroupKey> = {
  '1336100': 'izu',
  '1336200': 'izu',
  '1336300': 'izu',
  '1336400': 'izu',
  '1338100': 'izu',
  '1338200': 'izu',
  '1340100': 'izu',
  '1340200': 'izu',
  '1342100': 'ogasawara',
};

const TOKYO_LABEL_GROUPS: Record<string, TokyoGroupKey> = {
  東京地方: 'mainland',
  伊豆諸島: 'izu',
  小笠原諸島: 'ogasawara',
};

const TOKYO_ISLAND_MUNI_GROUPS: Record<string, TokyoGroupKey> = {
  大島町: 'izu',
  利島村: 'izu',
  新島村: 'izu',
  神津島村: 'izu',
  三宅村: 'izu',
  御蔵島村: 'izu',
  八丈町: 'izu',
  青ヶ島村: 'izu',
  小笠原村: 'ogasawara',
};

export function inferTokyoGroup(args: {
  prefCode?: string | null;
  muniCode?: string | null;
  label?: string | null;
}): TokyoGroupKey | null {
  const muniCode = typeof args.muniCode === 'string' ? args.muniCode : null;
  if (muniCode && /^\d{6}$/.test(muniCode) && muniCode.startsWith('13')) {
    const class20Code = `${muniCode}00`;
    return TOKYO_ISLAND_CLASS20_GROUPS[class20Code] ?? 'mainland';
  }

  const label = typeof args.label === 'string' ? args.label.trim() : '';
  if (label) {
    const byLabel = TOKYO_LABEL_GROUPS[label];
    if (byLabel) return byLabel;
    for (const [name, group] of Object.entries(TOKYO_ISLAND_MUNI_GROUPS)) {
      if (label.includes(name)) return group;
    }
    if (label.includes('東京都')) return 'mainland';
  }

  const prefCode = typeof args.prefCode === 'string' ? args.prefCode : null;
  if (prefCode === '13') return 'mainland';

  return null;
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
