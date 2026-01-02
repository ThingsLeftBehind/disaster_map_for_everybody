export const TOKYO_PREF_CODE = '13';

export type TokyoMode = 'MAINLAND' | 'ISLANDS' | 'OTHER';
type TokyoGroupKey = 'mainland' | 'izu' | 'ogasawara';

// Values aligned with apps/web/lib/alerts/tokyoScope.ts
const TOKYO_GROUP_AREA_CODES: Record<TokyoGroupKey, string[]> = {
    mainland: ['130010'],
    izu: ['130020', '130030'],
    ogasawara: ['130040'],
};

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

function getTokyoGroupFromAreaCode(areaCode?: string | null): TokyoGroupKey | null {
    const raw = typeof areaCode === 'string' ? areaCode.trim() : '';
    if (!raw) return null;
    for (const [group, codes] of Object.entries(TOKYO_GROUP_AREA_CODES) as Array<[TokyoGroupKey, string[]]>) {
        if (codes.includes(raw)) return group;
    }
    return null;
}

function normalizeDigits(value: string | null): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    return digits.length ? digits : null;
}

function getTokyoGroupFromMuniCode(muniCode: string | null, muniMap?: Record<string, string> | null): TokyoGroupKey | null {
    const normalized = normalizeDigits(muniCode);
    if (!normalized || !normalized.startsWith(TOKYO_PREF_CODE)) return null;

    if (muniMap && normalized.length >= 5) {
        const mapped = muniMap[normalized];
        const byArea = getTokyoGroupFromAreaCode(mapped);
        if (byArea) return byArea;
    }

    const base5 = normalized.slice(0, 5);
    if (base5.length === 5 && base5.startsWith(TOKYO_PREF_CODE)) {
        const class20 = `${base5}00`;
        return TOKYO_ISLAND_CLASS20_GROUPS[class20] ?? 'mainland';
    }

    return null;
}

export function getTokyoAreaRouting(
    muniCode: string | null,
    muniMap?: Record<string, string> | null
): {
    primaryAreaCode: string;
    referenceAreaCodes: string[];
    mode: TokyoMode;
} {
    const normalized = normalizeDigits(muniCode);
    if (!normalized) {
        return { primaryAreaCode: '130000', referenceAreaCodes: [], mode: 'OTHER' };
    }

    const prefCode = normalized.slice(0, 2);
    if (prefCode !== TOKYO_PREF_CODE) {
        return { primaryAreaCode: `${prefCode}0000`, referenceAreaCodes: [], mode: 'OTHER' };
    }

    const group = getTokyoGroupFromMuniCode(normalized, muniMap);
    if (group === 'izu') {
        return { primaryAreaCode: '130020', referenceAreaCodes: ['130030'], mode: 'ISLANDS' };
    }

    if (group === 'ogasawara') {
        return { primaryAreaCode: '130040', referenceAreaCodes: [], mode: 'ISLANDS' };
    }

    return { primaryAreaCode: '130010', referenceAreaCodes: ['130020', '130030', '130040'], mode: 'MAINLAND' };
}
