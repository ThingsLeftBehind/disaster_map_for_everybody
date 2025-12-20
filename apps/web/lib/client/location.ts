export type Coords = { lat: number; lon: number };

export type ReverseGeocodeResult = {
  muniCode: string | null;
  prefCode: string | null;
  address: string | null;
  raw?: any;
};

function computeLocalGovCheckDigit(code5: string): string {
  const digits = code5.split('').map((ch) => Number(ch));
  if (digits.length !== 5 || digits.some((d) => !Number.isFinite(d))) return '0';
  const weights = [6, 5, 4, 3, 2];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const remainder = sum % 11;
  const cd = (11 - remainder) % 11;
  return cd === 10 ? '0' : String(cd);
}

function normalizeMuniCode(raw: unknown): { muniCode: string | null; prefCode: string | null } {
  if (typeof raw !== 'string') return { muniCode: null, prefCode: null };
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { muniCode: null, prefCode: null };

  if (digits.length === 6) {
    const prefCode = digits.slice(0, 2);
    return { muniCode: digits, prefCode: /^\d{2}$/.test(prefCode) ? prefCode : null };
  }

  if (digits.length <= 5) {
    const base5 = digits.padStart(5, '0');
    if (!/^\d{5}$/.test(base5)) return { muniCode: null, prefCode: null };
    const muniCode = `${base5}${computeLocalGovCheckDigit(base5)}`;
    const prefCode = base5.slice(0, 2);
    return { muniCode, prefCode: /^\d{2}$/.test(prefCode) ? prefCode : null };
  }

  return { muniCode: null, prefCode: null };
}

export async function reverseGeocodeGsi(coords: Coords): Promise<ReverseGeocodeResult> {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lon=${encodeURIComponent(
    coords.lon
  )}&lat=${encodeURIComponent(coords.lat)}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Reverse geocoder HTTP ${res.status}`);
  const json = await res.json();
  const results = json?.results ?? null;
  const { muniCode, prefCode } = normalizeMuniCode(results?.muniCd);

  const address = [results?.lv01Nm, results?.lv02Nm, results?.lv03Nm, results?.lv04Nm]
    .filter((v: any) => typeof v === 'string' && v.trim())
    .join('');

  return { muniCode, prefCode, address: address || null, raw: json };
}

export function roundCoords(coords: Coords, decimals: number): Coords {
  const f = 10 ** decimals;
  return { lat: Math.round(coords.lat * f) / f, lon: Math.round(coords.lon * f) / f };
}

const LS_LAST = 'jp_evac_last_location_v1';

export function loadLastLocation(): Coords | null {
  try {
    const raw = localStorage.getItem(LS_LAST);
    if (!raw) return null;
    const json = JSON.parse(raw);
    if (typeof json?.lat !== 'number' || typeof json?.lon !== 'number') return null;
    return { lat: json.lat, lon: json.lon };
  } catch {
    return null;
  }
}

export function saveLastLocation(coords: Coords): void {
  try {
    localStorage.setItem(LS_LAST, JSON.stringify(coords));
  } catch {
    // ignore
  }
}
