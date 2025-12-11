const earthRadiusKm = 6371;

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function boundingBox(lat: number, lon: number, radiusKm: number) {
  const latDelta = (radiusKm / earthRadiusKm) * (180 / Math.PI);
  const lonDelta = (radiusKm / (earthRadiusKm * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta
  };
}
