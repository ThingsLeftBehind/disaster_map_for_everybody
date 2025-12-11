import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@jp-evac/db';
import { hazardKeys, HazardKey, hazardDefaults } from '@jp-evac/shared';

const baseFieldMap: Record<string, string[]> = {
  name: ['名称', '施設・場所名称', 'name', '施設名'],
  address: ['住所', '所在地', 'address'],
  latitude: ['緯度', 'lat', 'latitude'],
  longitude: ['経度', 'lon', 'lng', 'longitude'],
  municipality_code: ['市区町村コード', 'municipality_code', '行政コード'],
  capacity: ['収容人数', 'capacity'],
  is_designated: ['指定避難', '指定状況', 'designated'],
  source_id: ['共通ID', 'id', 'official_id'],
  source_url: ['URL', '参照URL', 'source_url']
};

const hazardColumnCandidates: Record<HazardKey, string[]> = {
  earthquake: ['earthquake', '地震', '耐震'],
  tsunami: ['tsunami', '津波'],
  flood: ['flood', '洪水', '洪水浸水想定'],
  inland_flood: ['inland_flood', '内水', '内水氾濫'],
  typhoon: ['typhoon', '台風', '風水害'],
  landslide: ['landslide', '土砂災害'],
  fire: ['fire', '火災', '大規模火災'],
  volcano: ['volcano', '火山'],
  storm_surge: ['storm_surge', '高潮']
};

const siteSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  municipality_code: z.string().optional(),
  capacity: z.number().int().optional(),
  is_designated: z.boolean().default(true),
  source_id: z.string().optional(),
  source_url: z.string().optional()
});

type NormalizedRecord = Record<string, string>;

type DatasetConfig = {
  filePath: string;
  kind: 'space' | 'shelter';
  sourceName: string;
};

function normalizeHeader(key: string) {
  return key
    .replace(/\u3000/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[・\s\-]+/g, '_');
}

function normalizeRecord(record: Record<string, string>): NormalizedRecord {
  const entries = Object.entries(record).map(([key, value]) => [normalizeHeader(key), value]);
  return Object.fromEntries(entries);
}

function getField(record: NormalizedRecord, aliases: string[]) {
  for (const alias of aliases) {
    const normalized = normalizeHeader(alias);
    if (record[normalized] !== undefined) return record[normalized];
  }
  return undefined;
}

function asNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asBoolean(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'はい', '可', '〇', '○', '◯', 'あり', '有'].includes(normalized);
}

function stableKey(parts: (string | number | undefined)[], namespace: string) {
  const raw = `${namespace}|${parts.map((p) => String(p ?? '')).join('|')}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function readCsv(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  const content = buffer.toString('utf8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true
  }) as Record<string, string>[];
}

function summarizeSkip(reasons: Record<string, number>) {
  return Object.entries(reasons)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ');
}

function hazardFromRecord(record: NormalizedRecord) {
  return hazardKeys.reduce((acc, key) => {
    const value = getField(record, hazardColumnCandidates[key]);
    acc[key] = asBoolean(value);
    return acc;
  }, { ...hazardDefaults });
}

async function upsertHazards(siteId: string, hazards: Record<HazardKey, boolean>) {
  let count = 0;
  for (const [key, enabled] of Object.entries(hazards)) {
    const hazardType = key as HazardKey;
    await prisma.evacSiteHazardCapability.upsert({
      where: { siteId_hazardType: { siteId, hazardType } },
      update: { isSupported: enabled },
      create: { siteId, hazardType, isSupported: enabled }
    });
    count += 1;
  }
  return count;
}

async function importDataset(config: DatasetConfig) {
  const exists = fs.existsSync(config.filePath);
  const stat = exists ? fs.statSync(config.filePath) : undefined;
  console.log('Dataset', { path: path.resolve(config.filePath), exists, size: stat?.size ?? 0 });
  if (!exists) {
    throw new Error(`CSV not found at ${config.filePath}`);
  }

  const records = readCsv(config.filePath).map(normalizeRecord);
  const headers = records[0] ? Object.keys(records[0]) : [];
  console.log('Header', headers);

  const skipReasons: Record<string, number> = {};
  let parsedRows = 0;
  let upsertedSites = 0;
  let hazardRows = 0;

  for (const record of records) {
    parsedRows += 1;
    const lat = asNumber(getField(record, baseFieldMap.latitude));
    const lon = asNumber(getField(record, baseFieldMap.longitude));
    const name = getField(record, baseFieldMap.name);
    if (!lat || !lon) {
      skipReasons.missing_lat_lng = (skipReasons.missing_lat_lng ?? 0) + 1;
      continue;
    }
    if (!name) {
      skipReasons.missing_name = (skipReasons.missing_name ?? 0) + 1;
      continue;
    }

    const mapped = {
      name,
      address: getField(record, baseFieldMap.address),
      latitude: lat,
      longitude: lon,
      municipality_code: getField(record, baseFieldMap.municipality_code),
      capacity: asNumber(getField(record, baseFieldMap.capacity)),
      is_designated: asBoolean(getField(record, baseFieldMap.is_designated)),
      source_id: getField(record, baseFieldMap.source_id),
      source_url: getField(record, baseFieldMap.source_url)
    };

    const parsed = siteSchema.safeParse(mapped);
    if (!parsed.success) {
      skipReasons.validation_failed = (skipReasons.validation_failed ?? 0) + 1;
      continue;
    }

    const hazards = hazardFromRecord(record);
    const stableId = parsed.data.source_id
      ? `${config.sourceName}:${parsed.data.source_id}`
      : stableKey([parsed.data.name, parsed.data.address, parsed.data.latitude, parsed.data.longitude], config.sourceName);

    const site = await prisma.evacSite.upsert({
      where: { sourceId: stableId },
      update: {
        name: parsed.data.name,
        address: parsed.data.address,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        municipalityCode: parsed.data.municipality_code,
        capacity: parsed.data.capacity,
        isDesignated: parsed.data.is_designated,
        sourceName: config.sourceName,
        sourceUrl: parsed.data.source_url,
        kind: config.kind
      },
      create: {
        sourceId: stableId,
        name: parsed.data.name,
        address: parsed.data.address,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        municipalityCode: parsed.data.municipality_code,
        capacity: parsed.data.capacity,
        isDesignated: parsed.data.is_designated,
        sourceName: config.sourceName,
        sourceUrl: parsed.data.source_url,
        kind: config.kind
      }
    });
    upsertedSites += 1;
    hazardRows += await upsertHazards(site.id, hazards);
  }

  console.log(
    `${config.sourceName}: rows=${parsedRows}, sites_upserted=${upsertedSites}, hazards_upserted=${hazardRows}, skipped=${summarizeSkip(skipReasons)}`
  );
}

function findRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (current !== path.parse(current).root) {
    const pkgPath = path.join(current, 'package.json');
    const dataPath = path.join(current, 'data');
    if (fs.existsSync(pkgPath) && fs.existsSync(dataPath)) return current;
    current = path.dirname(current);
  }
  throw new Error('Repository root not found');
}

export async function runImport({
  evacSpaceFile,
  evacShelterFile
}: {
  evacSpaceFile?: string;
  evacShelterFile?: string;
} = {}) {
  const root = findRepoRoot();
  const dataDir = path.join(root, 'data');
  const spacePath = evacSpaceFile ?? path.join(dataDir, 'evacuation_space_all.csv');
  const shelterPath = evacShelterFile ?? path.join(dataDir, 'evacuation_shelter_all.csv');

  await importDataset({ filePath: spacePath, kind: 'space', sourceName: 'evacuation_space_all' });
  await importDataset({ filePath: shelterPath, kind: 'shelter', sourceName: 'evacuation_shelter_all' });
}

if (require.main === module) {
  runImport()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
