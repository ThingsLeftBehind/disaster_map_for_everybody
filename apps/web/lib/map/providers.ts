export const GENERAL_MAP_TILE_LAYER = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxNativeZoom: 19,
} as const;

export const QUAKE_MAP_TILE_LAYER = {
  url: 'https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png',
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル（白地図）</a>',
  maxNativeZoom: 14,
} as const;
