const BASE_URL = process.env.HAZARD_API_BASE ?? 'http://localhost:3000';

const SAMPLE_TILES = [
  { z: 11, x: 1818, y: 806 },
  { z: 11, x: 1819, y: 806 },
  { z: 12, x: 3637, y: 1613 },
];

const SAMPLE_TILES_BY_LAYER = {
  liquefaction: [
    { z: 11, x: 1818, y: 806 },
    { z: 11, x: 1819, y: 806 },
    { z: 12, x: 3636, y: 1612 },
    { z: 12, x: 3637, y: 1613 },
  ],
};

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

function buildTileUrl(template, z, x, y, scheme) {
  const tmsY = scheme === 'tms' ? (1 << z) - 1 - y : y;
  return template.replace(/\{z\}/g, String(z)).replace(/\{x\}/g, String(x)).replace(/\{y\}/g, String(tmsY));
}

function resolveTemplate(template) {
  if (template.startsWith('http://') || template.startsWith('https://')) return template;
  if (template.startsWith('/')) return `${BASE_URL}${template}`;
  return `${BASE_URL}/${template}`;
}

async function probeTemplate(template, scheme, samples = SAMPLE_TILES) {
  const statuses = [];
  for (const sample of samples) {
    const url = buildTileUrl(resolveTemplate(template), sample.z, sample.x, sample.y, scheme);
    const status = await fetchWithTimeout(url);
    statuses.push(status);
    await timeout(150);
  }
  const ok = statuses.some((status) => status >= 200 && status < 300);
  return { ok, statuses };
}

async function main() {
  const res = await fetch(`${BASE_URL}/api/gsi/hazard-layers`, { cache: 'no-store' });
  if (!res.ok) {
    console.error(`Failed to fetch hazard layers: HTTP ${res.status}`);
    process.exit(1);
  }
  const data = await res.json();
  const layers = Array.isArray(data?.layers) ? data.layers : [];
  if (layers.length === 0) {
    console.error('No hazard layers returned.');
    process.exit(1);
  }

  let failed = false;
  for (const layer of layers) {
    const tiles = Array.isArray(layer.tiles) && layer.tiles.length > 0
      ? layer.tiles
      : [{ url: layer.tileUrl, scheme: layer.scheme ?? 'xyz' }];
    for (const tile of tiles) {
      const scheme = tile.scheme ?? layer.scheme ?? 'xyz';
      const template = tile.url ?? layer.tileUrl;
      const samples = SAMPLE_TILES_BY_LAYER[layer.key] ?? SAMPLE_TILES;
      const result = await probeTemplate(template, scheme, samples);
      const statusList = result.statuses.join(',');
      if (result.ok) {
        console.log(`PASS ${layer.key} ${scheme} ${template} -> ${statusList}`);
      } else {
        console.log(`FAIL ${layer.key} ${scheme} ${template} -> ${statusList}`);
        failed = true;
      }
    }
  }

  if (failed) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
