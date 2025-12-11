export const hazardKeys = [
  'earthquake',
  'tsunami',
  'flood',
  'inland_flood',
  'typhoon',
  'landslide',
  'fire',
  'volcano',
  'storm_surge'
] as const;

export type HazardKey = (typeof hazardKeys)[number];

export const hazardLabels: Record<HazardKey, string> = {
  earthquake: '地震',
  tsunami: '津波',
  flood: '洪水',
  inland_flood: '内水氾濫',
  typhoon: '台風',
  landslide: '土砂災害',
  fire: '火災',
  volcano: '火山',
  storm_surge: '高潮'
};

export const hazardDefaults: Record<HazardKey, boolean> = hazardKeys.reduce(
  (acc, key) => ({ ...acc, [key]: false }),
  {} as Record<HazardKey, boolean>
);
