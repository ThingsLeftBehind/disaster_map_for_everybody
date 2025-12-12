import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@jp-evac/db';
import { hazardKeys, HazardKey, hazardDefaults } from '@jp-evac/shared';

const baseFieldMap: Record<string, string[]> = {
  name: ['名称', '施設・場所名称', '施設_場所名', 'name', '施設名'],
  address: ['住所', '所在地', 'address'],
  latitude: ['緯度', 'lat', 'latitude'],
  longitude: ['経度', 'lon', 'lng', 'longitude'],
  municipality_code: ['市区町村コード', 'municipality_code', '行政コード'],
  capacity: ['収容人数', 'capacity'],
  is_designated: ['指定避難', '指定状況', 'designated'],
  source_id: ['共通ID', '共通id', 'id', 'official_id'],
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
  // 여기서는 "도도부현 코드" (예: '01000') 를 넣는다.
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

  const normalizedHeaders = headers.map((h) => normalizeHeader(h));
  const hasHazardColumns = hazardKeys.some((key) =>
    hazardColumnCandidates[key].some((alias) =>
      normalizedHeaders.includes(normalizeHeader(alias))
    )
  );
  console.log('Has hazard columns:', hasHazardColumns);

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

    // 共通ID 기준 + 도도부현 코드(namespace) 로 하나의 레코드에 합치기
    const namespace = config.sourceName; // 예: '01000'
    const stableId = parsed.data.source_id
      ? `${namespace}:${parsed.data.source_id}`
      : stableKey(
          [parsed.data.name, parsed.data.address, parsed.data.latitude, parsed.data.longitude],
          namespace
        );

    const hazards = hasHazardColumns ? hazardFromRecord(record) : null;

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
        kind: config.kind,
        isActive: true
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
        kind: config.kind,
        isActive: true
      }
    });
    upsertedSites += 1;

    if (hazards) {
      hazardRows += await upsertHazards(site.id, hazards);
    }
  }

  console.log(
    `${config.sourceName}/${config.kind}: rows=${parsedRows}, sites_upserted=${upsertedSites}, hazards_upserted=${hazardRows}, skipped=${summarizeSkip(
      skipReasons
    )}`
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
  const progressPath = path.join(dataDir, '.import-progress.json');

  let completed: string[] = [];
  if (fs.existsSync(progressPath)) {
    try {
      const raw = fs.readFileSync(progressPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.completed)) {
        completed = parsed.completed;
      }
    } catch (e) {
      console.error('Failed to read import progress, starting fresh:', e);
    }
  }

  const saveProgress = () => {
    const payload = { completed };
    fs.writeFileSync(progressPath, JSON.stringify(payload, null, 2), 'utf8');
  };

  const allFiles = fs.readdirSync(dataDir);

  // 도도부현 코드별로 _1(避難所) / _2(緊急避難場所) 매핑
  const byPref: Record<string, { shelter?: string; space?: string }> = {};

  for (const file of allFiles) {
    const m = file.match(/^(\d{5})_(1|2)\.csv$/);
    if (!m) continue;
    const pref = m[1];
    const kindFlag = m[2]; // '1' or '2'

    if (!byPref[pref]) byPref[pref] = {};

    if (kindFlag === '1') {
      // 指定避難所
      byPref[pref].shelter = file;
    } else {
      // 指定緊急避難場所（洪水/津波/地震 등 하자드 컬럼 포함）
      byPref[pref].space = file;
    }
  }

  const prefs = Object.keys(byPref).sort();

  if (prefs.length > 0) {
    console.log(`Found ${prefs.length} prefectures with per-prefecture CSVs. Importing all of them...`);

    for (const pref of prefs) {
      const key = `pref:${pref}`;
      if (completed.includes(key)) {
        console.log(`Skip prefecture (already completed): ${pref}`);
        continue;
      }

      // === 2-A: 이 도도부현의 기존 레코드는 일단 전부 isActive = false 로 만든 뒤,
      // 이번 CSV에 등장하는 것만 다시 true 로 살린다.
      await prisma.evacSite.updateMany({
        where: { sourceName: pref },
        data: { isActive: false }
      });

      const entry = byPref[pref];

      if (entry.shelter) {
        const filePath = path.join(dataDir, entry.shelter);
        await importDataset({
          filePath,
          kind: 'shelter',
          sourceName: pref
        });
      }

      if (entry.space) {
        const filePath = path.join(dataDir, entry.space);
        await importDataset({
          filePath,
          kind: 'space',
          sourceName: pref
        });
      }

      completed.push(key);
      saveProgress();
    }

    console.log('All per-prefecture files processed.');
    return;
  }

  // 도도부현 파일이 전혀 없으면 예전처럼 전국 파일 2개로 fallback
  const spacePath = evacSpaceFile ?? path.join(dataDir, 'evacuation_space_all.csv');
  const shelterPath = evacShelterFile ?? path.join(dataDir, 'evacuation_shelter_all.csv');

  await prisma.evacSite.updateMany({
    where: { sourceName: 'nationwide_space' },
    data: { isActive: false }
  });
  await importDataset({ filePath: spacePath, kind: 'space', sourceName: 'nationwide_space' });

  await prisma.evacSite.updateMany({
    where: { sourceName: 'nationwide_shelter' },
    data: { isActive: false }
  });
  await importDataset({ filePath: shelterPath, kind: 'shelter', sourceName: 'nationwide_shelter' });
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
