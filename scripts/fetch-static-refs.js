#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs/promises');
const path = require('node:path');

const JMA_AREA_URL = 'https://www.jma.go.jp/bosai/common/const/area.json';
const GSI_MUNI_URL = 'https://maps.gsi.go.jp/js/muni.js';

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function atomicWriteFile(filePath, contents) {
  await ensureDir(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(
    dir,
    `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await fs.writeFile(tmpPath, contents);
  await fs.rename(tmpPath, filePath);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'jp-evac/scripts (fetch-static-refs)',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Fetch failed: ${url} (${res.status}) ${body.slice(0, 300)}`);
  }
  return await res.text();
}

function assertNonEmptyString(label, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is empty/invalid`);
  }
}

function assertNonEmptyJson(label, jsonValue) {
  if (jsonValue == null || typeof jsonValue !== 'object') {
    throw new Error(`${label} is not an object`);
  }
  if (Array.isArray(jsonValue) && jsonValue.length === 0) {
    throw new Error(`${label} is an empty array`);
  }
  if (!Array.isArray(jsonValue) && Object.keys(jsonValue).length === 0) {
    throw new Error(`${label} is an empty object`);
  }
}

function assertHasJmaAreaKeys(areaJson) {
  const required = ['centers', 'offices', 'class10s', 'class15s', 'class20s'];
  for (const key of required) {
    if (!areaJson || typeof areaJson !== 'object' || Array.isArray(areaJson)) {
      throw new Error('JMA area.json is not an object');
    }
    if (!(key in areaJson)) throw new Error(`JMA area.json missing key: ${key}`);
    const v = areaJson[key];
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length === 0) {
      throw new Error(`JMA area.json key "${key}" is empty/invalid`);
    }
  }
}

function assertLooksLikeMuniJs(muniJs) {
  const trimmed = String(muniJs ?? '').trim();
  assertNonEmptyString('GSI muni.js response', trimmed);
  if (trimmed.length < 200) throw new Error('GSI muni.js response is too small');
  if (/PLACEHOLDER|REPLACE_ME|TODO|stub/i.test(trimmed)) throw new Error('GSI muni.js contains placeholder marker');
  if (!/\b\d{5,6}\b/.test(trimmed)) throw new Error('GSI muni.js does not appear to contain municipality codes');
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');

  const areaJsonPath = path.join(repoRoot, 'data/ref/jma/const/area.json');
  const muniJsPath = path.join(repoRoot, 'data/ref/gsi/muni.js');

  console.log(`Fetching JMA area JSON: ${JMA_AREA_URL}`);
  const areaText = await fetchText(JMA_AREA_URL);
  assertNonEmptyString('JMA area.json response', areaText);
  let areaJson;
  try {
    areaJson = JSON.parse(areaText);
  } catch (err) {
    throw new Error(`JMA area.json is not valid JSON: ${String(err)}`);
  }
  assertNonEmptyJson('JMA area.json', areaJson);
  assertHasJmaAreaKeys(areaJson);
  await atomicWriteFile(areaJsonPath, `${JSON.stringify(areaJson, null, 2)}\n`);
  console.log(`Wrote: ${path.relative(repoRoot, areaJsonPath)}`);

  console.log(`Fetching GSI muni.js: ${GSI_MUNI_URL}`);
  const muniJs = await fetchText(GSI_MUNI_URL);
  assertLooksLikeMuniJs(muniJs);
  await atomicWriteFile(muniJsPath, `${muniJs.trimEnd()}\n`);
  console.log(`Wrote: ${path.relative(repoRoot, muniJsPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
