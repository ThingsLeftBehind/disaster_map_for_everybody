import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTransferCode, encodeTransferCode } from '../transfer-core.mjs';

test('transfer code roundtrip', () => {
  const payload = { v: 1, savedAreas: [{ id: 'a', prefCode: '13' }], favorites: { shelterIds: ['x'] }, settings: { lowBandwidth: true } };
  const code = encodeTransferCode(payload);
  const decoded = decodeTransferCode(code);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.payload, payload);
});

test('transfer code detects checksum mismatch', () => {
  const payload = { v: 1, hello: 'world' };
  const code = encodeTransferCode(payload);
  const bad = code.replace(/\.[^.]+$/, '.deadbeef00');
  const decoded = decodeTransferCode(bad);
  assert.equal(decoded.ok, false);
});

