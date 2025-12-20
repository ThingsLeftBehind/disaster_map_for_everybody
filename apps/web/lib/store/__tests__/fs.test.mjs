import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson, readJsonFile } from '../fs-core.mjs';

test('store atomicWriteJson writes valid JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-fs-test-'));
  const filePath = path.join(dir, 'x.json');
  await atomicWriteJson(filePath, { a: 1, b: { c: true } });
  const readBack = await readJsonFile(filePath);
  assert.deepEqual(readBack, { a: 1, b: { c: true } });
});

