import type { NextApiRequest, NextApiResponse } from 'next';
import { JmaWarningsQuerySchema } from 'lib/jma/types';
import crypto from 'node:crypto';

// Mapping from JMA warning code to human-readable kind
const WARNING_CODE_MAP: Record<string, string> = {
    '02': '暴風雪警報', '03': '大雨警報', '04': '洪水警報', '05': '暴風警報',
    '06': '大雪警報', '07': '波浪警報', '08': '高潮警報',
    '10': '大雨注意報', '12': '大雪注意報', '13': '風雪注意報', '14': '雷注意報',
    '15': '強風注意報', '16': '波浪注意報', '17': '融雪注意報', '18': '洪水注意報',
    '19': '高潮注意報', '20': '濃霧注意報', '21': '乾燥注意報', '22': 'なだれ注意報',
    '23': '低温注意報', '24': '霜注意報', '25': '着氷注意報', '26': '着雪注意報',
    '32': '暴風雪特別警報', '33': '大雨特別警報', '35': '暴風特別警報',
    '36': '大雪特別警報', '37': '波浪特別警報'
};

// Mapping: class20 (7-digit municipality code) prefix -> class10 code
// For Tokyo, this is crucial for mainland vs islands split
const TOKYO_CLASS20_TO_CLASS10: Record<string, string> = {
    // Mainland (東京地方)
    '1310': '130010', '1311': '130010', '1312': '130010',
    '1320': '130010', '1321': '130010', '1322': '130010', '1330': '130010',
    // Izu North (伊豆諸島北部)
    '1336': '130020',
    // Izu South (伊豆諸島南部)
    '1338': '130030', '1340': '130030',
    // Ogasawara (小笠原諸島)
    '1342': '130040',
};

// Types for JMA official JSON structure (partial)
type JmaWarningItem = {
    code: string;
    status: string; // e.g., "発表", "解除"
};

type JmaArea = {
    code: string;
    warnings: JmaWarningItem[];
};

type JmaAreaType = {
    areas: JmaArea[];
};

type JmaWarningResponse = {
    reportDatetime: string;
    areaTypes: JmaAreaType[];
};

/**
 * Derive class10 code from class20 municipality code.
 * Tokyo requires special handling due to mainland vs islands split.
 */
function deriveClass10FromClass20(class20: string, officeCode: string): string | null {
    // For Tokyo (office 130000), use the mapping
    if (officeCode === '130000') {
        const prefix4 = class20.slice(0, 4);
        const mapped = TOKYO_CLASS20_TO_CLASS10[prefix4];
        if (mapped) return mapped;
    }

    // Generic fallback: derive class10 from class20 pattern
    // class20 format: PPMMM00 (PP = pref, MMM = municipality, 00 = suffix)
    // class10 format: PPAAA0 (PP = pref, AAA = area, 0 = suffix)
    // Common pattern: first 5 digits + '0' can approximate class10
    // This is a heuristic and may not work for all cases
    const prefix5 = class20.slice(0, 5);
    return `${prefix5}0`;
}

/**
 * Find warnings for a given code across all areaTypes.
 */
function findAreaByCode(data: JmaWarningResponse, targetCode: string): JmaArea | null {
    for (const areaType of data.areaTypes || []) {
        const found = areaType.areas?.find((a) => a.code === targetCode);
        if (found) return found;
    }
    return null;
}

/**
 * Build codes present in the JMA response for debugging.
 */
function buildPresentCodes(data: JmaWarningResponse): Set<string> {
    const codes = new Set<string>();
    for (const areaType of data.areaTypes || []) {
        for (const area of areaType.areas || []) {
            codes.add(area.code);
        }
    }
    return codes;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Basic validation for 'area'
    const parsed = JmaWarningsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({
            fetchStatus: 'DEGRADED',
            updatedAt: null,
            lastError: 'Invalid area format',
            area: req.query.area,
            items: []
        });
    }

    const { area } = parsed.data;
    let rawClass20 = req.query.class20;

    // If class20 is missing, return DEGRADED/low confidence
    if (!rawClass20 || typeof rawClass20 !== 'string') {
        return res.status(200).json({
            fetchStatus: 'DEGRADED',
            updatedAt: null,
            lastError: 'Missing class20 parameter',
            area,
            areaName: null,
            confidence: 'LOW',
            confidenceNotes: ['Missing class20 parameter, cannot filter warnings accurately'],
            items: [],
            debug: { pipelineVersion: 2, servedBy: 'official-with-fallback' }
        });
    }

    // Normalize class20: 5 digits -> append "00", 6 digits -> append "0"
    let class20 = rawClass20;
    if (rawClass20.length === 5) {
        class20 = `${rawClass20}00`;
    } else if (rawClass20.length === 6) {
        class20 = `${rawClass20}0`;
    }

    try {
        // Fetch official JSON
        const url = `https://www.jma.go.jp/bosai/warning/data/warning/${area}.json`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        let data: JmaWarningResponse;
        try {
            const resp = await fetch(url, {
                cache: 'no-store',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!resp.ok) {
                throw new Error(`Failed to fetch JMA data: ${resp.status}`);
            }

            data = await resp.json();
        } catch (fetchErr) {
            clearTimeout(timeoutId);
            throw fetchErr;
        }

        const updatedAt = data.reportDatetime;
        const presentCodes = buildPresentCodes(data);

        // Selection algorithm with ancestor fallback
        let selectedCode: string | null = null;
        let selectedCodePath: string[] = [];
        let targetArea: JmaArea | null = null;

        // Step 1: Try exact match on class20
        targetArea = findAreaByCode(data, class20);
        if (targetArea) {
            selectedCode = class20;
            selectedCodePath = [class20];
        }

        // Step 2: If not found, try class10 ancestor
        if (!targetArea) {
            const class10 = deriveClass10FromClass20(class20, area);
            if (class10) {
                targetArea = findAreaByCode(data, class10);
                if (targetArea) {
                    selectedCode = class10;
                    selectedCodePath = [class20, class10];
                }
            }
        }

        // Step 3: If still not found, try office-level (areaTypes[0] usually)
        if (!targetArea && data.areaTypes?.[0]?.areas?.length) {
            // Just use the first area from areaTypes[0] as prefecture fallback
            const prefArea = data.areaTypes[0].areas[0];
            if (prefArea) {
                targetArea = prefArea;
                selectedCode = prefArea.code;
                selectedCodePath = [class20, selectedCode + ' (prefecture fallback)'];
            }
        }

        const items: any[] = [];
        if (targetArea?.warnings) {
            const seenKinds = new Set<string>();

            for (const w of targetArea.warnings) {
                // Skip released or "no warnings" status
                if (w.status === '解除' || w.status === '発表警報・注意報はなし') continue;
                // Skip null status
                if (!w.status) continue;

                const kindName = WARNING_CODE_MAP[w.code];
                if (!kindName) continue; // Unknown code

                // Dedupe by kind
                if (seenKinds.has(kindName)) continue;
                seenKinds.add(kindName);

                // Stable ID
                const hashBasis = `${selectedCode}|${w.code}|${w.status}|${updatedAt}`;
                const id = crypto.createHash('md5').update(hashBasis).digest('hex');

                items.push({
                    id,
                    kind: kindName,
                    status: w.status,
                    code: w.code,
                    source: 'official'
                });
            }
        }

        const isAncestorMatch = selectedCode !== class20 && selectedCode !== null;

        return res.status(200).json({
            fetchStatus: 'OK',
            updatedAt,
            lastError: null,
            area,
            areaName: null,
            confidence: isAncestorMatch ? 'MEDIUM' : 'HIGH',
            confidenceNotes: isAncestorMatch
                ? [`Used ancestor code ${selectedCode} (exact ${class20} not in JMA data)`]
                : [],
            items,
            debug: {
                selectedCode,
                selectedCodePath,
                inputClass20: class20,
                presentCodesSample: Array.from(presentCodes).slice(0, 10),
                pipelineVersion: 2,
                servedBy: 'official-with-fallback'
            }
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(200).json({
            fetchStatus: 'DEGRADED',
            updatedAt: null,
            lastError: message,
            area,
            areaName: null,
            confidence: 'LOW',
            confidenceNotes: ['Failed to fetch official JMA data'],
            items: [],
            debug: { pipelineVersion: 2, error: message }
        });
    }
}

/**
 * Tests via curl:
 * 
 * 1. Tokyo mainland (Chiyoda-ku)
 * curl "http://localhost:3000/api/jma/warnings?area=130000&class20=1310100"
 * 
 * 2. Ogasawara  
 * curl "http://localhost:3000/api/jma/warnings?area=130000&class20=1336100"
 * 
 * 3. Aomori city
 * curl "http://localhost:3000/api/jma/warnings?area=020000&class20=0220100"
 * 
 * These MUST return different items for Tokyo split. Ogasawara uses 130040.
 */
