import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { prisma } from '@jp-evac/db';
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

const defaultBaseDir = path.resolve(process.cwd(), 'data');
const defaultEvacSpaceFile = path.resolve(defaultBaseDir, 'evacuation_space_all.csv');
const defaultEvacShelterFile = path.resolve(defaultBaseDir, 'evacuation_shelter_all.csv');

type FieldAccessor = (candidates: string[]) => string | undefined;

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[_\-\s]/g, '')
    .replace(/[（）()]/g, '');
}

function createFieldAccessor(record: Record<string, string>): FieldAccessor {
  const normalizedKeys = new Map<string, string>();
  for (const key of Object.keys(record)) {
    normalizedKeys.set(normalizeKey(key), key);
  }

  return (candidates: string[]) => {
    for (const candidate of candidates) {
      const normalized = normalizeKey(candidate);
      const originalKey = normalizedKeys.get(normalized);
      if (originalKey) return record[originalKey];
    }
    return undefined;
  };
}

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

function mapHazards(record: Record<string, string>, getField: FieldAccessor): Record<HazardKey, boolean> {
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
    const value = getField(hazardColumnCandidates[key]);
    hazards[key] = normalizeBoolean(value);
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

async function importData({
  evacSpaceFile = defaultEvacSpaceFile,
  evacShelterFile = defaultEvacShelterFile,
}: {
  evacSpaceFile?: string;
  evacShelterFile?: string;
} = {}) {
  console.log('Resolved CSV paths:', { evacSpaceFile, evacShelterFile });

  const [spaceRows, shelterRows] = await Promise.all([
    readCsv(evacSpaceFile),
    readCsv(evacShelterFile),
  ]);

  console.log(`Loaded ${spaceRows.length} rows from ${evacSpaceFile}`);
  console.log(`Loaded ${shelterRows.length} rows from ${evacShelterFile}`);

  const sheltersByCommonId: Record<string, Record<string, string>> = {};
  for (const row of shelterRows) {
    const getField = createFieldAccessor(row);
    const id = getField(['共通ID', 'common_id', 'id']);
    if (id) sheltersByCommonId[id] = row;
  }

  let upserted = 0;
  for (const row of spaceRows) {
    const getField = createFieldAccessor(row);
    const mapped = {
      common_id: getField(['共通ID', 'common_id']),
      name: getField(['施設・場所名称', 'name']) || '不明',
      address: getField(['住所', 'address']),
      lat: Number(getField(['緯度', 'lat', 'latitude'])),
      lon: Number(getField(['経度', 'lon', 'longitude'])),
      pref_city: getField(['都道府県市区町村', 'pref_city']),
      is_same_address_as_shelter: getField(['避難所と同住所', 'is_same_address_as_shelter']),
      notes: getField(['備考', 'notes']),
      source_updated_at: getField(['更新日', 'source_updated_at']),
    } satisfies Record<string, unknown>;

    const parsed = spaceSchema.safeParse(mapped);
    if (!parsed.success) {
      console.warn('Skip row because of validation', parsed.error.issues, mapped);
      continue;
    }

    const hazards = mapHazards(row, getField);
    const shelter_fields = mapped.common_id ? sheltersByCommonId[mapped.common_id] : undefined;
    const existing = mapped.common_id
      ? await prisma.evac_sites.findUnique({ where: { common_id: mapped.common_id } })
      : await prisma.evac_sites.findFirst({
          where: {
            name: parsed.data.name,
            address: parsed.data.address,
          },
        });

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
      shelter_fields: shelter_fields ?? null,
      source_updated_at: parseDate(parsed.data.source_updated_at),
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

export async function runImport(options?: {
  evacSpaceFile?: string;
  evacShelterFile?: string;
}) {
  await importData(options);
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
