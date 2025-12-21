import type { NextApiRequest, NextApiResponse } from 'next';
import { getHazardLayersSnapshot } from 'lib/gsi/hazard';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const snapshot = await getHazardLayersSnapshot();
    return res.status(200).json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(200).json({
      version: 1,
      updatedAt: null,
      fetchStatus: 'DEGRADED',
      lastError: message,
      source: {
        metadataUrl: 'https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/metadata_light.xml',
        portalUrl: 'https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/',
        portalScripts: null,
      },
      layers: [
        { key: 'flood', name: 'Flood', jaName: '洪水', tileUrl: 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png', scheme: 'xyz', minZoom: 10, maxZoom: 17 },
        {
          key: 'landslide',
          name: 'Landslide',
          jaName: '土砂災害',
          tileUrl: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png',
          scheme: 'xyz',
          tiles: [
            { url: 'https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
            { url: 'https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
            { url: 'https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png', scheme: 'xyz' },
          ],
          minZoom: 10,
          maxZoom: 17,
        },
        { key: 'tsunami', name: 'Tsunami', jaName: '津波', tileUrl: '/api/tiles/tsunami/{z}/{x}/{y}.png', scheme: 'xyz', minZoom: 10, maxZoom: 17 },
        { key: 'liquefaction', name: 'Liquefaction', jaName: '液状化', tileUrl: '/api/tiles/lcm25k_2012/{z}/{x}/{y}.png', scheme: 'xyz', minZoom: 10, maxZoom: 16 },
      ],
    });
  }
}
