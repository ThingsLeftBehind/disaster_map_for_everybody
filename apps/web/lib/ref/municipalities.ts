import municipalitiesData from '../../data/generated/municipalities.json';

export type MunicipalityRef = {
  prefCode: string;
  prefName: string;
  muniCode: string;
  muniName: string;
};

let cached: MunicipalityRef[] | null = null;
let cachedByMuni: Map<string, MunicipalityRef> | null = null;
let cachedByPref: Map<string, string> | null = null;

async function loadAll(): Promise<MunicipalityRef[]> {
  if (cached) return cached;
  const json = municipalitiesData as MunicipalityRef[];
  cached = Array.isArray(json) ? json : [];
  cachedByMuni = null;
  cachedByPref = null;
  return cached;
}

export async function listPrefectures(): Promise<Array<{ prefCode: string; prefName: string }>> {
  const all = await loadAll();
  const map = new Map<string, string>();
  for (const row of all) {
    if (!row?.prefCode || !row?.prefName) continue;
    map.set(row.prefCode, row.prefName);
  }
  return Array.from(map.entries())
    .map(([prefCode, prefName]) => ({ prefCode, prefName }))
    .sort((a, b) => a.prefCode.localeCompare(b.prefCode));
}

export async function listMunicipalitiesByPref(prefCode: string): Promise<Array<{ muniCode: string; muniName: string }>> {
  const all = await loadAll();
  return all
    .filter((r) => r.prefCode === prefCode)
    .map((r) => ({ muniCode: r.muniCode, muniName: r.muniName }))
    .sort((a, b) => a.muniCode.localeCompare(b.muniCode));
}

export type AreaName = {
  prefCode: string | null;
  prefName: string | null;
  muniCode: string | null;
  muniName: string | null;
};

async function loadIndex(): Promise<{ byMuni: Map<string, MunicipalityRef>; byPref: Map<string, string> }> {
  if (cachedByMuni && cachedByPref) return { byMuni: cachedByMuni, byPref: cachedByPref };
  const all = await loadAll();
  const byMuni = new Map<string, MunicipalityRef>();
  const byPref = new Map<string, string>();
  for (const row of all) {
    if (row?.muniCode) byMuni.set(row.muniCode, row);
    if (row?.prefCode && row?.prefName) byPref.set(row.prefCode, row.prefName);
  }
  cachedByMuni = byMuni;
  cachedByPref = byPref;
  return { byMuni, byPref };
}

export async function lookupAreaName(args: { prefCode?: string | null; muniCode?: string | null }): Promise<AreaName> {
  const prefCodeRaw = typeof args.prefCode === 'string' ? args.prefCode : null;
  const muniCodeRaw = typeof args.muniCode === 'string' ? args.muniCode : null;

  const prefCodeFromMuni = muniCodeRaw && /^\d{6}$/.test(muniCodeRaw) ? muniCodeRaw.slice(0, 2) : null;
  const prefCode = prefCodeRaw ?? prefCodeFromMuni;
  const muniCode = muniCodeRaw;

  const { byMuni, byPref } = await loadIndex();
  const muni = muniCode ? byMuni.get(muniCode) ?? null : null;

  const resolvedPrefCode = muni?.prefCode ?? prefCode ?? null;
  const resolvedPrefName = muni?.prefName ?? (resolvedPrefCode ? byPref.get(resolvedPrefCode) ?? null : null);

  return {
    prefCode: resolvedPrefCode,
    prefName: resolvedPrefName,
    muniCode: muni?.muniCode ?? muniCode,
    muniName: muni?.muniName ?? null,
  };
}
