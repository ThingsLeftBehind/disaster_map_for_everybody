import test from 'node:test';
import assert from 'node:assert/strict';
import { isActualQuakeEventRecord, isJmaQuakeNoticeTitle } from '../quake-event-core.mjs';

test('quake notice titles are excluded from event history', () => {
  assert.equal(isJmaQuakeNoticeTitle('顕著な地震の震源要素更新のお知らせ'), true);
  assert.equal(isJmaQuakeNoticeTitle('震源要素更新のお知らせ'), true);
  assert.equal(isActualQuakeEventRecord({
    title: '顕著な地震の震源要素更新のお知らせ',
    time: '2026-04-30T12:00:00+09:00',
    epicenter: '石川県能登地方',
    magnitude: '5.0',
  }), false);
  assert.equal(isActualQuakeEventRecord({
    title: '震源・震度情報',
    infoKind: '震源要素更新のお知らせ',
    time: '2026-04-30T12:00:00+09:00',
    epicenter: '石川県能登地方',
    magnitude: '5.0',
  }), false);
});

test('actual quake records require occurrence time and quake facts', () => {
  assert.equal(isActualQuakeEventRecord({
    title: '震源・震度情報',
    time: '2026-04-30T12:00:00+09:00',
    epicenter: '石川県能登地方',
    maxIntensity: '4',
  }), true);
  assert.equal(isActualQuakeEventRecord({ title: '震源・震度情報', time: null }), false);
});
