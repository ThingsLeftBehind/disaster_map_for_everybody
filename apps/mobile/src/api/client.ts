const DEFAULT_API_BASE_URL = 'https://www.hinanavi.com';
const DEFAULT_TIMEOUT_MS = 10000;

export function getApiBaseUrl() {
  const envValue = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (envValue && envValue.trim().length > 0) {
    return envValue.trim();
  }
  return DEFAULT_API_BASE_URL;
}

function buildUrl(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const base = getApiBaseUrl().replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = init.signal ? null : new AbortController();
  const timeoutId = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;

  try {
    const response = await fetch(buildUrl(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
      signal: init.signal ?? controller?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const message = text ? `Request failed ${response.status}: ${text}` : `Request failed ${response.status}`;
      throw new Error(message);
    }

    return (await response.json()) as T;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
