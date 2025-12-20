import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson, readJsonFile } from '../cache-core.mjs';

test('atomicWriteJson writes valid JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jma-cache-test-'));
  const filePath = path.join(dir, 'state.json');

  const payload = { ok: true, n: 1, nested: { a: 'b' } };
  await atomicWriteJson(filePath, payload);

  const readBack = await readJsonFile(filePath);
  assert.deepEqual(readBack, payload);
});

