export function isJmaQuakeNoticeTitle(title) {
  const text = String(title ?? '').trim();
  if (!text) return false;
  return /顕著な地震の震源要素更新のお知らせ|震源要素更新のお知らせ|お知らせ/.test(text);
}

function firstString(record, keys) {
  if (!record || typeof record !== 'object') return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function isActualQuakeEventRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const title = firstString(record, ['title', 'ttl', 'headline', 'text']) ?? '';
  if (isJmaQuakeNoticeTitle(title)) return false;
  const infoKind = firstString(record, ['infoKind', 'infokind', 'kind', 'ift']);
  if (isJmaQuakeNoticeTitle(infoKind)) return false;

  const time = firstString(record, ['time', 'ot', 'originTime', 'origin_time', 'datetime', 'dateTime', 'timestamp', 'at']);
  const epicenter = firstString(record, ['epicenter', 'anm', 'an', 'name', 'place', 'loc', 'en']);
  const magnitude = firstString(record, ['magnitude', 'mag', 'mgn', 'mj', 'M']);
  const intensity = firstString(record, ['maxIntensity', 'maxi', 'max', 'int', 'intensity', 'shindo']);

  return Boolean(time && (epicenter || magnitude || intensity));
}
