import crypto from 'node:crypto';
import path from 'node:path';
import { NORMALIZATION_LIMITS } from './config';
import { parseAtomFeed } from './atom';
import { fileExists, readJsonFile, readTextFile, atomicWriteJson } from './cache';
import { atomEntryHash } from './fetchers';
import {
  jmaAreaConstPath,
  getRepoRootDir,
  jmaEntryXmlPath,
  jmaFeedXmlPath,
  jmaNormalizedQuakesPath,
  jmaNormalizedStatusPath,
  jmaNormalizedWarningsPath,
  jmaWebJsonQuakeListPath,
  jmaWebJsonWarningPath,
} from './paths';
import { readJmaState } from './state';
import type {
  FetchStatus,
  JmaFeedKey,
  NormalizedQuakeItem,
  NormalizedQuakesSnapshot,
  NormalizedStatusSnapshot,
  NormalizedWarningItem,
  NormalizedWarningsAreaSnapshot,
  NormalizedWarningsSnapshot,
} from './types';

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function xmlTextBetween(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m?.[1]?.trim() ?? null;
}

function toMinuteKey(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 16);
}

function normalizeFullWidthDigits(input: string): string {
  return input.replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch)));
}

function normalizeIntensityLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = normalizeFullWidthDigits(String(raw)).trim();
  if (!t) return null;
  const m = t.match(/([0-7])\s*([+\-]|弱|強)?/);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  const mod = (m[2] ?? '').trim();
  if (!mod) return String(base);
  if (mod === '-' || mod === '弱') return `${base}弱`;
  if (mod === '+' || mod === '強') return `${base}強`;
  return `${base}${mod}`;
}

function intensityScore(label: string): number {
  const t = normalizeFullWidthDigits(label);
  const m = t.match(/([0-7])\s*(弱|強)?/);
  if (!m) return 0;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return 0;
  const mod = m[2] ?? '';
  return base + (mod === '強' ? 0.5 : 0);
}

function normalizeJstLikeTimeToIso(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = normalizeFullWidthDigits(String(raw).trim());
  if (!trimmed) return null;

  const m = trimmed.match(
    /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    const h = (hh ?? '00').padStart(2, '0');
    const min = (mm ?? '00').padStart(2, '0');
    const sec = (ss ?? '00').padStart(2, '0');
    const isoJst = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h}:${min}:${sec}+09:00`;
    const t = Date.parse(isoJst);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }

  const t = Date.parse(trimmed);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return trimmed;
}

function pickFirstString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    const v = (value as any)[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function pickMagnitude(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v =
    (value as any).mag ??
    (value as any).magnitude ??
    (value as any).m ??
    (value as any).M ??
    (value as any).mj;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function normalizeDepthKm(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 1000) return raw / 1000;
    return raw;
  }
  if (typeof raw === 'string') {
    const t = normalizeFullWidthDigits(raw).trim();
    if (!t) return null;
    const m = t.match(/([0-9]+(?:\.[0-9]+)?)\s*km/i);
    if (m) return Number(m[1]);
    const n = Number(t.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) return null;
    return n > 1000 ? n / 1000 : n;
  }
  return null;
}

function pickDepthKm(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const coord =
    (value as any).cod ??
    (value as any).coord ??
    (value as any).coordinate ??
    (value as any).Coordinate;
  if (typeof coord === 'string') {
    const parsed = extractDepthKmFromCoordinate(coord);
    if (parsed !== null) return parsed;
  }
  const v =
    (value as any).depth ??
    (value as any).dep ??
    (value as any).depthKm ??
    (value as any).depth_km ??
    (value as any).depthkm ??
    (value as any).d;
  return normalizeDepthKm(v);
}

function pickReportType(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v =
    (value as any).infoKind ??
    (value as any).reportType ??
    (value as any).kind ??
    (value as any).type ??
    (value as any).report ??
    (value as any).headline;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function isSokuhouReport(reportType: string | null, title: string | null): boolean {
  if (reportType && reportType.includes('速報')) return true;
  if (!reportType && title && title.includes('速報')) return true;
  return false;
}

function extractMagnitude(xml: string): string | null {
  return (
    xmlTextBetween(xml, 'jmx_eb:Magnitude') ??
    xmlTextBetween(xml, 'Magnitude') ??
    xmlTextBetween(xml, 'magnitude')
  );
}

function extractReportType(xml: string): string | null {
  return (
    xmlTextBetween(xml, 'jmx_eb:InfoKind') ??
    xmlTextBetween(xml, 'InfoKind') ??
    xmlTextBetween(xml, 'jmx_eb:ReportKind') ??
    xmlTextBetween(xml, 'ReportKind') ??
    xmlTextBetween(xml, 'jmx_eb:ControlTitle') ??
    xmlTextBetween(xml, 'ControlTitle')
  );
}

function extractEpicenter(xml: string): string | null {
  const hypoBlockMatch = xml.match(/<jmx_eb:Hypocenter\b[\s\S]*?<\/jmx_eb:Hypocenter>/i);
  const hypoBlock = hypoBlockMatch?.[0];
  if (hypoBlock) {
    return xmlTextBetween(hypoBlock, 'jmx_eb:Name') ?? xmlTextBetween(hypoBlock, 'Name');
  }

  const areaBlockMatch = xml.match(/<jmx_eb:Area\b[\s\S]*?<\/jmx_eb:Area>/i);
  const areaBlock = areaBlockMatch?.[0];
  if (areaBlock) {
    return xmlTextBetween(areaBlock, 'jmx_eb:Name') ?? xmlTextBetween(areaBlock, 'Name');
  }

  return null;
}

function extractDepthKm(xml: string): number | null {
  const coordMatch = xml.match(/<jmx_eb:Coordinate\b[^>]*>([\s\S]*?)<\/jmx_eb:Coordinate>/i);
  if (!coordMatch) return null;
  const coordBlock = coordMatch[0];
  const descMatch = coordBlock.match(/description="([^"]+)"/i);
  const desc = normalizeFullWidthDigits(descMatch?.[1] ?? '');
  const depthMatch = desc.match(/深さ\s*([0-9]+(?:\.[0-9]+)?)\s*km/i);
  if (depthMatch) return Number(depthMatch[1]);

  return extractDepthKmFromCoordinate(coordMatch[1] ?? '');
}

function extractDepthKmFromCoordinate(raw: string): number | null {
  const coordText = normalizeFullWidthDigits(raw ?? '').trim();
  const parts = coordText.match(/[+-]\d+(?:\.\d+)?/g);
  if (parts && parts.length >= 3) {
    const depthMeters = Math.abs(Number(parts[2]));
    if (Number.isFinite(depthMeters)) return depthMeters / 1000;
  }
  return null;
}

function extractMaxIntensity(xml: string): string | null {
  const intensityMatch = xml.match(/<Intensity[\s\S]*?<\/Intensity>/i);
  if (!intensityMatch) return null;
  const block = intensityMatch[0];
  const raw = xmlTextBetween(block, 'MaxInt');
  return normalizeIntensityLabel(raw) ?? (raw ? normalizeFullWidthDigits(raw).trim() : null);
}

function extractIntensityAreas(xml: string): Array<{ intensity: string; areas: string[] }> | null {
  const intensityMatch = xml.match(/<Intensity[\s\S]*?<\/Intensity>/i);
  if (!intensityMatch) return null;
  const block = intensityMatch[0];
  const prefBlocks = block.match(/<Pref>[\s\S]*?<\/Pref>/gi) ?? [];
  if (prefBlocks.length === 0) return null;

  const grouped = new Map<string, Set<string>>();
  for (const prefBlock of prefBlocks) {
    const prefName = xmlTextBetween(prefBlock, 'Name') ?? '';
    const areaBlocks = prefBlock.match(/<Area>[\s\S]*?<\/Area>/gi) ?? [];
    if (areaBlocks.length === 0) {
      const prefIntensity = normalizeIntensityLabel(xmlTextBetween(prefBlock, 'MaxInt') ?? xmlTextBetween(prefBlock, 'Int'));
      if (prefIntensity && prefName) {
        const set = grouped.get(prefIntensity) ?? new Set<string>();
        set.add(prefName);
        grouped.set(prefIntensity, set);
      }
      continue;
    }

    for (const areaBlock of areaBlocks) {
      const areaName = xmlTextBetween(areaBlock, 'Name');
      const areaIntensity = normalizeIntensityLabel(xmlTextBetween(areaBlock, 'MaxInt') ?? xmlTextBetween(areaBlock, 'Int'));
      if (!areaName || !areaIntensity) continue;
      const label = prefName && !areaName.startsWith(prefName) ? `${prefName} ${areaName}` : areaName;
      const set = grouped.get(areaIntensity) ?? new Set<string>();
      set.add(label);
      grouped.set(areaIntensity, set);
    }
  }

  if (grouped.size === 0) return null;
  const result = Array.from(grouped.entries()).map(([intensity, areas]) => ({
    intensity,
    areas: Array.from(areas),
  }));
  result.sort((a, b) => intensityScore(b.intensity) - intensityScore(a.intensity));
  return result;
}

function extractIntensityAreasFromWebJson(
  row: any,
  areaConst: AreaConst | null,
  prefNamesByCode: Record<string, string> | null
): Array<{ intensity: string; areas: string[] }> | null {
  if (!row || typeof row !== 'object') return null;
  const entries = (row as any).int;
  if (!Array.isArray(entries)) return null;

  const grouped = new Map<string, Set<string>>();
  for (const pref of entries) {
    if (!pref || typeof pref !== 'object') continue;
    const prefIntensity = normalizeIntensityLabel((pref as any).maxi ?? (pref as any).maxInt);
    const cities = Array.isArray((pref as any).city) ? (pref as any).city : [];
    for (const city of cities) {
      if (!city || typeof city !== 'object') continue;
      const intensity = normalizeIntensityLabel((city as any).maxi ?? (city as any).maxInt) ?? prefIntensity;
      if (!intensity) continue;
      const code = typeof (city as any).code === 'string' ? (city as any).code : String((city as any).code ?? '');
      if (!code) continue;
      const name = formatAreaNameFromClass20(code, areaConst, prefNamesByCode);
      if (!name) continue;
      const set = grouped.get(intensity) ?? new Set<string>();
      set.add(name);
      grouped.set(intensity, set);
    }
  }

  if (grouped.size === 0) return null;
  const result = Array.from(grouped.entries()).map(([intensity, areas]) => ({
    intensity,
    areas: Array.from(areas),
  }));
  result.sort((a, b) => intensityScore(b.intensity) - intensityScore(a.intensity));
  return result;
}

function formatAreaNameFromClass20(
  code: string,
  areaConst: AreaConst | null,
  prefNamesByCode: Record<string, string> | null
): string | null {
  if (!code || !areaConst?.class20s) return null;
  const entry = areaConst.class20s[code];
  const baseName = entry?.name?.trim();
  if (!baseName) return null;
  const prefCode = code.slice(0, 2);
  const prefName = prefNamesByCode?.[prefCode];
  if (prefName && !baseName.startsWith(prefName)) {
    return `${prefName}${baseName}`;
  }
  return baseName;
}

function computeFetchStatus(updatedAt: string | null, lastError: string | null): FetchStatus {
  if (!updatedAt) return 'DEGRADED';
  if (lastError) return 'DEGRADED';
  return 'OK';
}

function dedupeQuakeItems(items: NormalizedQuakeItem[]): NormalizedQuakeItem[] {
  const seen = new Set<string>();
  const out: NormalizedQuakeItem[] = [];
  for (const it of items) {
    const key = `${it.time ?? ''}|${it.title}|${it.link ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function buildQuakeTitle(args: { maxi: string | null; epicenter: string | null; magnitude: string | null }): string {
  const parts: string[] = [];
  if (args.maxi) parts.push(`最大震度${args.maxi}`);
  if (args.epicenter) parts.push(args.epicenter);
  if (args.magnitude) parts.push(`M${args.magnitude}`);
  return parts.length > 0 ? parts.join(' ') : '地震情報';
}

function normalizeQuakesFromWebJson(
  raw: unknown,
  areaConst: AreaConst | null,
  prefNamesByCode: Record<string, string> | null
): NormalizedQuakeItem[] {
  if (!Array.isArray(raw)) return [];

  const parsed: NormalizedQuakeItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;

    // Prefer "origin time" fields over "announcement/update time" fields.
    const timeRaw = pickFirstString(row, ['ot', 'originTime', 'origin_time', 'time', 'datetime', 'dateTime', 'timestamp', 'at']);
    const time = normalizeJstLikeTimeToIso(timeRaw);
    const epicenter = pickFirstString(row, ['anm', 'an', 'name', 'place', 'epicenter', 'loc', 'en']);
    const magnitude = pickMagnitude(row);
    const maxi = pickFirstString(row, ['maxi', 'maxIntensity', 'max', 'int', 'intensity', 'shindo']);
    const maxIntensity = normalizeIntensityLabel(maxi) ?? maxi;
    const depthKm = pickDepthKm(row);
    const link = pickFirstString(row, ['url', 'link', 'href', 'detailUrl', 'detail', 'page']);
    const title = pickFirstString(row, ['ttl', 'title', 'headline', 'text']) ?? buildQuakeTitle({ maxi: maxIntensity, epicenter, magnitude });
    const reportType = pickFirstString(row, ['ttl', 'title']) ?? pickReportType(row);
    const intensityAreas = extractIntensityAreasFromWebJson(row, areaConst, prefNamesByCode);

    if (isSokuhouReport(reportType, title)) continue;

    const idBasis = JSON.stringify({ time, title, link });
    const id = crypto.createHash('sha256').update(idBasis).digest('hex').slice(0, 16);
    parsed.push({
      id,
      time,
      title,
      reportType: reportType ?? null,
      link,
      maxIntensity: maxIntensity ?? null,
      magnitude,
      epicenter,
      depthKm,
      intensityAreas,
      source: 'webjson',
    });
    if (parsed.length >= NORMALIZATION_LIMITS.quakesItems) break;
  }

  const sorted = parsed.sort((a, b) => {
    const ta = a.time ? Date.parse(a.time) : Number.NEGATIVE_INFINITY;
    const tb = b.time ? Date.parse(b.time) : Number.NEGATIVE_INFINITY;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

  return dedupeQuakeItems(sorted);
}

function quakeMergeKey(item: NormalizedQuakeItem): string {
  const minute = toMinuteKey(item.time) ?? '';
  const center = item.epicenter ?? '';
  const intensity = item.maxIntensity ?? '';
  return `${minute}|${center}|${intensity}`;
}

function mergeQuakeItems(primary: NormalizedQuakeItem[], secondary: NormalizedQuakeItem[]): NormalizedQuakeItem[] {
  const out: NormalizedQuakeItem[] = [];
  const seen = new Set<string>();
  for (const item of primary) {
    const key = quakeMergeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  for (const item of secondary) {
    const key = quakeMergeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function rebuildNormalizedStatus(): Promise<NormalizedStatusSnapshot> {
  const state = await readJmaState();

  const feeds = Object.fromEntries(
    (Object.keys(state.feeds) as JmaFeedKey[]).map((feed) => {
      const s = state.feeds[feed];
      return [
        feed,
        {
          fetchStatus: computeFetchStatus(s.lastSuccessfulUpdateTime, s.lastError),
          updatedAt: s.lastSuccessfulUpdateTime,
          lastError: s.lastError,
        },
      ];
    })
  ) as NormalizedStatusSnapshot['feeds'];

  const quakeList = {
    fetchStatus: computeFetchStatus(
      state.webjson.quakeList.lastSuccessfulUpdateTime,
      state.webjson.quakeList.lastError
    ),
    updatedAt: state.webjson.quakeList.lastSuccessfulUpdateTime,
    lastError: state.webjson.quakeList.lastError,
  };

  const fetchStatus: FetchStatus =
    Object.values(feeds).some((f) => f.fetchStatus === 'DEGRADED') ? 'DEGRADED' : 'OK';

  const updatedAt = maxIso(
    (Object.keys(state.feeds) as JmaFeedKey[]).reduce<string | null>(
      (acc, feed) => maxIso(acc, state.feeds[feed].lastSuccessfulUpdateTime),
      null
    ),
    state.webjson.quakeList.lastSuccessfulUpdateTime
  );

  const snapshot: NormalizedStatusSnapshot = {
    updatedAt,
    fetchStatus,
    feeds,
    webjson: { quakeList },
  };

  await atomicWriteJson(jmaNormalizedStatusPath(), snapshot);
  return snapshot;
}

export async function rebuildNormalizedQuakes(): Promise<NormalizedQuakesSnapshot> {
  const state = await readJmaState();
  const quakeListRaw = await readCachedQuakeListWebJson();
  const previous = await readJsonFile<NormalizedQuakesSnapshot>(jmaNormalizedQuakesPath());

  const webUpdatedAt = state.webjson.quakeList.lastSuccessfulUpdateTime;
  const pullUpdatedAt = state.feeds.eqvol.lastSuccessfulUpdateTime;

  const areaConst = await readAreaConst();
  const prefNamesByCode = await readPrefNamesByCode();
  const webItems = normalizeQuakesFromWebJson(quakeListRaw, areaConst, prefNamesByCode);

  const quakeHintsByMinute = new Map<string, { magnitude: string | null; epicenter: string | null }>();
  if (Array.isArray(quakeListRaw)) {
    for (const row of quakeListRaw) {
      const time = pickFirstString(row, ['at', 'time', 'datetime', 'originTime', 'ot']);
      const key = toMinuteKey(time);
      if (!key) continue;
      const epicenter = pickFirstString(row, ['name', 'place', 'epicenter', 'loc', 'en', 'an']);
      const magnitude = pickMagnitude(row);
      if (!epicenter && !magnitude) continue;
      quakeHintsByMinute.set(key, { magnitude, epicenter });
    }
  }

  const feedXml = await readTextFile(jmaFeedXmlPath('eqvol'));
  const pullItems: NormalizedQuakeItem[] = [];
  if (feedXml) {
    const { entries } = parseAtomFeed(feedXml);

    for (const entry of entries.slice(0, NORMALIZATION_LIMITS.quakesItems)) {
      const hash = atomEntryHash(entry);
      const detailPath = jmaEntryXmlPath(hash);

      let magnitude: string | null = null;
      let epicenter: string | null = null;
      let depthKm: number | null = null;
      let maxIntensity: string | null = null;
      let intensityAreas: Array<{ intensity: string; areas: string[] }> | null = null;
      let reportType: string | null = null;
      if (await fileExists(detailPath)) {
        const detailXml = await readTextFile(detailPath);
        if (detailXml) {
          magnitude = extractMagnitude(detailXml);
          epicenter = extractEpicenter(detailXml);
          depthKm = extractDepthKm(detailXml);
          maxIntensity = extractMaxIntensity(detailXml);
          intensityAreas = extractIntensityAreas(detailXml) ?? null;
          reportType = extractReportType(detailXml);
        }
      }

      if (isSokuhouReport(reportType, entry.title)) continue;

      const minuteKey = toMinuteKey(entry.updated ?? entry.published);
      const hint = minuteKey ? quakeHintsByMinute.get(minuteKey) : null;
      if (hint) {
        magnitude ||= hint.magnitude;
        epicenter ||= hint.epicenter;
      }

      const id = crypto.createHash('sha256').update(entry.id).digest('hex').slice(0, 16);
      pullItems.push({
        id,
        time: entry.updated ?? entry.published,
        title: entry.title,
        reportType: reportType ?? null,
        link: entry.link,
        maxIntensity,
        magnitude,
        epicenter,
        depthKm,
        intensityAreas,
        source: 'pull',
      });
    }
  }

  const merged = mergeQuakeItems(pullItems, webItems);
  if (merged.length === 0) {
    if (previous) return previous;
    const empty: NormalizedQuakesSnapshot = { updatedAt: maxIso(webUpdatedAt, pullUpdatedAt), items: [] };
    await atomicWriteJson(jmaNormalizedQuakesPath(), empty);
    return empty;
  }

  const snapshot: NormalizedQuakesSnapshot = {
    updatedAt: maxIso(webUpdatedAt, pullUpdatedAt) ?? previous?.updatedAt ?? null,
    items: dedupeQuakeItems(merged),
  };
  await atomicWriteJson(jmaNormalizedQuakesPath(), snapshot);
  return snapshot;
}

type AreaConst = {
  offices?: Record<string, { name?: string }>;
  class10s?: Record<string, { name?: string; parent?: string }>;
  class15s?: Record<string, { name?: string; parent?: string }>;
  class20s?: Record<string, { name?: string; parent?: string }>;
  centers?: Record<string, { name?: string }>;
};

let cachedAreaConst: AreaConst | null = null;
let cachedPrefNamesByCode: Record<string, string> | null = null;

async function readAreaConst(): Promise<AreaConst | null> {
  if (cachedAreaConst) return cachedAreaConst;
  const json = await readJsonFile<AreaConst>(jmaAreaConstPath());
  if (!json) return null;
  cachedAreaConst = json;
  return cachedAreaConst;
}

async function readPrefNamesByCode(): Promise<Record<string, string> | null> {
  if (cachedPrefNamesByCode) return cachedPrefNamesByCode;
  const filePath = path.join(getRepoRootDir(), 'data', 'generated', 'municipalities.json');
  const rows = await readJsonFile<Array<{ prefCode?: string; prefName?: string }>>(filePath);
  if (!rows || !Array.isArray(rows)) return null;
  const map: Record<string, string> = {};
  for (const row of rows) {
    const code = row?.prefCode;
    const name = row?.prefName;
    if (!code || !name || map[code]) continue;
    map[code] = name;
  }
  cachedPrefNamesByCode = map;
  return cachedPrefNamesByCode;
}

export async function areaNameFromConst(area: string): Promise<string | null> {
  const c = await readAreaConst();
  if (!c) return null;

  const direct =
    c.offices?.[area]?.name ??
    c.class10s?.[area]?.name ??
    c.class15s?.[area]?.name ??
    c.class20s?.[area]?.name ??
    c.centers?.[area]?.name;
  return direct ?? null;
}

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

function shouldSkipWarningStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.trim();
  if (!s) return false;
  if (/解除/.test(s)) return true;
  if (/発表警報・注意報は?なし/.test(s)) return true;
  if (/発表警報・注意報は?ありません/.test(s)) return true;
  return false;
}

function collectWarningEntries(raw: unknown): any[] {
  const entries: any[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (typeof node !== 'object') return;
    const warnings = (node as any).warnings;
    if (Array.isArray(warnings)) entries.push(...warnings);
    for (const v of Object.values(node)) walk(v);
  };
  walk(raw);
  return entries;
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

function normalizeWarningsFromWebJson(raw: unknown): NormalizedWarningItem[] {
  if (!raw || typeof raw !== 'object') return [];

  const entries = collectWarningEntries(raw);
  const items: NormalizedWarningItem[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const status = typeof (entry as any).status === 'string' ? String((entry as any).status).trim() : null;
    if (shouldSkipWarningStatus(status)) continue;

    const codeRaw = (entry as any).code;
    const code = codeRaw !== undefined && codeRaw !== null ? String(codeRaw).padStart(2, '0') : null;
    const severity = inferWarningSeverity(entry, status, code);
    const hints = collectWarningHints(entry);
    const base = inferWarningBase(code, hints, severity);
    const kind = buildWarningKind(base, severity);

    const basis = JSON.stringify({ kind, status });
    const id = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
    items.push({
      id,
      kind,
      status,
      source: 'webjson',
    });
  }

  if (items.length === 0) {
    const fallback: NormalizedWarningItem[] = [];
    const walk = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
        return;
      }
      if (typeof node !== 'object') return;

      const maybeKind =
        node.kind?.name ??
        node.kindName ??
        node.warningName ??
        node.name ??
        node.title ??
        node.warning;
      const maybeStatus = node.status ?? node.state ?? node.level ?? null;

      if (typeof maybeKind === 'string' && maybeKind.trim() && /警報|注意報|特別警報/.test(maybeKind)) {
        const basis = JSON.stringify({ kind: maybeKind, status: maybeStatus ?? null });
        const id = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
        fallback.push({
          id,
          kind: maybeKind,
          status: typeof maybeStatus === 'string' ? maybeStatus : null,
          source: 'webjson',
        });
      }

      for (const v of Object.values(node)) walk(v);
    };

    walk(raw);
    items.push(...fallback);
  }

  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.kind}|${i.status ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeWarningsFromAtomTitles(titles: string[]): NormalizedWarningItem[] {
  const warningish = titles.filter((t) => /警報|注意報|特別警報/.test(t));
  const limited = warningish.slice(0, 30);
  const unique = Array.from(new Set(limited));
  return unique.map((title) => {
    const id = crypto.createHash('sha256').update(title).digest('hex').slice(0, 16);
    return { id, kind: title, status: null, source: 'pull' };
  });
}

export async function updateNormalizedWarningsArea(area: string): Promise<NormalizedWarningsAreaSnapshot> {
  const state = await readJmaState();
  const areaName = await areaNameFromConst(area);

  const warningJson = await readJsonFile<unknown>(jmaWebJsonWarningPath(area));
  let items: NormalizedWarningItem[] = [];
  if (warningJson) {
    items = normalizeWarningsFromWebJson(warningJson);
  }

  if (items.length === 0) {
    const regularXml = await readTextFile(jmaFeedXmlPath('regular'));
    const extraXml = await readTextFile(jmaFeedXmlPath('extra'));
    const titles = [
      ...(regularXml ? parseAtomFeed(regularXml).entries.map((e) => e.title) : []),
      ...(extraXml ? parseAtomFeed(extraXml).entries.map((e) => e.title) : []),
    ];
    items = normalizeWarningsFromAtomTitles(titles);
  }

  const existing =
    (await readJsonFile<NormalizedWarningsSnapshot>(jmaNormalizedWarningsPath())) ??
    ({ updatedAt: null, areas: {} } satisfies NormalizedWarningsSnapshot);
  const previousArea = existing.areas[area];

  const webUpdatedAt = state.webjson.warningsByArea[area]?.lastSuccessfulUpdateTime ?? null;
  const pullUpdatedAt = maxIso(
    state.feeds.regular.lastSuccessfulUpdateTime,
    state.feeds.extra.lastSuccessfulUpdateTime
  );
  const computedUpdatedAt = warningJson ? webUpdatedAt : pullUpdatedAt;

  const areaSnapshot: NormalizedWarningsAreaSnapshot = {
    updatedAt: computedUpdatedAt ?? previousArea?.updatedAt ?? null,
    area,
    areaName,
    items,
  };

  const next: NormalizedWarningsSnapshot = {
    updatedAt: maxIso(existing.updatedAt, areaSnapshot.updatedAt),
    areas: { ...existing.areas, [area]: areaSnapshot },
  };

  await atomicWriteJson(jmaNormalizedWarningsPath(), next);
  return areaSnapshot;
}

export async function readCachedQuakes(): Promise<NormalizedQuakesSnapshot> {
  return (await readJsonFile<NormalizedQuakesSnapshot>(jmaNormalizedQuakesPath())) ?? { updatedAt: null, items: [] };
}

export async function readCachedWarnings(): Promise<NormalizedWarningsSnapshot> {
  return (
    (await readJsonFile<NormalizedWarningsSnapshot>(jmaNormalizedWarningsPath())) ?? { updatedAt: null, areas: {} }
  );
}

export async function readCachedStatus(): Promise<NormalizedStatusSnapshot | null> {
  return readJsonFile<NormalizedStatusSnapshot>(jmaNormalizedStatusPath());
}

export async function readCachedQuakeListWebJson(): Promise<unknown | null> {
  return readJsonFile<unknown>(jmaWebJsonQuakeListPath());
}
