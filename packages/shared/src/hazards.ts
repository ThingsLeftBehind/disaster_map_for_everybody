export const hazardKeys = [
  'flood',
  'landslide',
  'storm_surge',
  'earthquake',
  'tsunami',
  'large_fire',
  'inland_flood',
  'volcano',
] as const;

export type HazardKey = typeof hazardKeys[number];

export const hazardLabels: Record<HazardKey, string> = {
  flood: '洪水',
  landslide: '土砂災害',
  storm_surge: '高潮',
  earthquake: '地震',
  tsunami: '津波',
  large_fire: '大規模火災',
  inland_flood: '内水氾濫',
  volcano: '火山',
};
