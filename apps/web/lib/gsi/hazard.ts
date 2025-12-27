import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, readJsonFile } from '../jma/cache';
import { getWritableDataDir } from '../server/writable-data';

export type HazardLayerKey = 'flood' | 'landslide' | 'tsunami' | 'liquefaction';
export type TileScheme = 'xyz' | 'tms';

export type HazardLayerTile = {
  url: string;
  scheme: TileScheme;
};

export type HazardLayer = {
  key: HazardLayerKey;
  name: string;
  jaName: string;
  tileUrl: string;
  scheme: TileScheme;
  tiles?: HazardLayerTile[];
  minZoom: number;
  maxZoom: number;
};

export type HazardLayersSnapshot = {
  version: 1;
  updatedAt: string | null;
  fetchStatus: 'OK' | 'DEGRADED';
  lastError: string | null;
  source: {
    metadataUrl: string;
    portalUrl: string;
    portalScripts?: string[] | null;
  };
  layers: HazardLayer[];
};

type LandslideSubLayerKey = 'debris' | 'steep' | 'slide';

const METADATA_URL =
  'https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/metadata_light.xml';
const PORTAL_URL = 'https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/';

const CACHE_PATH = path.join(getWritableDataDir(), 'cache', 'gsi', 'hazard_layers.json');
const LOCK_PATH = path.join(getWritableDataDir(), 'cache', 'gsi', 'hazard_layers.lock');

const STALE_MS = 24 * 60 * 60_000;

const SAMPLE_TILES = [
  { z: 11, x: 1818, y: 806 },
  { z: 11, x: 1819, y: 806 },
  { z: 12, x: 3637, y: 1613 },
];

const LANDSLIDE_SUBLAYERS: Array<{
  id: LandslideSubLayerKey;
  tokens: string[];
  defaultUrl: string;
}> = [
  {
    id: 'debris',
    tokens: ['dosekiryukeikaikuiki', 'dosekiryu', 'debris'],
    defaultUrl: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
  },
  {
    id: 'steep',
    tokens: ['kyukeishakeikaikuiki', 'kyukeisha', 'steep'],
    defaultUrl: 'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png',
  },
  {
    id: 'slide',
    tokens: ['jisuberikeikaikuiki', 'jisuberi', 'landslide'],
    defaultUrl: 'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png',
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function msSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

function forceHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

function normalizeTileUrl(url: string): string {
  const https = forceHttps(url);
  return https.replace(/(?:\.png)+(?=$|\?)/i, '.png');
}

function normalizeTiles(tiles: HazardLayerTile[]): HazardLayerTile[] {
  return tiles.map((t) => ({ ...t, url: normalizeTileUrl(t.url), scheme: t.scheme ?? 'xyz' }));
}

function normalizeLayer(layer: HazardLayer): HazardLayer {
  const tiles = layer.tiles && layer.tiles.length > 0 ? normalizeTiles(layer.tiles) : undefined;
  const scheme = layer.scheme ?? tiles?.[0]?.scheme ?? 'xyz';
  const normalizedTileUrl = tiles?.[0]?.url ?? normalizeTileUrl(layer.tileUrl);
  return {
    ...layer,
    tileUrl: normalizedTileUrl,
    scheme,
    tiles,
  };
}

function defaultLayers(): HazardLayer[] {
  const landslideTiles: HazardLayerTile[] = LANDSLIDE_SUBLAYERS.map((sublayer) => ({ url: sublayer.defaultUrl, scheme: 'xyz' }));
  const fallbackLayers = [
    {
      key: 'flood',
      name: 'Flood',
      jaName: '洪水',
      tileUrl: 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png',
      scheme: 'xyz',
      minZoom: 10,
      maxZoom: 17,
    },
    {
      key: 'landslide',
      name: 'Landslide',
      jaName: '土砂災害',
      tileUrl: landslideTiles[0].url,
      scheme: landslideTiles[0].scheme,
      tiles: landslideTiles,
      minZoom: 10,
      maxZoom: 17,
    },
    {
      key: 'tsunami',
      name: 'Tsunami',
      jaName: '津波',
      tileUrl: '/api/tiles/tsunami/{z}/{x}/{y}.png',
      scheme: 'xyz',
      minZoom: 10,
      maxZoom: 17,
    },
    {
      key: 'liquefaction',
      name: 'Liquefaction',
      jaName: '液状化',
      tileUrl: '/api/tiles/lcm25k_2012/{z}/{x}/{y}.png',
      scheme: 'xyz',
      minZoom: 10,
      maxZoom: 16,
    },
  ] satisfies HazardLayer[];
  return fallbackLayers.map(normalizeLayer);
}

async function acquireLock(): Promise<boolean> {
  await fs.mkdir(path.dirname(LOCK_PATH), { recursive: true });
  try {
    const h = await fs.open(LOCK_PATH, 'wx');
    await h.writeFile(JSON.stringify({ pid: process.pid, at: nowIso() }), 'utf8').catch(() => null);
    await h.close();
    return true;
  } catch {
    const stat = await fs.stat(LOCK_PATH).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 2 * 60_000) {
      await fs.unlink(LOCK_PATH).catch(() => null);
      try {
        const h = await fs.open(LOCK_PATH, 'wx');
        await h.writeFile(JSON.stringify({ pid: process.pid, at: nowIso(), recovered: true }), 'utf8').catch(() => null);
        await h.close();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function releaseLock(): Promise<void> {
  await fs.unlink(LOCK_PATH).catch(() => null);
}

function needsUpgrade(layers: HazardLayer[] | null | undefined): boolean {
  if (!layers) return true;
  return layers.some((l) => {
    if (!l.scheme || /^http:\/\//i.test(l.tileUrl)) return true;
    if (l.key === 'liquefaction' && /\/liquefaction\//i.test(l.tileUrl)) return true;
    return false;
  });
}

function normalizeSnapshot(snapshot: HazardLayersSnapshot): { snapshot: HazardLayersSnapshot; changed: boolean } {
  const normalizedLayers = snapshot.layers.map(normalizeLayer);
  const changed = JSON.stringify(snapshot.layers) !== JSON.stringify(normalizedLayers);
  if (!changed) return { snapshot, changed: false };
  return { snapshot: { ...snapshot, layers: normalizedLayers }, changed: true };
}

function stabilizeSnapshot(snapshot: HazardLayersSnapshot): { snapshot: HazardLayersSnapshot; changed: boolean } {
  if (snapshot.fetchStatus === 'OK') return { snapshot, changed: false };
  if (snapshot.lastError) return { snapshot, changed: false };
  if (!snapshot.layers || snapshot.layers.length === 0) return { snapshot, changed: false };
  const updatedAt = snapshot.updatedAt ?? nowIso();
  return {
    snapshot: { ...snapshot, fetchStatus: 'OK', updatedAt },
    changed: true,
  };
}

function normalizeTemplate(raw: string): string | null {
  if (!raw) return null;
  const normalized = normalizeTileUrl(raw.trim()).replace(/\$\{([xyz])\}/g, '{$1}');
  if (!normalized.startsWith('https://')) return null;
  const lower = normalized.toLowerCase();
  if (!(lower.includes('{z}') && lower.includes('{x}') && lower.includes('{y}'))) return null;
  return normalized;
}

function extractTemplateUrls(text: string): string[] {
  const cleaned = text.replace(/\$\{([xyz])\}/g, '{$1}').replace(/&amp;/g, '&');
  const matches = cleaned.match(/https:\/\/[^\s"'`<>]+/g) ?? [];
  const found = new Set<string>();
  for (const match of matches) {
    const trimmed = match.replace(/[)\],"'<>]+$/g, '');
    const template = normalizeTemplate(trimmed);
    if (template) found.add(template);
  }
  return Array.from(found);
}

async function fetchText(url: string, timeoutMs = 8_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`.trim());
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

async function discoverHazardTemplates(): Promise<{ templates: string[]; portalScripts: string[] }> {
  const templates = new Set<string>();
  const portalScripts: string[] = [];
  const errors: string[] = [];

  try {
    const xml = await fetchText(METADATA_URL);
    extractTemplateUrls(xml).forEach((t) => templates.add(t));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  let html = '';
  try {
    html = await fetchText(PORTAL_URL);
    extractTemplateUrls(html).forEach((t) => templates.add(t));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (html) {
    const scriptMatches = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)).map((m) => m[1]);
    for (const rawSrc of scriptMatches) {
      const scriptUrl = forceHttps(new URL(rawSrc, PORTAL_URL).toString());
      if (!scriptUrl.startsWith('https://')) continue;
      if (portalScripts.includes(scriptUrl)) continue;
      portalScripts.push(scriptUrl);
    }
  }

  for (const scriptUrl of portalScripts) {
    try {
      const js = await fetchText(scriptUrl);
      extractTemplateUrls(js).forEach((t) => templates.add(t));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (templates.size === 0) {
    throw new Error(errors.length > 0 ? `No hazard templates discovered (${errors[0]})` : 'No hazard templates discovered');
  }
  return { templates: Array.from(templates), portalScripts };
}

function classifyTemplate(url: string): { key: HazardLayerKey; subKey?: LandslideSubLayerKey } | null {
  const lower = url.toLowerCase();

  for (const sub of LANDSLIDE_SUBLAYERS) {
    if (sub.tokens.some((token) => lower.includes(token))) return { key: 'landslide', subKey: sub.id };
  }

  if (lower.includes('flood') || lower.includes('shinsuishin') || lower.includes('01_flood')) return { key: 'flood' };
  if (lower.includes('tsunami') || lower.includes('04_tsunami')) return { key: 'tsunami' };
  if (lower.includes('liquefaction') || lower.includes('ekijoka') || lower.includes('ekijouka') || lower.includes('lcm25k')) return { key: 'liquefaction' };

  return null;
}

function buildCandidateMap(templates: string[]) {
  const candidates: Record<HazardLayerKey, string[]> = {
    flood: [],
    landslide: [],
    tsunami: [],
    liquefaction: [],
  };
  const landslideCandidates: Record<LandslideSubLayerKey, string[]> = {
    debris: [],
    steep: [],
    slide: [],
  };

  const pushUnique = (list: string[], url: string) => {
    if (!list.includes(url)) list.push(url);
  };

  for (const template of templates) {
    const match = classifyTemplate(template);
    if (!match) continue;
    if (match.key === 'landslide') {
      const subKey = match.subKey ?? 'debris';
      pushUnique(landslideCandidates[subKey], template);
    } else {
      pushUnique(candidates[match.key], template);
    }
  }

  return { candidates, landslideCandidates };
}

function buildTileUrl(template: string, z: number, x: number, y: number, scheme: TileScheme): string {
  const tmsY = scheme === 'tms' ? (1 << z) - 1 - y : y;
  return template.replace(/\{z\}/g, String(z)).replace(/\{x\}/g, String(x)).replace(/\{y\}/g, String(tmsY));
}

async function fetchTileStatus(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
    return resp.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeTemplate(template: string, scheme: TileScheme): Promise<{ ok: boolean; statuses: number[] }> {
  const statuses: number[] = [];
  for (const sample of SAMPLE_TILES) {
    const url = buildTileUrl(template, sample.z, sample.x, sample.y, scheme);
    const status = await fetchTileStatus(url);
    statuses.push(status ?? 0);
  }
  const ok = statuses.some((status) => status >= 200 && status < 300);
  return { ok, statuses };
}

async function resolveTemplate(candidates: string[], fallbackUrl: string): Promise<HazardLayerTile> {
  const ordered = Array.from(new Set([...candidates, fallbackUrl].filter(Boolean)));
  for (const template of ordered) {
    const xyz = await probeTemplate(template, 'xyz');
    if (xyz.ok) return { url: template, scheme: 'xyz' };
    const tms = await probeTemplate(template, 'tms');
    if (tms.ok) return { url: template, scheme: 'tms' };
  }
  return { url: fallbackUrl, scheme: 'xyz' };
}

export async function readHazardLayersCache(): Promise<HazardLayersSnapshot | null> {
  return readJsonFile<HazardLayersSnapshot>(CACHE_PATH);
}

export async function getHazardLayersSnapshot(): Promise<HazardLayersSnapshot> {
  const cached = await readHazardLayersCache();
  const usableCached = cached?.version === 1 && !needsUpgrade(cached.layers) ? cached : null;
  const snapshot: HazardLayersSnapshot =
    usableCached
      ? usableCached
      : {
          version: 1,
          updatedAt: null,
          fetchStatus: 'DEGRADED',
          lastError: null,
          source: { metadataUrl: METADATA_URL, portalUrl: PORTAL_URL, portalScripts: null },
          layers: defaultLayers(),
        };

  const normalized = normalizeSnapshot(snapshot);
  const stabilized = stabilizeSnapshot(normalized.snapshot);
  const readySnapshot = stabilized.changed ? stabilized.snapshot : normalized.snapshot;
  if (normalized.changed || stabilized.changed) {
    void atomicWriteJson(CACHE_PATH, readySnapshot).catch(() => null);
  }

  if (msSince(readySnapshot.updatedAt) <= STALE_MS) return readySnapshot;

  // Stale-while-revalidate: refresh opportunistically; never throw.
  void refreshHazardLayers().catch(() => null);
  return readySnapshot;
}

export async function refreshHazardLayers(): Promise<void> {
  const gotLock = await acquireLock();
  if (!gotLock) return;
  try {
    const cached = await readHazardLayersCache();
    if (cached?.version === 1 && msSince(cached.updatedAt) <= STALE_MS) return;

    try {
      const discovery = await discoverHazardTemplates();
      const { candidates, landslideCandidates } = buildCandidateMap(discovery.templates);
      const defaults = defaultLayers();
      const defaultByKey = new Map(defaults.map((layer) => [layer.key, layer]));

      const floodTile = await resolveTemplate(candidates.flood, defaultByKey.get('flood')!.tileUrl);
      const tsunamiTile = await resolveTemplate(candidates.tsunami, defaultByKey.get('tsunami')!.tileUrl);
      const liquefactionTile = await resolveTemplate(candidates.liquefaction, defaultByKey.get('liquefaction')!.tileUrl);

      const landslideTiles: HazardLayerTile[] = [];
      for (const sub of LANDSLIDE_SUBLAYERS) {
        const resolved = await resolveTemplate(landslideCandidates[sub.id], sub.defaultUrl);
        landslideTiles.push(resolved);
      }

      const layers: HazardLayer[] = [
        {
          ...defaultByKey.get('flood')!,
          tileUrl: floodTile.url,
          scheme: floodTile.scheme,
        },
        {
          ...defaultByKey.get('landslide')!,
          tileUrl: landslideTiles[0]?.url ?? defaultByKey.get('landslide')!.tileUrl,
          scheme: landslideTiles[0]?.scheme ?? 'xyz',
          tiles: landslideTiles.length > 0 ? landslideTiles : defaultByKey.get('landslide')!.tiles,
        },
        {
          ...defaultByKey.get('tsunami')!,
          tileUrl: tsunamiTile.url,
          scheme: tsunamiTile.scheme,
        },
        {
          ...defaultByKey.get('liquefaction')!,
          tileUrl: liquefactionTile.url,
          scheme: liquefactionTile.scheme,
        },
      ].map(normalizeLayer);

      const next: HazardLayersSnapshot = {
        version: 1,
        updatedAt: nowIso(),
        fetchStatus: 'OK',
        lastError: null,
        source: { metadataUrl: METADATA_URL, portalUrl: PORTAL_URL, portalScripts: discovery.portalScripts },
        layers,
      };
      await atomicWriteJson(CACHE_PATH, next);
    } catch (error) {
      const next: HazardLayersSnapshot = {
        version: 1,
        updatedAt: cached?.updatedAt ?? null,
        fetchStatus: 'DEGRADED',
        lastError: error instanceof Error ? error.message : String(error),
        source: { metadataUrl: METADATA_URL, portalUrl: PORTAL_URL, portalScripts: cached?.source?.portalScripts ?? null },
        layers: (cached?.layers?.length ? cached.layers : defaultLayers()).map(normalizeLayer),
      };
      await atomicWriteJson(CACHE_PATH, next);
    }
  } finally {
    await releaseLock();
  }
}
