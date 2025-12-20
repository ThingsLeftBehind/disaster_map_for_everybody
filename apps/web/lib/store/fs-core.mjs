import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readJsonFile(filePath) {
  const text = await readTextFile(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function atomicWriteFile(filePath, contents) {
  await ensureDirForFile(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(
    dir,
    `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, filePath);
}

export async function atomicWriteJson(filePath, value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await atomicWriteFile(filePath, json);
}

