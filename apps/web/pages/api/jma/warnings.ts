import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'node:crypto';
import { getJmaWarnings } from 'lib/jma/service';
import { JmaWarningsQuerySchema, type NormalizedWarningItem } from 'lib/jma/types';
import { readCachedWarnings } from 'lib/jma/normalize';
import { readJsonFile } from 'lib/jma/cache';
import { jmaAreaConstPath, jmaWebJsonWarningPath } from 'lib/jma/paths';
import {
  getAreaNameFromMetadata,
  getClass10ChildrenForArea,
  getClass15DescendantsForArea,
  getClass20DescendantsDetailedForArea,
  getHokkaidoWarningOfficeCodes,
  isAreaInTokyoGroup,
} from 'lib/jma/areaHierarchy';
import {
  getTokyoGroupLabel,
  normalizeTokyoGroupKey,
  TOKYO_AVAILABLE_AREAS,
  TOKYO_GROUP_AREA_CODES,
  TOKYO_GROUP_LABELS,
  type TokyoGroupKey,
} from 'lib/alerts/tokyoScope';
import { toJmaClass20 } from 'lib/muni-helper';

const CACHE_TTL_MS = 120_000;
const memoryCache = new Map<string, { expiresAt: number; payload: any }>();

function msSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

function buildCacheKey(area: string, class20: string | null): string {
  return `${area}:${class20 ?? ''}`;
}

type AreaConst = {
  offices?: Record<string, { name?: string; parent?: string; children?: string[] }>;
  class10s?: Record<string, { name?: string; parent?: string; children?: string[] }>;
  class15s?: Record<string, { name?: string; parent?: string; children?: string[] }>;
  class20s?: Record<string, { name?: string; parent?: string; children?: string[] }>;
  centers?: Record<string, { name?: string; parent?: string; children?: string[] }>;
};

type AreaNode = { name?: string; parent?: string; children?: string[] };

const WARNING_CODE_BASE: Record<string, string> = {
  '05': '暴風',
  '07': '波浪',
  '10': '大雪',
  '13': '風雪',
  '14': '雷',
  '15': '強風',
  '16': '波浪',
  '17': '融雪',
  '20': '濃霧',
  '21': '乾燥',
  '22': 'なだれ',
  '24': '霜',
};

const WARNING_CODE_SEVERITY: Record<string, '警報' | '注意報'> = {
  '05': '警報',
  '07': '警報',
  '10': '注意報',
  '13': '注意報',
  '14': '注意報',
  '15': '注意報',
  '16': '注意報',
  '17': '注意報',
  '20': '注意報',
  '21': '注意報',
  '22': '注意報',
  '24': '注意報',
};

function firstQuery(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

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
  class20Groups: Record<
    string,
    {
      name: string;
      parentCode: string | null;
      parentName: string | null;
      class10Code: string | null;
      class10Name: string | null;
      items: NormalizedWarningItem[];
    }
  >;
  availableClass20Areas: Array<{
    code: string;
    name: string;
    parentCode: string | null;
    parentName: string | null;
    class10Code: string | null;
    class10Name: string | null;
  }>;
  availableClass10Areas: Array<{
    code: string;
    name: string;
  }>;
  availableClass15Areas: Array<{
    code: string;
    name: string;
    class10Code: string | null;
    class10Name: string | null;
  }>;
} | null> {
  if (area.length !== 6) return null;

  const [warningJson, areaConst] = await Promise.all([
    readJsonFile<any>(jmaWebJsonWarningPath(area)),
    getAreaConst(),
  ]);

  if (!areaConst) return null;

  // Build local index for hierarchy from this const file
  const index = new Map<string, AreaNode>();
  const class10s = new Set(Object.keys(areaConst.class10s ?? {}));
  const class15s = new Set(Object.keys(areaConst.class15s ?? {}));
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
  const class20Groups: Record<
    string,
    {
      name: string;
      parentCode: string | null;
      parentName: string | null;
      class10Code: string | null;
      class10Name: string | null;
      items: NormalizedWarningItem[];
    }
  > = {};

  const class10Options = await getClass10ChildrenForArea(area);
  for (const option of class10Options) {
    breakdown[option.code] = { name: option.name, items: [] };
  }

  const class15Options = new Map<string, { code: string; name: string; class10Code: string | null; class10Name: string | null }>();
  const class15MetadataOptions = await getClass15DescendantsForArea(area);
  for (const option of class15MetadataOptions) {
    class15Options.set(option.code, option);
    if (!breakdown[option.code]) {
      breakdown[option.code] = { name: option.name, items: [] };
    }
  }
  const availableClass20Areas = await getClass20DescendantsDetailedForArea(area);
  for (const option of availableClass20Areas) {
    const parentCode = option.parentCode;
    const class10Code = option.class10Code;
    const parentName = option.parentName;
    const class10Name = option.class10Name;
    if (parentCode && !breakdown[parentCode]) {
      breakdown[parentCode] = { name: parentName ?? parentCode, items: [] };
    }
    if (parentCode && !class15Options.has(parentCode)) {
      class15Options.set(parentCode, {
        code: parentCode,
        name: parentName ?? parentCode,
        class10Code,
        class10Name,
      });
    }
    class20Groups[option.code] = {
      name: option.name,
      parentCode,
      parentName,
      class10Code,
      class10Name,
      items: [],
    };
  }

  const appendCurrentArea = (node: any) => {
    if (!node || typeof node !== 'object') return;
    const codeRaw = (node as any).code;
    const code =
      typeof codeRaw === 'string'
        ? codeRaw.trim()
        : codeRaw !== undefined && codeRaw !== null
          ? String(codeRaw).trim()
          : '';
    if (!code) return;

    const forecastCode = resolveClass10Code(code, index, class10s);
    if (!forecastCode || !forecastCode.startsWith(area.slice(0, 2))) return;
    const class15Code = resolveClass15Code(code, index, class15s);

    const warnings = (node as any).warnings;
    if (!Array.isArray(warnings)) return;

    const rawItems: NormalizedWarningItem[] = [];
    for (const entry of warnings) {
      if (!entry || typeof entry !== 'object') continue;
      const status = typeof (entry as any).status === 'string' ? String((entry as any).status).trim() : null;
      if (shouldSkipWarningStatus(status)) continue;
      const warningCodeRaw = (entry as any).code;
      const warningCode =
        warningCodeRaw !== undefined && warningCodeRaw !== null ? String(warningCodeRaw).padStart(2, '0') : null;
      if (!warningCode) continue;
      const severity = inferWarningSeverity(entry, status, warningCode);
      const hints = collectWarningHints(entry);
      const base = inferWarningBase(warningCode, hints, severity);
      const kind = buildWarningKind(base, severity);
      const id = hashId(`${forecastCode}|${code}|${warningCode}|${kind}|${status ?? ''}`);

      rawItems.push({
        id,
        kind,
        status,
        source: 'webjson',
        areaCode: code,
        areaName: index.get(code)?.name ?? null,
      } as NormalizedWarningItem);
    }

    if (!breakdown[forecastCode]) {
      const name = index.get(forecastCode)?.name ?? forecastCode;
      breakdown[forecastCode] = { name, items: [] };
    }
    breakdown[forecastCode].items.push(...rawItems);

    if (class15Code) {
      if (!breakdown[class15Code]) {
        const name = index.get(class15Code)?.name ?? class15Code;
        breakdown[class15Code] = { name, items: [] };
      }
      breakdown[class15Code].items.push(...rawItems);
    }

    if (class20s.has(code)) {
      if (!class20Groups[code]) {
        class20Groups[code] = {
          name: index.get(code)?.name ?? code,
          parentCode: class15Code,
          parentName: class15Code ? index.get(class15Code)?.name ?? class15Code : null,
          class10Code: forecastCode,
          class10Name: index.get(forecastCode)?.name ?? forecastCode,
          items: [],
        };
      }
      class20Groups[code].items.push(...rawItems);
    }
  };

  if (warningJson) {
    const areaTypes = Array.isArray(warningJson?.areaTypes) ? warningJson.areaTypes : [];
    for (const areaType of areaTypes) {
      const areas = Array.isArray(areaType?.areas) ? areaType.areas : [];
      for (const currentArea of areas) appendCurrentArea(currentArea);
    }
  }

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

  for (const code of Object.keys(class20Groups)) {
    class20Groups[code].items = dedupeWarningItems(class20Groups[code].items);
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

  return {
    breakdown,
    muniMap,
    class20Groups,
    availableClass10Areas: class10Options,
    availableClass20Areas,
    availableClass15Areas: Array.from(class15Options.values()).sort((a, b) => a.code.localeCompare(b.code)),
  };
}

let cachedAreaIndex: Map<string, AreaNode> | null = null;
let cachedAreaIndexAt = 0;

function getCached(cacheKey: string) {
  const hit = memoryCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt || msSince(hit.payload?.updatedAt) > CACHE_TTL_MS) {
    memoryCache.delete(cacheKey);
    return null;
  }
  return hit.payload;
}

function setCached(cacheKey: string, payload: any) {
  memoryCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
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

function resolveClass10Code(code: string, index: Map<string, AreaNode>, class10s: Set<string>): string | null {
  let cursor: string | undefined = code;
  for (let i = 0; i < 10 && cursor; i += 1) {
    if (class10s.has(cursor)) return cursor;
    const node = index.get(cursor);
    cursor = node?.parent ? String(node.parent) : undefined;
  }
  return null;
}

function resolveClass15Code(code: string, index: Map<string, AreaNode>, class15s: Set<string>): string | null {
  let cursor: string | undefined = code;
  for (let i = 0; i < 10 && cursor; i += 1) {
    if (class15s.has(cursor)) return cursor;
    const node = index.get(cursor);
    cursor = node?.parent ? String(node.parent) : undefined;
  }
  return null;
}

function inferTokyoGroupForRequest(args: {
  area: string;
  requestedGroup: TokyoGroupKey | null;
  class20: string | null;
  index: Map<string, AreaNode> | null;
}): TokyoGroupKey | null {
  if (args.area !== '130000') return null;
  if (args.requestedGroup) return args.requestedGroup;
  if (args.class20 && args.index) {
    return resolveTokyoGroup(args.class20, args.index) ?? (args.class20.startsWith('13') ? 'tokyo-mainland' : null);
  }
  return 'tokyo-mainland';
}

function buildSelectedAreaChildren(selectedAreaCode: string | null, index: Map<string, AreaNode> | null) {
  if (!selectedAreaCode || !index) return [];
  const results: Array<{ code: string; name: string; level: 'subarea' | 'municipality' }> = [];
  const seen = new Set<string>();
  const walk = (code: string, depth: number) => {
    if (depth > 2 || results.length >= 80) return;
    const node = index.get(code);
    const children = Array.isArray(node?.children) ? node.children.map(String) : [];
    for (const childCode of children) {
      if (seen.has(childCode)) continue;
      seen.add(childCode);
      const child = index.get(childCode);
      const hasChildren = Array.isArray(child?.children) && child.children.length > 0;
      results.push({
        code: childCode,
        name: child?.name ?? childCode,
        level: hasChildren ? 'subarea' : 'municipality',
      });
      if (hasChildren) walk(childCode, depth + 1);
    }
  };
  walk(selectedAreaCode, 0);
  return results;
}

function shouldSkipWarningStatus(status: string | null): boolean {
  if (!status) return true;
  const s = status.trim();
  if (!s) return true;
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

  const areaTypes = Array.isArray(warningJson?.areaTypes) ? warningJson.areaTypes : [];
  for (const areaType of areaTypes) {
    const areas = Array.isArray(areaType?.areas) ? areaType.areas : [];
    for (const currentArea of areas) {
      const codeRaw = currentArea?.code;
      const code =
        typeof codeRaw === 'string'
          ? codeRaw.trim()
          : codeRaw !== undefined && codeRaw !== null
            ? String(codeRaw).trim()
            : '';
      const warnings = currentArea?.warnings;
      if (!code || !Array.isArray(warnings)) continue;

      const matchingGroups: TokyoGroupKey[] = [];
      if (code === area) {
        matchingGroups.push(...(Object.keys(TOKYO_GROUP_LABELS) as TokyoGroupKey[]));
      } else {
        for (const group of Object.keys(TOKYO_GROUP_LABELS) as TokyoGroupKey[]) {
          if (await isAreaInTokyoGroup(code, group)) matchingGroups.push(group);
        }
      }

      for (const targetGroup of matchingGroups) {
        const bucket = groupBuckets.get(targetGroup)!;
        for (const entry of warnings) {
          if (!entry || typeof entry !== 'object') continue;
          const status = typeof (entry as any).status === 'string' ? String((entry as any).status).trim() : null;
          if (shouldSkipWarningStatus(status)) continue;
          const warningCodeRaw = (entry as any).code;
          const warningCode =
            warningCodeRaw !== undefined && warningCodeRaw !== null ? String(warningCodeRaw).padStart(2, '0') : null;
          if (!warningCode) continue;
          const severity = inferWarningSeverity(entry, status, warningCode);
          const hints = collectWarningHints(entry);
          const base = inferWarningBase(warningCode, hints, severity);
          const kind = buildWarningKind(base, severity);
          const id = hashId(`${targetGroup}|${code}|${warningCode}|${kind}|${status ?? ''}`);
          bucket.set(`${code}|${warningCode}`, {
            id,
            kind,
            status,
            source: 'webjson',
            areaCode: code,
            areaName: index.get(code)?.name ?? null,
            tokyoGroup: targetGroup,
          } as NormalizedWarningItem);
        }
      }
    }
  }

  const groups = Object.fromEntries(
    (Object.keys(TOKYO_GROUP_LABELS) as Array<keyof typeof TOKYO_GROUP_LABELS>).map((key) => {
      const items = Array.from(groupBuckets.get(key)?.values() ?? []);
      return [key, { label: TOKYO_GROUP_LABELS[key], items }];
    })
  );

  return { groups };
}

function mergeBreakdown(
  target: Record<string, { name: string; items: NormalizedWarningItem[] }>,
  source: Record<string, { name: string; items: NormalizedWarningItem[] }> | null | undefined
) {
  if (!source) return;
  for (const [code, value] of Object.entries(source)) {
    if (!target[code]) target[code] = { name: value.name, items: [] };
    target[code].items.push(...(value.items ?? []));
  }
}

function mergeMuniMap(target: Record<string, string>, source: Record<string, string> | null | undefined) {
  if (!source) return;
  for (const [code, forecastCode] of Object.entries(source)) {
    target[code] = forecastCode;
  }
}

function mergeClass20Groups(
  target: Record<
    string,
    {
      name: string;
      parentCode: string | null;
      parentName: string | null;
      class10Code: string | null;
      class10Name: string | null;
      items: NormalizedWarningItem[];
    }
  >,
  source:
    | Record<
        string,
        {
          name: string;
          parentCode: string | null;
          parentName: string | null;
          class10Code: string | null;
          class10Name: string | null;
          items: NormalizedWarningItem[];
        }
      >
    | null
    | undefined
) {
  if (!source) return;
  for (const [code, value] of Object.entries(source)) {
    if (!target[code]) target[code] = { ...value, items: [] };
    target[code].items.push(...(value.items ?? []));
  }
}

function mergeClass20Options(
  target: Map<
    string,
    {
      code: string;
      name: string;
      parentCode: string | null;
      parentName: string | null;
      class10Code: string | null;
      class10Name: string | null;
    }
  >,
  source:
    | Array<{
        code: string;
        name: string;
        parentCode: string | null;
        parentName: string | null;
        class10Code: string | null;
        class10Name: string | null;
      }>
    | null
    | undefined
) {
  if (!source) return;
  for (const option of source) {
    if (!target.has(option.code)) target.set(option.code, option);
  }
}

function mergeClass15Options(
  target: Map<
    string,
    {
      code: string;
      name: string;
      class10Code: string | null;
      class10Name: string | null;
    }
  >,
  source:
    | Array<{
        code: string;
        name: string;
        class10Code: string | null;
        class10Name: string | null;
      }>
    | null
    | undefined
) {
  if (!source) return;
  for (const option of source) {
    if (!target.has(option.code)) target.set(option.code, option);
  }
}

function dedupeWarningItems(items: NormalizedWarningItem[]): NormalizedWarningItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.areaCode ?? ''}|${item.kind}|${item.status ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildWarningCounts(items: NormalizedWarningItem[]) {
  let special = 0;
  let warning = 0;
  let advisory = 0;
  for (const item of items) {
    if (/特別警報/.test(item.kind)) special += 1;
    else if (/警報/.test(item.kind) && !/注意報/.test(item.kind)) warning += 1;
    else if (/注意報/.test(item.kind)) advisory += 1;
  }
  return {
    special,
    warning,
    advisory,
    activeTotal: special + warning + advisory,
    releasedTotal: 0,
  };
}

function buildGroupedByClass20(
  class20Groups: Record<
    string,
    {
      name: string;
      parentCode?: string | null;
      parentName?: string | null;
      class10Code?: string | null;
      class10Name?: string | null;
      items: NormalizedWarningItem[];
    }
  > | null | undefined,
  exactCode?: string | null
) {
  if (!class20Groups) return [];
  return Object.entries(class20Groups)
    .filter(([code]) => !exactCode || code === exactCode)
    .map(([code, group]) => ({
      areaCode: code,
      areaName: group.name,
      parentAreaCode: group.parentCode ?? null,
      parentAreaName: group.parentName ?? null,
      class10Code: group.class10Code ?? null,
      class10Name: group.class10Name ?? null,
      warnings: dedupeWarningItems(group.items),
    }))
    .filter((group) => group.warnings.length > 0)
    .sort((a, b) => a.areaName.localeCompare(b.areaName, 'ja') || a.areaCode.localeCompare(b.areaCode));
}

async function buildHokkaidoAggregatePayload(args: {
  area: string;
  class20: string | null;
  debug: boolean;
}) {
  const officeCodes = await getHokkaidoWarningOfficeCodes();
  const settled = await Promise.allSettled(
    officeCodes.map(async (officeCode) => {
      const [data, subAreaInfo, areaName] = await Promise.all([
        getJmaWarnings(officeCode),
        buildForecastAreaBreakdown(officeCode, args.debug),
        getAreaNameFromMetadata(officeCode),
      ]);
      return { officeCode, areaName: areaName ?? data.areaName ?? officeCode, data, subAreaInfo };
    })
  );

  const items: NormalizedWarningItem[] = [];
  const breakdown: Record<string, { name: string; items: NormalizedWarningItem[] }> = {};
  const muniMap: Record<string, string> = {};
  const class20Groups: Record<
    string,
    {
      name: string;
      parentCode: string | null;
      parentName: string | null;
      class10Code: string | null;
      class10Name: string | null;
      items: NormalizedWarningItem[];
    }
  > = {};
  const class20Options = new Map<
    string,
    {
      code: string;
      name: string;
      parentCode: string | null;
      parentName: string | null;
      class10Code: string | null;
      class10Name: string | null;
    }
  >();
  const class10Options = new Map<string, { code: string; name: string }>();
  const class15Options = new Map<
    string,
    {
      code: string;
      name: string;
      class10Code: string | null;
      class10Name: string | null;
    }
  >();
  const sources: Array<{
    area: string;
    areaName: string | null;
    fetchStatus: string;
    updatedAt: string | null;
    lastError: string | null;
  }> = [];
  let succeeded = 0;
  let failed = 0;
  let updatedAt: string | null = null;

  for (const result of settled) {
    if (result.status === 'rejected') {
      failed += 1;
      sources.push({
        area: 'unknown',
        areaName: null,
        fetchStatus: 'DOWN',
        updatedAt: null,
        lastError: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }

    const { officeCode, areaName, data, subAreaInfo } = result.value;
    const sourceFailed = data.fetchStatus !== 'OK' && !data.updatedAt;
    if (sourceFailed) failed += 1;
    else succeeded += 1;

    items.push(...data.items);
    mergeBreakdown(breakdown, subAreaInfo?.breakdown);
    mergeMuniMap(muniMap, subAreaInfo?.muniMap);
    mergeClass20Groups(class20Groups, subAreaInfo?.class20Groups);
    for (const option of subAreaInfo?.availableClass10Areas ?? []) {
      if (!class10Options.has(option.code)) class10Options.set(option.code, option);
    }
    mergeClass20Options(class20Options, subAreaInfo?.availableClass20Areas);
    mergeClass15Options(class15Options, subAreaInfo?.availableClass15Areas);
    if (data.updatedAt && (!updatedAt || Date.parse(data.updatedAt) > Date.parse(updatedAt))) {
      updatedAt = data.updatedAt;
    }
    sources.push({
      area: officeCode,
      areaName,
      fetchStatus: sourceFailed ? 'DOWN' : data.fetchStatus,
      updatedAt: data.updatedAt,
      lastError: data.lastError,
    });
  }

  for (const value of Object.values(breakdown)) {
    value.items = dedupeWarningItems(value.items);
  }
  for (const value of Object.values(class20Groups)) {
    value.items = dedupeWarningItems(value.items);
  }

  const distinctItems = dedupeWarningItems(args.class20 ? class20Groups[args.class20]?.items ?? [] : items);
  const selectedClass20Group = args.class20 ? class20Groups[args.class20] ?? null : null;
  const fetchStatus =
    succeeded === 0
      ? 'DOWN'
      : failed > 0
        ? 'PARTIAL'
        : distinctItems.length === 0
          ? 'EMPTY'
          : 'OK';

  return {
    fetchStatus,
    updatedAt,
    lastError:
      fetchStatus === 'OK' || fetchStatus === 'EMPTY'
        ? null
        : sources.map((s) => s.lastError).find(Boolean) ?? null,
    area: args.area,
    areaName: '北海道',
    confidence: 'LOW',
    confidenceNotes: ['北海道は複数の気象庁発表区域をまとめて取得しています'],
    items: distinctItems,
    tokyoGroups: null,
    selectedAreaGroup: null,
    selectedAreaName: null,
    selectedAreaCode: null,
    selectedAreaChildren: [],
    counts: buildWarningCounts(distinctItems),
    availableTokyoAreas: [],
    breakdown,
    muniMap,
    class20Groups,
    groupedByClass20: buildGroupedByClass20(class20Groups, args.class20),
    availableClass10Areas: Array.from(class10Options.values()).sort((a, b) => a.code.localeCompare(b.code)),
    availableClass15Areas: Array.from(class15Options.values()).sort((a, b) => a.code.localeCompare(b.code)),
    availableClass20Areas: Array.from(class20Options.values()).sort((a, b) => a.code.localeCompare(b.code)),
    selectedClass20Code: args.class20,
    selectedClass20Name: selectedClass20Group?.name ?? null,
    selectedClass15Code: selectedClass20Group?.parentCode ?? null,
    selectedClass15Name: selectedClass20Group?.parentName ?? null,
    selectedClass10Code: selectedClass20Group?.class10Code ?? null,
    selectedClass10Name: selectedClass20Group?.class10Name ?? null,
    parentAreaCode: selectedClass20Group?.parentCode ?? null,
    parentAreaName: selectedClass20Group?.parentName ?? null,
    sources,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parsed = JmaWarningsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() });
  }

  const area = parsed.data.area;
  const rawClass20 = parsed.data.class20 ?? null;
  const normalizedClass20 = toJmaClass20(rawClass20);
  const class20 =
    normalizedClass20 && normalizedClass20.startsWith(area.slice(0, 2)) ? normalizedClass20 : null;
  const requestedTokyoGroup = normalizeTokyoGroupKey(firstQuery(req.query.tokyoGroup));
  const cacheKey = `${buildCacheKey(area, normalizedClass20 ?? null)}:${requestedTokyoGroup ?? ''}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.status(200).json(cached);
  }

  try {
    if (area === '010000') {
      const payload = await buildHokkaidoAggregatePayload({
        area,
        class20,
        debug: process.env.NODE_ENV !== 'production' && req.query.debug === '1',
      });
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }

    const [data, tokyoGroups, subAreaInfo, areaIndex] = await Promise.all([
      getJmaWarnings(area),
      buildTokyoGroups(area),
      buildForecastAreaBreakdown(area, process.env.NODE_ENV !== 'production' && req.query.debug === '1'),
      readAreaIndex(),
    ]);

    const selectedAreaGroup = inferTokyoGroupForRequest({
      area,
      requestedGroup: requestedTokyoGroup,
      class20,
      index: areaIndex,
    });
    const selectedAreaCode = selectedAreaGroup ? TOKYO_AVAILABLE_AREAS.find((item) => item.group === selectedAreaGroup)?.code ?? null : null;
    const selectedAreaName = selectedAreaGroup ? getTokyoGroupLabel(selectedAreaGroup) : null;

    let items = data.items;
    if (class20 && subAreaInfo?.muniMap && subAreaInfo?.breakdown) {
      if (subAreaInfo.class20Groups?.[class20]) {
        items = subAreaInfo.class20Groups[class20].items;
      } else {
        const forecastCode = subAreaInfo.muniMap[class20] ?? null;
        if (forecastCode && subAreaInfo.breakdown[forecastCode]) {
          items = subAreaInfo.breakdown[forecastCode].items;
        }
      }
    } else if (selectedAreaGroup && area === '130000') {
      const groupedItems = tokyoGroups?.groups?.[selectedAreaGroup]?.items;
      const filteredByAreaCode: NormalizedWarningItem[] = [];
      for (const item of data.items) {
        if (await isAreaInTokyoGroup(item.areaCode, selectedAreaGroup)) filteredByAreaCode.push(item);
      }
      if (filteredByAreaCode.length > 0) {
        items = dedupeWarningItems(filteredByAreaCode);
      } else if (Array.isArray(groupedItems)) {
        items = groupedItems;
      } else if (selectedAreaCode && subAreaInfo?.breakdown?.[selectedAreaCode]) {
        items = subAreaInfo.breakdown[selectedAreaCode].items;
      } else {
        items = data.items;
      }
    }

    const selectedClass20Group = class20 ? subAreaInfo?.class20Groups?.[class20] ?? null : null;
    const payload = {
      ...data,
      items,
      tokyoGroups: tokyoGroups?.groups ?? null,
      selectedAreaGroup,
      selectedAreaName,
      selectedAreaCode,
      selectedAreaChildren: buildSelectedAreaChildren(selectedAreaCode, areaIndex),
      counts: buildWarningCounts(items),
      availableTokyoAreas: area === '130000' ? TOKYO_AVAILABLE_AREAS : [],
      breakdown: subAreaInfo?.breakdown ?? null,
      muniMap: subAreaInfo?.muniMap ?? null,
      class20Groups: subAreaInfo?.class20Groups ?? null,
      groupedByClass20: buildGroupedByClass20(subAreaInfo?.class20Groups, class20),
      availableClass10Areas: subAreaInfo?.availableClass10Areas ?? [],
      availableClass15Areas: subAreaInfo?.availableClass15Areas ?? [],
      availableClass20Areas: subAreaInfo?.availableClass20Areas ?? [],
      selectedClass20Code: class20,
      selectedClass20Name: selectedClass20Group?.name ?? null,
      selectedClass15Code: selectedClass20Group?.parentCode ?? null,
      selectedClass15Name: selectedClass20Group?.parentName ?? null,
      selectedClass10Code: selectedClass20Group?.class10Code ?? null,
      selectedClass10Name: selectedClass20Group?.class10Name ?? null,
      parentAreaCode: selectedClass20Group?.parentCode ?? null,
      parentAreaName: selectedClass20Group?.parentName ?? null,
    };

    if (process.env.NODE_ENV !== 'production' && req.query.debug === '1') {
      // eslint-disable-next-line no-console
      console.debug('[JMA] warnings', { area, rawClass20, normalizedClass20, items: items.length });
    }

    setCached(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const cached = await readCachedWarnings();
      const snap = cached.areas[area] ?? null;
      const payload = {
        fetchStatus: 'DEGRADED',
        updatedAt: snap?.updatedAt ?? null,
        lastError: message,
        area,
        areaName: snap?.areaName ?? null,
        confidence: 'LOW',
        confidenceNotes: ['internal error; serving last cached snapshot if available'],
        items: snap?.items ?? [],
        tokyoGroups: null,
        selectedAreaGroup: null,
        selectedAreaName: null,
        selectedAreaCode: null,
        selectedAreaChildren: [],
        counts: buildWarningCounts(snap?.items ?? []),
        availableTokyoAreas: area === '130000' ? TOKYO_AVAILABLE_AREAS : [],
        breakdown: null,
        muniMap: null,
        class20Groups: null,
        groupedByClass20: [],
        availableClass10Areas: [],
        availableClass15Areas: [],
        availableClass20Areas: [],
        selectedClass20Code: class20,
        selectedClass20Name: null,
        selectedClass15Code: null,
        selectedClass15Name: null,
        selectedClass10Code: null,
        selectedClass10Name: null,
        parentAreaCode: null,
        parentAreaName: null,
      };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    } catch {
      const payload = {
        fetchStatus: 'DEGRADED',
        updatedAt: null,
        lastError: message,
        area,
        areaName: null,
        confidence: 'LOW',
        confidenceNotes: ['internal error'],
        items: [],
        tokyoGroups: null,
        selectedAreaGroup: null,
        selectedAreaName: null,
        selectedAreaCode: null,
        selectedAreaChildren: [],
        counts: buildWarningCounts([]),
        availableTokyoAreas: area === '130000' ? TOKYO_AVAILABLE_AREAS : [],
        breakdown: null,
        muniMap: null,
        class20Groups: null,
        groupedByClass20: [],
        availableClass10Areas: [],
        availableClass15Areas: [],
        availableClass20Areas: [],
        selectedClass20Code: class20,
        selectedClass20Name: null,
        selectedClass15Code: null,
        selectedClass15Name: null,
        selectedClass10Code: null,
        selectedClass10Name: null,
        parentAreaCode: null,
        parentAreaName: null,
      };
      setCached(cacheKey, payload);
      return res.status(200).json(payload);
    }
  }
}
