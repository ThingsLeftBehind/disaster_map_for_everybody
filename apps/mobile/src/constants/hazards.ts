export const HAZARD_OPTIONS = [
    { key: 'flood', label: '洪水' },
    { key: 'landslide', label: '土砂災害' },
    { key: 'tsunami', label: '津波' },
    { key: 'storm_surge', label: '高潮' },
    { key: 'inland_flood', label: '内水氾濫' },
    { key: 'river_flood', label: '河川氾濫' },
    { key: 'volcano', label: '火山' },
    { key: 'earthquake', label: '地震' },
    { key: 'liquefaction', label: '液状化' },
] as const;

export type HazardKey = (typeof HAZARD_OPTIONS)[number]['key'];
