import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { prisma, Prisma } from '@jp-evac/db';
import { hazardKeys, HazardKey } from '@jp-evac/shared';
import crypto from 'crypto';
import { z } from 'zod';

const hazardColumnCandidates: Record<HazardKey, string[]> = {
  flood: ['flood', '洪水', '洪水浸水想定', '想定浸水深'],
  landslide: ['landslide', '土砂災害'],
  storm_surge: ['storm_surge', '高潮'],
  earthquake: ['earthquake', '地震'],
  tsunami: ['tsunami', '津波'],
  large_fire: ['large_fire', '大規模火災'],
  inland_flood: ['inland_flood', '内水氾濫'],
  volcano: ['volcano', '火山'],
};

const baseDir = path.resolve(__dirname, '../../../data');
const evacSpaceFile = path.join(baseDir, 'evacuation_space_all.csv');
const evacShelterFile = path.join(baseDir, 'evacuation_shelter_all.csv');

function normalizeBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', '○', '◯', 'あり', '有', '〇'].includes(normalized);
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildStableKey(name?: string, address?: string, lat?: number, lon?: number): string {
  const raw = `${name ?? ''}|${address ?? ''}|${lat ?? ''}|${lon ?? ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return new Promise((resolve, reject) => {
    parse(
      content,
      {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      },
      (err, records: Record<string, string>[]) => {
        if (err) return reject(err);
        resolve(records);
      }
    );
  });
}

function mapHazards(record: Record<string, string>): Record<HazardKey, boolean> {
  const hazards: Record<HazardKey, boolean> = {
    flood: false,
    landslide: false,
    storm_surge: false,
    earthquake: false,
    tsunami: false,
    large_fire: false,
    inland_flood: false,
    volcano: false,
  };

  for (const key of hazardKeys) {
    const candidates = hazardColumnCandidates[key];
    const column = Object.keys(record).find((k) =>
      candidates.some((candidate) => k.toLowerCase().includes(candidate.toLowerCase()))
    );
    if (column) {
      hazards[key] = normalizeBoolean(record[column]);
    }
  }

  return hazards;
}

const spaceSchema = z.object({
  common_id: z.string().optional(),
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.preprocess((val) => (val === '' || val === undefined ? undefined : Number(val)), z.number()),
  lon: z.preprocess((val) => (val === '' || val === undefined ? undefined : Number(val)), z.number()),
  pref_city: z.string().optional(),
  is_same_address_as_shelter: z.any().optional(),
  notes: z.string().optional(),
  source_updated_at: z.string().optional(),
});

const municipalitiesFile = path.join(baseDir, 'generated', 'municipalities.json');

async function loadMunicipalitiesMap() {
  try {
    const content = await fs.promises.readFile(municipalitiesFile, 'utf-8');
    const json = JSON.parse(content) as Array<{ prefCode: string; prefName: string; muniCode: string; muniName: string }>;
    const map = new Map<string, { prefCode: string; muniCode: string }>();
    for (const item of json) {
      if (!item.prefName || !item.muniName) continue;
      const key = `${item.prefName}${item.muniName}`;
      map.set(key, { prefCode: item.prefCode, muniCode: item.muniCode.slice(0, 5) }); // ensure 5 digit
    }
    return map;
  } catch (e) {
    console.warn('Failed to load municipalities.json', e);
    return new Map();
  }
}

async function importData() {
  const [spaceRows, shelterRows, muniMap] = await Promise.all([
    readCsv(evacSpaceFile),
    readCsv(evacShelterFile),
    loadMunicipalitiesMap(),
  ]);

  const sheltersByCommonId: Record<string, Record<string, string>> = {};
  for (const row of shelterRows) {
    const id = row['共通ID'] || row['common_id'] || row['id'];
    if (id) sheltersByCommonId[id] = row;
  }

  let upserted = 0;
  for (const row of spaceRows) {
    const mapped = {
      common_id: row['共通ID'] || row['common_id'],
      name: row['施設・場所名称'] || row['name'] || '不明',
      address: row['住所'] || row['address'],
      lat: Number(row['緯度'] || row['lat'] || row['latitude']),
      lon: Number(row['経度'] || row['lon'] || row['longitude']),
      pref_city: row['都道府県市区町村'] || row['pref_city'],
      is_same_address_as_shelter: row['避難所と同住所'] || row['is_same_address_as_shelter'],
      notes: row['備考'] || row['notes'],
      source_updated_at: row['更新日'] || row['source_updated_at'],
    } satisfies Record<string, unknown>;

    const parsed = spaceSchema.safeParse(mapped);
    if (!parsed.success) {
      console.warn('Skip row because of validation', parsed.error.issues, mapped);
      continue;
    }

    const hazards = mapHazards(row);
    const shelter_fields = mapped.common_id ? sheltersByCommonId[mapped.common_id] : undefined;
    const existing = mapped.common_id
      ? await prisma.evac_sites.findUnique({ where: { common_id: mapped.common_id } })
      : await prisma.evac_sites.findFirst({
        where: {
          name: parsed.data.name,
          address: parsed.data.address,
        },
      });

    let pref_code = null;
    let muni_code = null;
    if (parsed.data.pref_city) {
      // Direct lookup
      const hit = muniMap.get(parsed.data.pref_city);
      if (hit) {
        pref_code = hit.prefCode;
        muni_code = hit.muniCode;
      } else {
        // Try fallback if pref_city has extra chars?
        // E.g. "東京都板橋区..." -> startswith check is too expensive for map.
        // But maybe we iterate keys? No.
        // Just rely on exact match for now as typical data matches.
      }
    }

    const data = {
      common_id: parsed.data.common_id,
      name: parsed.data.name,
      address: parsed.data.address,
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      pref_city: parsed.data.pref_city,
      is_same_address_as_shelter: !!parsed.data.is_same_address_as_shelter,
      hazards,
      notes: parsed.data.notes,
      shelter_fields: shelter_fields ?? Prisma.DbNull,
      source_updated_at: parseDate(parsed.data.source_updated_at),
      pref_code,
      muni_code,
    };

    if (existing) {
      await prisma.evac_sites.update({ where: { id: existing.id }, data });
    } else {
      const stableKey = buildStableKey(parsed.data.name, parsed.data.address, parsed.data.lat, parsed.data.lon);
      await prisma.evac_sites.create({
        data: {
          ...data,
          common_id: data.common_id ?? stableKey,
        },
      });
    }
    upserted += 1;
  }

  console.log(`Upserted ${upserted} evacuation sites.`);
}

export async function runImport() {
  await importData();
}

if (require.main === module) {
  runImport()
    .then(() => {
      console.log('Import finished.');
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
