#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function tryRequireXlsx() {
  try {
    // Optional dependency. If installed, supports both .xls and .xlsx robustly.
    // eslint-disable-next-line global-require
    return require('xlsx');
  } catch {
    return null;
  }
}

const PREF_BY_CODE = {
  '01': '北海道',
  '02': '青森県',
  '03': '岩手県',
  '04': '宮城県',
  '05': '秋田県',
  '06': '山形県',
  '07': '福島県',
  '08': '茨城県',
  '09': '栃木県',
  '10': '群馬県',
  '11': '埼玉県',
  '12': '千葉県',
  '13': '東京都',
  '14': '神奈川県',
  '15': '新潟県',
  '16': '富山県',
  '17': '石川県',
  '18': '福井県',
  '19': '山梨県',
  '20': '長野県',
  '21': '岐阜県',
  '22': '静岡県',
  '23': '愛知県',
  '24': '三重県',
  '25': '滋賀県',
  '26': '京都府',
  '27': '大阪府',
  '28': '兵庫県',
  '29': '奈良県',
  '30': '和歌山県',
  '31': '鳥取県',
  '32': '島根県',
  '33': '岡山県',
  '34': '広島県',
  '35': '山口県',
  '36': '徳島県',
  '37': '香川県',
  '38': '愛媛県',
  '39': '高知県',
  '40': '福岡県',
  '41': '佐賀県',
  '42': '長崎県',
  '43': '熊本県',
  '44': '大分県',
  '45': '宮崎県',
  '46': '鹿児島県',
  '47': '沖縄県',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

function decodeXmlEntities(input) {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function colLettersToIndex(letters) {
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

async function unzipList(xlsxPath) {
  const { stdout } = await execFileAsync('unzip', ['-Z1', xlsxPath], { maxBuffer: 50 * 1024 * 1024 });
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function unzipRead(xlsxPath, entryPath) {
  const { stdout } = await execFileAsync('unzip', ['-p', xlsxPath, entryPath], { maxBuffer: 50 * 1024 * 1024 });
  return stdout;
}

function parseSharedStrings(xml) {
  const shared = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch;
  while ((siMatch = siRe.exec(xml)) !== null) {
    const si = siMatch[1];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let text = '';
    let tMatch;
    while ((tMatch = tRe.exec(si)) !== null) {
      text += decodeXmlEntities(tMatch[1]);
    }
    shared.push(text);
  }
  return shared;
}

function parseWorksheetRows(sheetXml, sharedStrings) {
  const rowMap = new Map();
  let maxCol = 0;

  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    const rowAttrs = rowMatch[1];
    const rowContent = rowMatch[2];
    const rMatch = /\br="(\d+)"/.exec(rowAttrs);
    const rowNum = rMatch ? Number(rMatch[1]) : null;
    if (!rowNum) continue;

    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowContent)) !== null) {
      const cellAttrs = cellMatch[1];
      const cellContent = cellMatch[2];

      const refMatch = /\br="([A-Z]+)(\d+)"/.exec(cellAttrs);
      if (!refMatch) continue;
      const col = colLettersToIndex(refMatch[1]);
      maxCol = Math.max(maxCol, col);

      const tMatch = /\bt="([^"]+)"/.exec(cellAttrs);
      const cellType = tMatch ? tMatch[1] : null;

      let value = '';
      if (cellType === 's') {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellContent);
        const index = vMatch ? Number(vMatch[1]) : NaN;
        value = Number.isFinite(index) && sharedStrings[index] != null ? sharedStrings[index] : '';
      } else if (cellType === 'inlineStr') {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tText = '';
        let m;
        while ((m = tRe.exec(cellContent)) !== null) tText += decodeXmlEntities(m[1]);
        value = tText;
      } else {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellContent);
        value = vMatch ? decodeXmlEntities(vMatch[1]) : '';
      }

      if (!rowMap.has(rowNum)) rowMap.set(rowNum, new Map());
      rowMap.get(rowNum).set(col, value);
    }
  }

  const rowNums = Array.from(rowMap.keys()).sort((a, b) => a - b);
  return rowNums.map((rowNum) => {
    const colMap = rowMap.get(rowNum);
    const row = Array(maxCol + 1).fill('');
    for (const [col, value] of colMap.entries()) row[col] = value;
    return row;
  });
}

function normalizeHeader(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[‐‑‒–—―]/g, '-');
}

function pickHeaderRowIndex(rows) {
  const keywords = ['都道府県', '市区町村', '市町村', '団体', '自治体', 'コード', '名称', '名'];
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const rowText = rows[i].join(' ');
    let score = 0;
    for (const kw of keywords) if (rowText.includes(kw)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function findColumnByHeader(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  for (const cand of candidates) {
    const idx = normalized.findIndex((h) => h.includes(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

function inferMunicipalityColumns(rows, headerRowIndex) {
  const headers = rows[headerRowIndex] ?? [];

  const muniCodeCol =
    findColumnByHeader(headers, [
      '全国地方公共団体コード',
      '地方公共団体コード',
      '団体コード',
      '市区町村コード',
      '市町村コード',
      '自治体コード',
      'コード',
    ]) ?? -1;

  const muniNameCol =
    findColumnByHeader(headers, ['市区町村名', '市町村名', '団体名', '自治体名', '名称', '名']) ?? -1;

  const preferred = { muniCodeCol, muniNameCol };
  if (preferred.muniCodeCol !== -1 && preferred.muniNameCol !== -1) return preferred;

  // Fallback heuristic: pick columns by content patterns.
  const start = headerRowIndex + 1;
  const sample = rows.slice(start, Math.min(rows.length, start + 3000));
  const colCount = Math.max(...sample.map((r) => r.length), 0);

  let bestCodeCol = -1;
  let bestCodeDistinct = -1;
  for (let col = 0; col < colCount; col++) {
    const codes = new Set();
    let codeLikeCount = 0;
    for (const row of sample) {
      const raw = String(row[col] ?? '').trim();
      if (!raw) continue;
      const digits = raw.replace(/\D/g, '');
      if (!/^\d{3,6}$/.test(digits)) continue;
      codeLikeCount++;
      codes.add(digits);
    }
    if (codeLikeCount < 1000) continue;
    if (codes.size > bestCodeDistinct) {
      bestCodeDistinct = codes.size;
      bestCodeCol = col;
    }
  }

  let bestNameCol = -1;
  let bestNameCount = -1;
  for (let col = 0; col < colCount; col++) {
    if (col === bestCodeCol) continue;
    let nameCount = 0;
    for (const row of sample) {
      const raw = String(row[col] ?? '').trim();
      if (!raw) continue;
      if (/^\d+$/.test(raw)) continue;
      if (/[一-龯ぁ-ゟ゠-ヿ]/.test(raw)) nameCount++;
    }
    if (nameCount > bestNameCount) {
      bestNameCount = nameCount;
      bestNameCol = col;
    }
  }

  return {
    muniCodeCol: preferred.muniCodeCol !== -1 ? preferred.muniCodeCol : bestCodeCol,
    muniNameCol: preferred.muniNameCol !== -1 ? preferred.muniNameCol : bestNameCol,
  };
}

function buildMunicipalitiesFromTable(rows) {
  const headerRowIndex = pickHeaderRowIndex(rows);
  const { muniCodeCol, muniNameCol } = inferMunicipalityColumns(rows, headerRowIndex);

  assert(muniCodeCol !== -1, 'Could not locate municipality code column');
  assert(muniNameCol !== -1, 'Could not locate municipality name column');

  const dataRows = rows.slice(headerRowIndex + 1);

  // Determine target code length (5 vs 6) from observed max digits length.
  let maxLen = 0;
  for (const row of dataRows) {
    const digits = String(row[muniCodeCol] ?? '')
      .trim()
      .replace(/\D/g, '');
    if (/^\d+$/.test(digits)) maxLen = Math.max(maxLen, digits.length);
  }
  const targetLen = maxLen >= 6 ? 6 : 5;

  const seen = new Set();
  const out = [];

  for (const row of dataRows) {
    const rawCode = String(row[muniCodeCol] ?? '').trim();
    const rawName = String(row[muniNameCol] ?? '').trim();
    if (!rawCode || !rawName) continue;

    let code = rawCode.replace(/\D/g, '');
    if (!/^\d+$/.test(code)) continue;
    if (code.length < targetLen) code = code.padStart(targetLen, '0');
    if (code.length !== targetLen) continue;

    if (seen.has(code)) {
      throw new Error(`Duplicate muniCode detected: ${code}`);
    }
    seen.add(code);

    const prefCode = code.slice(0, 2);
    const prefName = PREF_BY_CODE[prefCode];
    assert(prefName, `Unknown prefCode derived from muniCode: ${code}`);

    out.push({
      prefCode,
      prefName,
      muniCode: code,
      muniName: rawName,
    });
  }

  return out;
}

async function loadMunicipalitiesFromAdminXlsx(adminDir) {
  let entries;
  try {
    entries = await fs.readdir(adminDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const xlsxFiles = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => name.toLowerCase().endsWith('.xlsx') || name.toLowerCase().endsWith('.xls'))
    .map((name) => path.join(adminDir, name));

  if (xlsxFiles.length === 0) return null;

  const candidates = [];
  for (const filePath of xlsxFiles) {
    const stat = await fs.stat(filePath);
    candidates.push({ filePath, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const inputPath = candidates[0].filePath;

  const xlsxLib = tryRequireXlsx();
  const isXls = inputPath.toLowerCase().endsWith('.xls');
  const isXlsx = inputPath.toLowerCase().endsWith('.xlsx');

  if (isXls && !xlsxLib) {
    throw new Error(
      `Found .xls input (${path.basename(inputPath)}), but the optional dependency "xlsx" is not installed.\n` +
        `Either:\n` +
        `- Convert the file to .xlsx and place it in ${adminDir}\n` +
        `- Install the dependency and retry: npm install -D xlsx`,
    );
  }

  console.log(`Using admin file: ${path.relative(path.resolve(adminDir, '..', '..'), inputPath)}`);

  // Prefer the "xlsx" library when available (handles .xls + formatting quirks).
  if (xlsxLib) {
    const workbook = xlsxLib.readFile(inputPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsxLib.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    assert(Array.isArray(rows) && rows.length > 0, 'Parsed 0 rows from admin spreadsheet');
    return buildMunicipalitiesFromTable(rows);
  }

  // No "xlsx" dependency: support .xlsx via unzip + XML parsing.
  assert(isXlsx, `Unsupported admin file type: ${path.basename(inputPath)}`);
  const entryList = await unzipList(inputPath);

  const sharedStringsXml = entryList.includes('xl/sharedStrings.xml') ? await unzipRead(inputPath, 'xl/sharedStrings.xml') : '';
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

  const worksheetEntry =
    entryList.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e)) ??
    entryList.find((e) => e.startsWith('xl/worksheets/') && e.endsWith('.xml'));
  assert(worksheetEntry, 'No worksheet XML found in XLSX');

  const sheetXml = await unzipRead(inputPath, worksheetEntry);
  const rows = parseWorksheetRows(sheetXml, sharedStrings);
  assert(rows.length > 0, 'Parsed 0 rows from XLSX worksheet');

  return buildMunicipalitiesFromTable(rows);
}

function parseMunicipalitiesFromGsiMuniJs(muniJsText) {
  const pairs = new Map();

  // Pattern: ["01000","北海道", ...]
  const arrayPairRe = /\[\s*['"](\d{5,6})['"]\s*,\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = arrayPairRe.exec(muniJsText)) !== null) {
    const code = m[1];
    const name = m[2].trim();
    if (name) pairs.set(code, name);
  }

  // Pattern: "01000":"北海道"
  const objectPairRe = /['"](\d{5,6})['"]\s*:\s*['"]([^'"]+)['"]/g;
  while ((m = objectPairRe.exec(muniJsText)) !== null) {
    const code = m[1];
    const name = m[2].trim();
    if (name) pairs.set(code, name);
  }

  const seen = new Set();
  const out = [];

  for (const [code, muniName] of pairs.entries()) {
    const prefCode = code.slice(0, 2);
    const prefName = PREF_BY_CODE[prefCode];
    if (!prefName) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ prefCode, prefName, muniCode: code, muniName });
  }

  return out;
}

function validateMunicipalities(records) {
  assert(Array.isArray(records), 'municipalities must be an array');
  assert(records.length >= 1500, `Expected >= 1500 municipality records, got ${records.length}`);

  const prefCodes = new Set();
  const muniCodes = new Set();
  for (const r of records) {
    assert(r && typeof r === 'object', 'municipality record must be an object');
    assert(typeof r.prefCode === 'string' && /^\d{2}$/.test(r.prefCode), `Invalid prefCode: ${r.prefCode}`);
    assert(typeof r.prefName === 'string' && r.prefName.length > 0, `Invalid prefName for ${r.muniCode}`);
    assert(typeof r.muniCode === 'string' && /^\d{5,6}$/.test(r.muniCode), `Invalid muniCode: ${r.muniCode}`);
    assert(typeof r.muniName === 'string' && r.muniName.length > 0, `Invalid muniName for ${r.muniCode}`);

    prefCodes.add(r.prefCode);
    if (muniCodes.has(r.muniCode)) throw new Error(`Duplicate muniCode: ${r.muniCode}`);
    muniCodes.add(r.muniCode);
  }
  assert(prefCodes.size >= 47, `Expected >= 47 distinct prefCode, got ${prefCodes.size}`);

  return { recordCount: records.length, prefCount: prefCodes.size };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const adminDir = path.join(repoRoot, 'data/ref/admin');
  const gsiMuniPath = path.join(repoRoot, 'data/ref/gsi/muni.js');
  const outPath = path.join(repoRoot, 'data/generated/municipalities.json');
  const webOutPath = path.join(repoRoot, 'apps/web/data/generated/municipalities.json');

  let municipalities = await loadMunicipalitiesFromAdminXlsx(adminDir);

  let source = 'admin-xlsx';
  if (!municipalities) {
    console.log(`No admin XLS/XLSX found under ${path.relative(repoRoot, adminDir)}; falling back to ${path.relative(repoRoot, gsiMuniPath)}`);
    const muniJs = await fs.readFile(gsiMuniPath, 'utf8');
    assert(muniJs.trim().length > 0, 'GSI muni.js is missing/empty; run scripts/fetch-static-refs.js first');
    municipalities = parseMunicipalitiesFromGsiMuniJs(muniJs);
    source = 'gsi-muni.js';
  }

  municipalities.sort((a, b) => a.muniCode.localeCompare(b.muniCode));
  const { recordCount, prefCount } = validateMunicipalities(municipalities);

  const payload = `${JSON.stringify(municipalities, null, 2)}\n`;
  await atomicWriteFile(outPath, payload);
  await atomicWriteFile(webOutPath, payload);
  console.log(`Wrote: ${path.relative(repoRoot, outPath)} (${recordCount} records, ${prefCount} prefectures) [source: ${source}]`);
  console.log(`Wrote: ${path.relative(repoRoot, webOutPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
