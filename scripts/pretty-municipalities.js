#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs/promises');
const path = require('node:path');

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function atomicWriteFile(filePath, contents) {
  await ensureDir(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, filePath);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const inPath = path.join(repoRoot, 'data', 'generated', 'municipalities.json');
  const outPath = path.join(repoRoot, 'data', 'generated', '_pretty', 'municipalities.pretty.json');

  const text = await fs.readFile(inPath, 'utf8');
  const json = JSON.parse(text);
  const pretty = `${JSON.stringify(json, null, 2)}\n`;

  await atomicWriteFile(outPath, pretty);
  const stat = await fs.stat(outPath);
  console.log(`Wrote: ${path.relative(repoRoot, outPath)} (${stat.size} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

