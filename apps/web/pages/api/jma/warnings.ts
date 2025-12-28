import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'node:crypto';
import { getJmaWarnings } from 'lib/jma/service';
import { JmaWarningsQuerySchema, type NormalizedWarningItem } from 'lib/jma/types';
import { readCachedWarnings } from 'lib/jma/normalize';
import { readJsonFile } from 'lib/jma/cache';
import { jmaAreaConstPath, jmaWebJsonWarningPath } from 'lib/jma/paths';
import { TOKYO_GROUP_AREA_CODES, type TokyoGroupKey } from 'lib/alerts/tokyoScope';

const CACHE_TTL_MS = 120_000;
const memoryCache = new Map<string, { expiresAt: number; payload: any }>();

type AreaConst = {
  offices?: Record<string, { name?: string; parent?: string }>;
  class10s?: Record<string, { name?: string; parent?: string }>;
  class15s?: Record<string, { name?: string; parent?: string }>;
  class20s?: Record<string, { name?: string; parent?: string }>;
  centers?: Record<string, { name?: string; parent?: string }>;
};

type AreaNode = { name?: string; parent?: string };

const TOKYO_GROUP_LABELS = {
  mainland: '（島しょ除く）',
  izu: '伊豆諸島',
  ogasawara: '小笠原諸島',
} as const;

const WARNING_CODE_BASE: Record<string, string> = {
  '05': '暴風',
  '07': '波浪',
  '13': '風雪',
  '14': '雷',
  '15': '強風',
  '16': '波浪',
  '21': '乾燥',
};

const WARNING_CODE_SEVERITY: Record<string, '警報' | '注意報'> = {
  '05': '警報',
  '07': '警報',
  '13': '注意報',
  '14': '注意報',
  '15': '注意報',
  '16': '注意報',
  '21': '注意報',
};

// Improve AreaIndex to track types or just use logic
// We'll modify readAreaIndex to return more info or just use raw JSON loading in helper
// Actually modifying current global cache structure might be risky if used elsewhere (logic seems local though)
// Let's create a new helper `getAreaHierarchy` that reuses the file read.

async function getAreaConst(): Promise<AreaConst | null> {
  return readJsonFile<AreaConst>(jmaAreaConstPath());
}

async function buildForecastAreaBreakdown(
  area: string,
  debug: boolean = false
): Promise<{
  breakdown: Record<string, { name: string; items: NormalizedWarningItem[] }>;
  muniMap: Record<string, string>;
} | null> {
  // Only process for prefecture level
  if (area.length !== 6 || !area.endsWith('0000')) return null;

  const [warningJson, areaConst] = await Promise.all([
    readJsonFile<any>(jmaWebJsonWarningPath(area)),
    getAreaConst(),
  ]);

  if (!warningJson || !areaConst) return null;

  // Build local index for hierarchy from this const file
  const index = new Map<string, AreaNode>();
  const class10s = new Set(Object.keys(areaConst.class10s ?? {}));
  const class20s = new Set(Object.keys(areaConst.class20s ?? {}));

  const push = (rec?: Record<string, AreaNode>) => {
    if (!rec) return;
    for (const [k, v] of Object.entries(rec)) index.set(k, v);
  };
  push(areaConst.offices);
  push(areaConst.centers);
  push(areaConst.class10s);
  push(areaConst.class15s);
  push(areaConst.class20s);

  const breakdown: Record<string, { name: string; items: NormalizedWarningItem[] }> = {};
  const muniMap: Record<string, string> = {};

  // 1. Identify relevant Forecast Areas (Class10s that belong to this Pref)
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;
    const code = String((node as any).code);

    // Check if this node is a Class10
    if (class10s.has(code)) {
      // Collect warnings
      const rawItems: NormalizedWarningItem[] = [];
      const warnings = (node as any).warnings;
      if (Array.isArray(warnings)) {
        for (const entry of warnings) {
          const status = typeof (entry as any).status === 'string' ? String((entry as any).status).trim() : null;
          if (shouldSkipWarningStatus(status)) continue;
          const warningCodeRaw = (entry as any).code;
          const warningCode = warningCodeRaw !== undefined && warningCodeRaw !== null ? String(warningCodeRaw).padStart(2, '0') : null;
          const severity = inferWarningSeverity(entry, status, warningCode);
          const hints = collectWarningHints(entry);
          const base = inferWarningBase(warningCode, hints, severity);
          const kind = buildWarningKind(base, severity);
          const id = hashId(`${kind}|${status ?? ''}`);

          rawItems.push({ id, kind, status, source: 'webjson' });
        }
      }

      // Accumulate raw items; deduplication is done in final pass
      if (!breakdown[code]) {
        const name = index.get(code)?.name ?? code;
        breakdown[code] = { name, items: [] };
      }
      breakdown[code].items.push(...rawItems);
    }

    for (const v of Object.values(node)) walk(v);
  };

  walk(warningJson);

  // 2. Final Deduplication per Area Code
  for (const code of Object.keys(breakdown)) {
    const rawItems = breakdown[code].items;
    const uniqueMap = new Map<string, NormalizedWarningItem>();
    const duplicates: string[] = [];

    for (const item of rawItems) {
      // Key: Kind only (forcing single status per kind)
      // This ensures "Wave Advisory" appears only once, whether "announced" or "continued".
      const key = item.kind;
      if (uniqueMap.has(key)) {
        const existing = uniqueMap.get(key)!;
        if (debug) duplicates.push(`${key} (${item.status}) vs existing (${existing.status})`);

        // Prefer item with status over item without status
        // e.g. "Advisory (Announced)" should replace "Advisory (null)"
        if (!existing.status && item.status) {
          uniqueMap.set(key, item);
        }
      } else {
        uniqueMap.set(key, item);
      }
    }

    const distinct = Array.from(uniqueMap.values());
    if (debug && duplicates.length > 0) {
      console.warn(`[JMA] Dedupe removed ${duplicates.length} items in area ${code}:`, duplicates.slice(0, 3));
    }

    breakdown[code].items = distinct;
  }

  // 2. Build Muni -> Forecast Area Map
  const prefPrefix = area.slice(0, 2);
  for (const c20 of class20s) {
    if (!c20.startsWith(prefPrefix)) continue;
    let cursor: string | undefined = c20;
    while (cursor) {
      if (class10s.has(cursor)) {
        muniMap[c20] = cursor;
        break;
      }
      const node = index.get(cursor);
      cursor = node?.parent ? String(node.parent) : undefined;
      if (cursor === area || !cursor) break;
    }
  }

  return { breakdown, muniMap };
}

let cachedAreaIndex: Map<string, AreaNode> | null = null;
let cachedAreaIndexAt = 0;

function getCached(area: string) {
  const hit = memoryCache.get(area);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memoryCache.delete(area);
    return null;
  }
  return hit.payload;
}

function setCached(area: string, payload: any) {
  memoryCache.set(area, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
}

async function readAreaIndex(): Promise<Map<string, AreaNode> | null> {
  if (cachedAreaIndex && Date.now() - cachedAreaIndexAt < 24 * 60 * 60_000) return cachedAreaIndex;
  const areaConst = await readJsonFile<AreaConst>(jmaAreaConstPath());
  if (!areaConst) return null;

  const index = new Map<string, AreaNode>();
  const pushEntries = (source?: Record<string, AreaNode>) => {
    if (!source) return;
    for (const [code, node] of Object.entries(source)) {
      index.set(String(code), node);
    }
  };
  pushEntries(areaConst.offices);
  pushEntries(areaConst.centers);
  pushEntries(areaConst.class10s);
  pushEntries(areaConst.class15s);
  pushEntries(areaConst.class20s);

  cachedAreaIndex = index;
  cachedAreaIndexAt = Date.now();
  return index;
}

function resolveTokyoGroup(code: string, index: Map<string, AreaNode>): TokyoGroupKey | null {
  let cursor: string | undefined = code;
  for (let i = 0; i < 10 && cursor; i += 1) {
    for (const [group, codes] of Object.entries(TOKYO_GROUP_AREA_CODES) as Array<[TokyoGroupKey, Set<string>]>) {
      if (codes.has(cursor)) return group;
    }
    const node = index.get(cursor);
    cursor = node?.parent ? String(node.parent) : undefined;
  }
  return null;
}

function shouldSkipWarningStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.trim();
  if (!s) return false;
  if (/解除/.test(s)) return true;
  if (/発表警報・注意報は?なし/.test(s)) return true;
  if (/発表警報・注意報は?ありません/.test(s)) return true;
  return false;
}

function collectLevelValues(node: any, acc: number[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const v of node) collectLevelValues(v, acc);
    return;
  }
  if (typeof node !== 'object') return;
  const values = (node as any).values;
  if (Array.isArray(values)) {
    for (const v of values) {
      const num = Number(v);
      if (Number.isFinite(num)) acc.push(num);
    }
  }
  const value = (node as any).value;
  if (value !== undefined) {
    const num = Number(value);
    if (Number.isFinite(num)) acc.push(num);
  }
  for (const v of Object.values(node)) collectLevelValues(v, acc);
}

function collectWarningHints(entry: any): string {
  const hints: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) hints.push(value);
  };
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (typeof node !== 'object') return;
    if ('type' in node) push((node as any).type);
    if ('condition' in node) push((node as any).condition);
    const additions = (node as any).additions;
    if (Array.isArray(additions)) additions.forEach(push);
    for (const v of Object.values(node)) walk(v);
  };
  walk(entry?.levels);
  walk(entry?.continueLevels);
  walk(entry?.properties);
  return hints.join(' ');
}

function inferWarningSeverity(entry: any, status: string | null, code: string | null): '警報' | '注意報' {
  const s = status ? status.trim() : '';
  if (s) {
    if (/(特別警報|警報)/.test(s) && !/注意報/.test(s)) return '警報';
    if (/注意報/.test(s)) return '注意報';
  }
  const levels: number[] = [];
  collectLevelValues(entry?.levels, levels);
  collectLevelValues(entry?.continueLevels, levels);
  const max = levels.length > 0 ? Math.max(...levels) : null;
  if (max !== null) {
    if (max >= 30) return '警報';
    if (max >= 10) return '注意報';
  }
  if (code && WARNING_CODE_SEVERITY[code]) return WARNING_CODE_SEVERITY[code];
  return '注意報';
}

function inferWarningBase(code: string | null, hints: string, severity: '警報' | '注意報'): string | null {
  if (code && WARNING_CODE_BASE[code]) return WARNING_CODE_BASE[code];
  if (/風雪/.test(hints)) return severity === '警報' ? '暴風雪' : '風雪';
  if (/風/.test(hints)) return severity === '警報' ? '暴風' : '強風';
  if (/波/.test(hints)) return '波浪';
  if (/雷/.test(hints)) return '雷';
  if (/乾燥|湿度/.test(hints)) return '乾燥';
  if (/高潮|潮位/.test(hints)) return '高潮';
  if (/洪水|水位/.test(hints)) return '洪水';
  if (/大雨|雨/.test(hints)) return '大雨';
  if (/雪/.test(hints)) return '大雪';
  if (/濃霧/.test(hints)) return '濃霧';
  if (/着氷/.test(hints)) return '着氷';
  if (/着雪/.test(hints)) return '着雪';
  if (/霜/.test(hints)) return '霜';
  if (/なだれ/.test(hints)) return 'なだれ';
  if (/低温/.test(hints)) return '低温';
  if (/融雪/.test(hints)) return '融雪';
  return null;
}

function buildWarningKind(base: string | null, severity: '警報' | '注意報'): string {
  if (!base) return `気象${severity}`;
  if (/(警報|注意報)$/.test(base)) return base;
  return `${base}${severity}`;
}

function hashId(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

async function buildTokyoGroups(area: string): Promise<{
  groups: Record<string, { label: string; items: NormalizedWarningItem[] }>;
} | null> {
  if (area !== '130000') return null;
  const [warningJson, index] = await Promise.all([readJsonFile<any>(jmaWebJsonWarningPath(area)), readAreaIndex()]);
  if (!warningJson || !index) return null;

  const groupBuckets = new Map<keyof typeof TOKYO_GROUP_LABELS, Map<string, NormalizedWarningItem>>();
  (Object.keys(TOKYO_GROUP_LABELS) as Array<keyof typeof TOKYO_GROUP_LABELS>).forEach((key) => {
    groupBuckets.set(key, new Map());
  });

  const walkAreas = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const v of node) walkAreas(v);
      return;
    }
    if (typeof node !== 'object') return;
    const codeRaw = (node as any).code;
    const warnings = (node as any).warnings;
    const code = typeof codeRaw === 'string' ? codeRaw : typeof codeRaw === 'number' ? String(codeRaw) : null;
    if (code && Array.isArray(warnings) && code.length >= 6) {
      const group = resolveTokyoGroup(code, index);
      if (group) {
        const bucket = groupBuckets.get(group)!;
        for (const entry of warnings) {
          if (!entry || typeof entry !== 'object') continue;
          const status = typeof (entry as any).status === 'string' ? String((entry as any).status).trim() : null;
          if (shouldSkipWarningStatus(status)) continue;
          const warningCodeRaw = (entry as any).code;
          const warningCode = warningCodeRaw !== undefined && warningCodeRaw !== null ? String(warningCodeRaw).padStart(2, '0') : null;
          const severity = inferWarningSeverity(entry, status, warningCode);
          const hints = collectWarningHints(entry);
          const base = inferWarningBase(warningCode, hints, severity);
          const kind = buildWarningKind(base, severity);
          const id = hashId(`${kind}|${status ?? ''}`);
          bucket.set(`${kind}|${status ?? ''}`, { id, kind, status, source: 'webjson' });
        }
      }
    }
    for (const v of Object.values(node)) walkAreas(v);
  };

  walkAreas(warningJson);

  const groups = Object.fromEntries(
    (Object.keys(TOKYO_GROUP_LABELS) as Array<keyof typeof TOKYO_GROUP_LABELS>).map((key) => {
      const items = Array.from(groupBuckets.get(key)?.values() ?? []);
      return [key, { label: TOKYO_GROUP_LABELS[key], items }];
    })
  );

  return { groups };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = JmaWarningsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() });
  }

  const cached = getCached(parsed.data.area);
  if (cached) {
    return res.status(200).json(cached);
  }

  try {
    const [data, tokyoGroups, subAreaInfo] = await Promise.all([
      getJmaWarnings(parsed.data.area),
      buildTokyoGroups(parsed.data.area),
      buildForecastAreaBreakdown(parsed.data.area, process.env.NODE_ENV !== 'production' && req.query.debug === '1'),
    ]);



    const payload = {
      ...data,
      tokyoGroups: tokyoGroups?.groups ?? null,
      breakdown: subAreaInfo?.breakdown ?? null,
      muniMap: subAreaInfo?.muniMap ?? null
    };

    setCached(parsed.data.area, payload);
    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const cached = await readCachedWarnings();
      const snap = cached.areas[parsed.data.area] ?? null;
      const payload = {
        fetchStatus: 'DEGRADED',
        updatedAt: snap?.updatedAt ?? null,
        lastError: message,
        area: parsed.data.area,
        areaName: snap?.areaName ?? null,
        confidence: 'LOW',
        confidenceNotes: ['internal error; serving last cached snapshot if available'],
        items: snap?.items ?? [],
        tokyoGroups: null,
        breakdown: null,
        muniMap: null,
      };
      setCached(parsed.data.area, payload);
      return res.status(200).json(payload);
    } catch {
      const payload = {
        fetchStatus: 'DEGRADED',
        updatedAt: null,
        lastError: message,
        area: parsed.data.area,
        areaName: null,
        confidence: 'LOW',
        confidenceNotes: ['internal error'],
        items: [],
        tokyoGroups: null,
        breakdown: null,
        muniMap: null,
      };
      setCached(parsed.data.area, payload);
      return res.status(200).json(payload);
    }
  }
}
