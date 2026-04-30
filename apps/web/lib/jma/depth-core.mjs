function normalizeFullWidthDigits(input) {
  return String(input).replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch)));
}

export function normalizeQuakeDepthKm(raw) {
  if (raw === null || raw === undefined) return null;
  const text = normalizeFullWidthDigits(String(raw)).trim();
  if (!text) return null;

  const match = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;

  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;

  const abs = Math.abs(value);
  const lower = text.toLowerCase();
  if (lower.includes('km') && abs < 1000) return Math.round(abs);
  if (lower.includes('m') && !lower.includes('km')) return Math.round(abs / 1000);

  return Math.round(abs >= 1000 ? abs / 1000 : abs);
}

export function formatQuakeDepth(raw, unknownLabel = '不明') {
  const km = normalizeQuakeDepthKm(raw);
  return km === null ? unknownLabel : `${km}km`;
}
