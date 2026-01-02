
import areaDataRaw from '@/src/data/jma_area.json';

type JmaAreaNode = {
    name: string;
    enName: string;
    kana?: string;
    parent?: string;
    kids?: string[];
};

type AreaDataRoot = {
    centers: Record<string, JmaAreaNode>;
    offices: Record<string, JmaAreaNode>;
    class10s: Record<string, JmaAreaNode>;
    class15s: Record<string, JmaAreaNode>;
    class20s: Record<string, JmaAreaNode>;
};

const RAW = areaDataRaw as AreaDataRoot;

// Flatten for easy lookup
const AREA_MAP = new Map<string, JmaAreaNode>();

Object.values(RAW).forEach((section) => {
    Object.entries(section).forEach(([code, node]) => {
        AREA_MAP.set(code, node);
    });
});

export type JmaAreaResult = {
    officeCode: string | null;
    officeName: string | null;
    class10Code: string | null;
    class10Name: string | null;
    class20Code: string | null;
    class20Name: string | null;
};

function normalizeDigits(value: string | null): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    return digits.length ? digits : null;
}

export class JmaAreaMapper {
    static resolve(muniCode: string | null): JmaAreaResult {
        const empty: JmaAreaResult = {
            officeCode: null,
            officeName: null,
            class10Code: null,
            class10Name: null,
            class20Code: null,
            class20Name: null,
        };

        const normalized = normalizeDigits(muniCode);
        if (!normalized) return empty;

        let startKey: string | null = null;

        // 1. Direct
        if (AREA_MAP.has(normalized)) {
            startKey = normalized;
        }

        // 2. Append '00'
        if (!startKey) {
            const candidate = `${normalized}00`;
            if (AREA_MAP.has(candidate)) {
                startKey = candidate;
            }
        }

        // 3. Prefix search in class20s
        if (!startKey && normalized.length >= 5) {
            const prefix = normalized.slice(0, 5);
            const found = Object.keys(RAW.class20s).find(k => k.startsWith(prefix));
            if (found) startKey = found;
        }

        if (!startKey) return empty;

        const node = AREA_MAP.get(startKey);
        if (!node) return empty;

        const result = { ...empty };
        result.class20Code = startKey;
        result.class20Name = node.name;

        // Traverse Up
        const path: { code: string; node: JmaAreaNode; }[] = [];
        let currCode: string | undefined = startKey;
        let currNode: JmaAreaNode | undefined = node;
        const visited = new Set<string>();

        while (currCode && currNode) {
            if (visited.has(currCode)) break;
            visited.add(currCode);
            path.push({ code: currCode, node: currNode });

            currCode = currNode.parent;
            currNode = currCode ? AREA_MAP.get(currCode) : undefined;
        }

        const officePathItem = path.find(p => p.code in RAW.offices);
        if (officePathItem) {
            result.officeCode = officePathItem.code;
            result.officeName = officePathItem.node.name;
        } else {
            const centerPathItem = path.find(p => p.code in RAW.centers);
            if (centerPathItem) {
                result.officeCode = centerPathItem.code;
                result.officeName = centerPathItem.node.name;
            }
        }

        const class10PathItem = path.find(p => p.code in RAW.class10s);
        if (class10PathItem) {
            result.class10Code = class10PathItem.code;
            result.class10Name = class10PathItem.node.name;
        } else {
            if (result.officeCode) {
                result.class10Code = result.officeCode;
                result.class10Name = result.officeName;
            }
        }

        return result;
    }
}
