import test from 'node:test';
import assert from 'node:assert/strict';
import { formatQuakeDepth, normalizeQuakeDepthKm } from '../depth-core.mjs';

test('normalizeQuakeDepthKm treats JMA coordinate depth meters as kilometers', () => {
  assert.equal(normalizeQuakeDepthKm(-10000), 10);
  assert.equal(normalizeQuakeDepthKm('10000'), 10);
  assert.equal(normalizeQuakeDepthKm('+10000/'), 10);
});

test('normalizeQuakeDepthKm preserves values already in kilometers', () => {
  assert.equal(normalizeQuakeDepthKm(10), 10);
  assert.equal(normalizeQuakeDepthKm('10km'), 10);
  assert.equal(normalizeQuakeDepthKm('深さ 80 km'), 80);
});

test('formatQuakeDepth uses an explicit Japanese unknown label', () => {
  assert.equal(formatQuakeDepth(null), '不明');
  assert.equal(formatQuakeDepth(''), '不明');
  assert.equal(formatQuakeDepth('10000km'), '10km');
});
