export function buildUrl(origin: string, path: string, params: Record<string, string | number | null | undefined>): string {
  const url = new URL(path, origin);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export function buildLineShareUrl(targetUrl: string, text: string): string {
  const u = new URL('https://social-plugins.line.me/lineit/share');
  u.searchParams.set('url', targetUrl);
  if (text) u.searchParams.set('text', text);
  return u.toString();
}

export function buildXShareUrl(targetUrl: string, text: string): string {
  const u = new URL('https://twitter.com/intent/tweet');
  if (text) u.searchParams.set('text', text);
  u.searchParams.set('url', targetUrl);
  return u.toString();
}

export function buildThreadsShareUrl(targetUrl: string, text: string): string {
  const u = new URL('https://www.threads.net/intent/post');
  const combined = [text, targetUrl].filter(Boolean).join('\n').trim();
  if (combined) u.searchParams.set('text', combined);
  return u.toString();
}

export function formatShelterShareText(args: {
  shelterName: string;
  address?: string | null;
  fromArea?: string | null;
  now?: Date;
}): string {
  const lines: string[] = [`避難場所: ${args.shelterName}`];
  if (args.address) lines.push(String(args.address).trim());

  const now = args.now ?? new Date();
  if (args.fromArea) lines.push(`現在地: ${args.fromArea}`);
  lines.push(`時刻: ${now.toLocaleString()}`);
  return lines.join('\n').trim();
}

export function formatShelterListShareText(args: {
  title: string;
  fromArea?: string | null;
  shelters: Array<{ name: string; distanceKm?: number; url?: string }>;
  now?: Date;
}): string {
  const lines: string[] = [args.title];
  if (args.fromArea) lines.push(`現在地: ${args.fromArea}`);
  const now = args.now ?? new Date();
  lines.push(`時刻: ${now.toLocaleString()}`);
  for (const s of args.shelters) {
    const dist = typeof s.distanceKm === 'number' ? ` (${s.distanceKm.toFixed(1)}km)` : '';
    lines.push(`- ${s.name}${dist}${s.url ? ` ${s.url}` : ''}`);
  }
  return lines.slice(0, 12).join('\n');
}
