#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs/promises');
const path = require('node:path');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (e) {
    fail(`Missing file: ${filePath}`);
  }
}

function safeJsonParse(text, label) {
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`${label} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function analyzeMunicipalities(json) {
  assert(Array.isArray(json), 'data/generated/municipalities.json must be a JSON array');
  assert(json.length >= 1500, `municipalities.json must have >= 1500 records, got ${json.length}`);

  const prefCodes = new Set();
  const muniCodes = new Set();
  let duplicateMuniCode = 0;

  for (const r of json) {
    assert(isPlainObject(r), 'municipality record must be an object');
    assert(typeof r.prefCode === 'string' && /^\d{2}$/.test(r.prefCode), `Invalid prefCode: ${r.prefCode}`);
    assert(typeof r.prefName === 'string' && r.prefName.trim().length > 0, `Invalid prefName for muniCode ${r.muniCode}`);
    assert(typeof r.muniCode === 'string' && /^\d{5,6}$/.test(r.muniCode), `Invalid muniCode: ${r.muniCode}`);
    assert(typeof r.muniName === 'string' && r.muniName.trim().length > 0, `Invalid muniName for muniCode ${r.muniCode}`);

    prefCodes.add(r.prefCode);
    if (muniCodes.has(r.muniCode)) duplicateMuniCode++;
    muniCodes.add(r.muniCode);
  }

  assert(prefCodes.size >= 47, `municipalities.json must cover >= 47 prefectures, got ${prefCodes.size}`);
  assert(duplicateMuniCode === 0, `municipalities.json must not have duplicate muniCode, got ${duplicateMuniCode}`);

  return { recordCount: json.length, distinctPref: prefCodes.size, duplicateMuniCode };
}

function analyzeJmaAreaConst(json) {
  assert(isPlainObject(json), 'data/ref/jma/const/area.json must be a JSON object');
  const required = ['centers', 'offices', 'class10s', 'class15s', 'class20s'];
  for (const key of required) {
    assert(key in json, `area.json is missing required key: ${key}`);
    assert(isPlainObject(json[key]), `area.json key "${key}" must be an object`);
    assert(Object.keys(json[key]).length > 0, `area.json key "${key}" must be non-empty`);
  }
  return {
    centers: Object.keys(json.centers).length,
    offices: Object.keys(json.offices).length,
    class10s: Object.keys(json.class10s).length,
    class15s: Object.keys(json.class15s).length,
    class20s: Object.keys(json.class20s).length,
  };
}

function analyzeGsiMuniJs(text) {
  const trimmed = text.trim();
  assert(trimmed.length > 200, `data/ref/gsi/muni.js looks too small (${trimmed.length} chars)`);

  const placeholderMarkers = [/PLACEHOLDER/i, /REPLACE_ME/i, /TODO/i, /stub/i];
  for (const re of placeholderMarkers) {
    assert(!re.test(trimmed), `data/ref/gsi/muni.js contains placeholder marker: ${re}`);
  }

  const hasCodes = /\b\d{5,6}\b/.test(trimmed);
  assert(hasCodes, 'data/ref/gsi/muni.js does not appear to contain municipality codes');

  return { chars: trimmed.length };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');

  const muniPath = path.join(repoRoot, 'data', 'generated', 'municipalities.json');
  const areaPath = path.join(repoRoot, 'data', 'ref', 'jma', 'const', 'area.json');
  const gsiMuniPath = path.join(repoRoot, 'data', 'ref', 'gsi', 'muni.js');

  const muniStat = await fs.stat(muniPath).catch(() => null);
  assert(muniStat && muniStat.isFile(), 'data/generated/municipalities.json is missing');
  assert(muniStat.size > 50 * 1024, `municipalities.json must be > 50KB, got ${muniStat.size} bytes`);

  const municipalities = safeJsonParse(await readText(muniPath), 'municipalities.json');
  const muniMetrics = analyzeMunicipalities(municipalities);

  const areaConst = safeJsonParse(await readText(areaPath), 'area.json');
  const areaMetrics = analyzeJmaAreaConst(areaConst);

  const gsiText = await readText(gsiMuniPath);
  const gsiMetrics = analyzeGsiMuniJs(gsiText);

  console.log('OK: data validation passed');
  console.log(
    JSON.stringify(
      {
        municipalities: { bytes: muniStat.size, ...muniMetrics },
        jmaAreaConst: areaMetrics,
        gsiMuniJs: gsiMetrics,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});

