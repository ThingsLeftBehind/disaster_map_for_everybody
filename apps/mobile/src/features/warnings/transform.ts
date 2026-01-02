import type { JmaWarningsResponse, JmaWarningItem } from '../../api/types';
import type { TokyoMode } from './tokyoRouting';
import { PHENOMENON_COLOR_MAP, DEFAULT_PHENOMENON_COLOR, type ColorTheme } from './constants';

export type Severity = 'special' | 'warning' | 'advisory';

export type WarningViewModel = {
    countedWarnings: WarningDisplayItem[];
    areaDetailItems: AreaDetailBlock[];
    referenceWarnings: AreaDetailBlock[];
    summary: {
        special: number;
        warning: number;
        advisory: number;
    };
    meta: {
        isTokyoMainland: boolean;
        isTokyoIslands: boolean;
        areaDisplayName: string | null;
        primaryJmaAreaName: string | null;
    };
};

export type WarningDisplayItem = {
    id: string;
    kind: string;
    severity: Severity;
    phenomenon: string;
    color: ColorTheme;
    status: '発表' | '継続';
    warningName: string;
    levelLabel: '特別警報' | '警報' | '注意報';
};

export type AreaDetailBlock = {
    areaCode: string;
    areaName: string;
    hasActive: boolean;
    items: WarningDisplayItem[];
    isPrimary: boolean;
};

const ALLOWED_STATUSES = new Set(['発表', '継続']);
const EXCLUDED_KEYWORDS = ['明日', '明後日', '見込み', '予報'];

function normalizeStatus(status: string | null): '発表' | '継続' | null {
    if (!status) return null;
    const trimmed = status.trim();
    if (ALLOWED_STATUSES.has(trimmed)) return trimmed as '発表' | '継続';
    return null;
}

function isExcluded(item: JmaWarningItem): boolean {
    const text = `${item.kind ?? ''} ${item.status ?? ''}`;
    if (text.includes('解除')) return true;
    return EXCLUDED_KEYWORDS.some((word) => text.includes(word));
}

function getLevelLabel(kind: string): '特別警報' | '警報' | '注意報' | null {
    if (kind.includes('特別警報')) return '特別警報';
    if (kind.includes('警報')) return '警報';
    if (kind.includes('注意報')) return '注意報';
    return null;
}

function getSeverity(levelLabel: '特別警報' | '警報' | '注意報'): Severity {
    if (levelLabel === '特別警報') return 'special';
    if (levelLabel === '警報') return 'warning';
    return 'advisory';
}

function getWarningName(kind: string): string {
    const trimmed = kind.replace(/(特別警報|警報|注意報|情報)$/, '').trim();
    return trimmed || kind;
}

function getPhenomenon(kind: string): string {
    return getWarningName(kind).replace('落雷', '雷').trim();
}

function getPhenomenonColor(phenomenon: string): ColorTheme {
    return PHENOMENON_COLOR_MAP[phenomenon] || DEFAULT_PHENOMENON_COLOR;
}

function toDisplayItem(item: JmaWarningItem, areaCode: string): WarningDisplayItem | null {
    if (isExcluded(item)) return null;
    const status = normalizeStatus(item.status);
    if (!status) return null;
    const levelLabel = getLevelLabel(item.kind);
    if (!levelLabel) return null;
    const warningName = getWarningName(item.kind);
    const phenomenon = getPhenomenon(item.kind);
    return {
        id: item.id || `${areaCode}|${item.kind}|${status}`,
        kind: item.kind,
        severity: getSeverity(levelLabel),
        phenomenon,
        color: getPhenomenonColor(phenomenon),
        status,
        warningName,
        levelLabel,
    };
}

function statusPriority(status: '発表' | '継続'): number {
    return status === '継続' ? 2 : 1;
}

function dedupeByArea(items: WarningDisplayItem[], areaCode: string): WarningDisplayItem[] {
    // Stable key: areaCode + warningName + levelLabel
    const map = new Map<string, WarningDisplayItem>();
    for (const item of items) {
        const key = `${areaCode}|${item.warningName}|${item.levelLabel}`;
        const existing = map.get(key);
        if (!existing || statusPriority(item.status) > statusPriority(existing.status)) {
            map.set(key, item);
        }
    }
    return Array.from(map.values());
}

function buildAreaDetailItems(
    response: JmaWarningsResponse,
    targetAreaCode: string | null
): AreaDetailBlock[] {
    const breakdown = response.breakdown || null;
    const blocks: AreaDetailBlock[] = [];

    if (breakdown) {
        Object.entries(breakdown).forEach(([code, data]) => {
            const items = Array.isArray(data?.items)
                ? data.items
                    .map((item) => toDisplayItem(item, code))
                    .filter((item): item is WarningDisplayItem => Boolean(item))
                : [];
            const deduped = dedupeByArea(items, code);
            if (deduped.length === 0) return;
            blocks.push({
                areaCode: code,
                areaName: data.name,
                hasActive: true,
                items: deduped,
                isPrimary: targetAreaCode ? code === targetAreaCode : false,
            });
        });
    } else {
        const code = response.area;
        const items = Array.isArray(response?.items)
            ? response.items
                .map((item) => toDisplayItem(item, code))
                .filter((item): item is WarningDisplayItem => Boolean(item))
            : [];
        const deduped = dedupeByArea(items, code);
        if (deduped.length > 0) {
            blocks.push({
                areaCode: code,
                areaName: response.areaName || '対象地域',
                hasActive: true,
                items: deduped,
                isPrimary: true,
            });
        }
    }

    blocks.sort((a, b) => {
        if (a.isPrimary) return -1;
        if (b.isPrimary) return 1;
        return a.areaName.localeCompare(b.areaName);
    });

    return blocks;
}

function buildCountedWarnings(areaDetailItems: AreaDetailBlock[]): WarningDisplayItem[] {
    const map = new Map<string, WarningDisplayItem>();
    for (const block of areaDetailItems) {
        for (const item of block.items) {
            const key = `${item.warningName}|${item.levelLabel}`;
            const existing = map.get(key);
            if (!existing || statusPriority(item.status) > statusPriority(existing.status)) {
                map.set(key, item);
            }
        }
    }
    return Array.from(map.values());
}

type WarningsInput =
    | JmaWarningsResponse
    | {
        primary: JmaWarningsResponse | null;
        references?: JmaWarningsResponse[] | null;
    };

export function buildWarningsViewModel(
    input: WarningsInput | null,
    context: {
        muniCode: string | null;
        prefName: string | null;
        muniName: string | null;
        tokyoMode?: TokyoMode;
        class10Code: string | null;
        officeName: string | null;
        class10Name: string | null;
    }
): WarningViewModel {
    const empty: WarningViewModel = {
        countedWarnings: [],
        areaDetailItems: [],
        referenceWarnings: [],
        summary: { special: 0, warning: 0, advisory: 0 },
        meta: { isTokyoMainland: false, isTokyoIslands: false, areaDisplayName: null, primaryJmaAreaName: null },
    };

    if (!input) return empty;
    const primary = 'primary' in input ? input.primary : input;
    if (!primary) return empty;
    const references = 'primary' in input ? input.references ?? [] : [];

    const tokyoMode = context.tokyoMode ?? 'OTHER';
    const isTokyoMainland = tokyoMode === 'MAINLAND';
    const isTokyoIslands = tokyoMode === 'ISLANDS';

    // Prioritize generic class10Code from mapper
    const targetAreaCode = context.class10Code ?? null;

    // Fallback if no mapper provided (unlikely now): check internal muniMap if needed or default
    // const muniMap = primary.muniMap || {};
    // const targetAreaCode = context.muniCode ? muniMap[context.muniCode] ?? null : null;

    let areaDetailItems = buildAreaDetailItems(primary, targetAreaCode);
    let referenceWarnings: AreaDetailBlock[] = [];

    if (references.length > 0) {
        const referenceItems = references.flatMap((resp) => buildAreaDetailItems(resp, targetAreaCode));
        if (isTokyoMainland) {
            referenceWarnings = referenceItems;
        } else if (isTokyoIslands) {
            areaDetailItems = [...areaDetailItems, ...referenceItems];
        }
    }

    areaDetailItems.sort((a, b) => {
        if (a.isPrimary) return -1;
        if (b.isPrimary) return 1;
        return a.areaName.localeCompare(b.areaName);
    });

    referenceWarnings.sort((a, b) => a.areaName.localeCompare(b.areaName));

    const countedWarnings = buildCountedWarnings(areaDetailItems);
    const summary = { special: 0, warning: 0, advisory: 0 };
    countedWarnings.forEach((w) => {
        summary[w.severity]++;
    });

    const areaDisplayName =
        [context.prefName, context.muniName].filter((v) => typeof v === 'string' && v.trim()).join(' ').trim() || null;

    // Use official class10Name from mapper if available
    const primaryJmaAreaName =
        context.class10Name ||
        (targetAreaCode && primary.breakdown?.[targetAreaCode]?.name) ||
        primary.areaName ||
        null;

    return {
        countedWarnings,
        areaDetailItems,
        referenceWarnings,
        summary,
        meta: {
            isTokyoMainland,
            isTokyoIslands,
            areaDisplayName,
            primaryJmaAreaName,
        },
    };
}
