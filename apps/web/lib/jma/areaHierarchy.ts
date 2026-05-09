import { readJsonFile } from './cache';
import { jmaAreaConstPath } from './paths';

export type TokyoAreaGroup = 'tokyo_mainland' | 'izu_north' | 'izu_south' | 'ogasawara';

type AreaNode = { name?: string; parent?: string; children?: string[] };
type AreaConst = {
  offices?: Record<string, AreaNode>;
  class10s?: Record<string, AreaNode>;
  class15s?: Record<string, AreaNode>;
  class20s?: Record<string, AreaNode>;
  centers?: Record<string, AreaNode>;
};

const HOKKAIDO_OFFICE_FALLBACK = ['011000', '012000', '013000', '014030', '014100', '015000', '016000', '017000'];
const TOKYO_CLASS10_BY_GROUP: Record<TokyoAreaGroup, string> = {
  tokyo_mainland: '130010',
  izu_north: '130020',
  izu_south: '130030',
  ogasawara: '130040',
};

export type JmaClass15AreaOption = {
  code: string;
  name: string;
  class10Code: string | null;
  class10Name: string | null;
};

export type JmaClass20AreaOption = {
  code: string;
  name: string;
  parentCode: string | null;
  parentName: string | null;
  class10Code: string | null;
  class10Name: string | null;
};

let cachedAreaConst: AreaConst | null = null;
let cachedIndex: Map<string, AreaNode> | null = null;

async function readAreaConst(): Promise<AreaConst | null> {
  if (cachedAreaConst) return cachedAreaConst;
  cachedAreaConst = await readJsonFile<AreaConst>(jmaAreaConstPath());
  return cachedAreaConst;
}

async function readAreaIndex(): Promise<Map<string, AreaNode> | null> {
  if (cachedIndex) return cachedIndex;
  const areaConst = await readAreaConst();
  if (!areaConst) return null;
  const index = new Map<string, AreaNode>();
  const push = (source?: Record<string, AreaNode>) => {
    if (!source) return;
    for (const [code, node] of Object.entries(source)) index.set(code, node);
  };
  push(areaConst.offices);
  push(areaConst.centers);
  push(areaConst.class10s);
  push(areaConst.class15s);
  push(areaConst.class20s);
  cachedIndex = index;
  return cachedIndex;
}

export async function getHokkaidoWarningOfficeCodes(): Promise<string[]> {
  const areaConst = await readAreaConst();
  const derived = areaConst?.centers?.['010100']?.children?.filter((code) => areaConst.offices?.[code]) ?? [];
  // Fallback matches JMA area.json's Hokkaido warning offices if local metadata is unavailable.
  return derived.length > 0 ? derived : HOKKAIDO_OFFICE_FALLBACK;
}

export async function getAreaNameFromMetadata(areaCode: string | null | undefined): Promise<string | null> {
  const raw = String(areaCode ?? '').trim();
  if (!raw) return null;
  const index = await readAreaIndex();
  return index?.get(raw)?.name ?? null;
}

export async function getClass10ChildrenForArea(areaCode: string): Promise<Array<{ code: string; name: string }>> {
  const raw = String(areaCode ?? '').trim();
  const areaConst = await readAreaConst();
  const index = await readAreaIndex();
  if (!raw || !areaConst || !index) return [];
  const rootChildren =
    raw === '010000'
      ? areaConst.centers?.['010100']?.children ?? []
      : areaConst.offices?.[raw]?.children ?? areaConst.centers?.[raw]?.children ?? [];
  return rootChildren
    .map((code) => ({ code, name: index.get(code)?.name ?? code }))
    .filter((area) => Boolean(area.code));
}

function resolveAncestorCode(code: string, index: Map<string, AreaNode>, table: Record<string, AreaNode> | undefined): string | null {
  let cursor: string | undefined = code;
  for (let i = 0; i < 12 && cursor; i += 1) {
    if (table?.[cursor]) return cursor;
    cursor = index.get(cursor)?.parent;
  }
  return null;
}

export async function getClass15DescendantsForArea(areaCode: string): Promise<JmaClass15AreaOption[]> {
  const raw = String(areaCode ?? '').trim();
  const areaConst = await readAreaConst();
  const index = await readAreaIndex();
  if (!raw || !areaConst || !index) return [];

  const roots =
    raw === '010000'
      ? areaConst.centers?.['010100']?.children ?? []
      : areaConst.offices?.[raw]?.children ?? areaConst.centers?.[raw]?.children ?? index.get(raw)?.children ?? [];
  const results = new Map<string, JmaClass15AreaOption>();
  const seen = new Set<string>();
  const walk = (code: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    if (areaConst.class15s?.[code]) {
      const class10Code = resolveAncestorCode(code, index, areaConst.class10s);
      results.set(code, {
        code,
        name: index.get(code)?.name ?? code,
        class10Code,
        class10Name: class10Code ? index.get(class10Code)?.name ?? class10Code : null,
      });
    }
    for (const childCode of index.get(code)?.children ?? []) walk(String(childCode));
  };

  for (const root of roots) walk(String(root));
  return Array.from(results.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export async function getClass20DescendantsForArea(areaCode: string): Promise<Array<{ code: string; name: string }>> {
  const raw = String(areaCode ?? '').trim();
  const areaConst = await readAreaConst();
  const index = await readAreaIndex();
  if (!raw || !areaConst || !index) return [];

  const roots =
    raw === '010000'
      ? areaConst.centers?.['010100']?.children ?? []
      : index.get(raw)?.children ?? [];
  const results: Array<{ code: string; name: string }> = [];
  const seen = new Set<string>();
  const walk = (code: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    if (areaConst.class20s?.[code]) {
      results.push({ code, name: index.get(code)?.name ?? code });
      return;
    }
    const children = index.get(code)?.children ?? [];
    for (const childCode of children) walk(String(childCode));
  };

  for (const root of roots) walk(String(root));
  return results;
}

export async function getClass20DescendantsDetailedForArea(areaCode: string): Promise<JmaClass20AreaOption[]> {
  const raw = String(areaCode ?? '').trim();
  const areaConst = await readAreaConst();
  const index = await readAreaIndex();
  if (!raw || !areaConst || !index) return [];

  const base = await getClass20DescendantsForArea(raw);
  return base
    .map((option) => {
      const parentCode = resolveAncestorCode(option.code, index, areaConst.class15s);
      const class10Code = resolveAncestorCode(option.code, index, areaConst.class10s);
      return {
        code: option.code,
        name: option.name,
        parentCode,
        parentName: parentCode ? index.get(parentCode)?.name ?? parentCode : null,
        class10Code,
        class10Name: class10Code ? index.get(class10Code)?.name ?? class10Code : null,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function resolveClass10Code(areaCode: string | null | undefined): Promise<string | null> {
  const raw = String(areaCode ?? '').trim();
  if (!raw) return null;
  const areaConst = await readAreaConst();
  const index = await readAreaIndex();
  if (!areaConst || !index) return null;
  let cursor: string | undefined = raw;
  for (let i = 0; i < 12 && cursor; i += 1) {
    if (areaConst.class10s?.[cursor]) return cursor;
    cursor = index.get(cursor)?.parent;
  }
  return null;
}

export async function classifyTokyoAreaCode(areaCode: string | null | undefined): Promise<TokyoAreaGroup | null> {
  const class10 = await resolveClass10Code(areaCode);
  if (!class10) return null;
  for (const [group, code] of Object.entries(TOKYO_CLASS10_BY_GROUP) as Array<[TokyoAreaGroup, string]>) {
    if (class10 === code) return group;
  }
  return null;
}

function normalizeTokyoGroup(group: string | null | undefined): TokyoAreaGroup | null {
  const raw = String(group ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (raw === 'tokyo_mainland' || raw === 'mainland' || raw === '130010') return 'tokyo_mainland';
  if (raw === 'tokyo_izu_north' || raw === 'izu_north' || raw === '130020') return 'izu_north';
  if (raw === 'tokyo_izu_south' || raw === 'izu_south' || raw === '130030') return 'izu_south';
  if (raw === 'tokyo_ogasawara' || raw === 'ogasawara' || raw === '130040') return 'ogasawara';
  return null;
}

export async function isAreaInTokyoGroup(areaCode: string | null | undefined, group: string | null | undefined): Promise<boolean> {
  const normalized = normalizeTokyoGroup(group);
  if (!normalized) return false;
  return (await classifyTokyoAreaCode(areaCode)) === normalized;
}
