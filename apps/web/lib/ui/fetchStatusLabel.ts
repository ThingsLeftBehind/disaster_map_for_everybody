export type DisplayFetchStatus = 'OK' | 'OUTDATED' | 'UNAVAILABLE' | string;

export function toDisplayFetchStatus(input?: string | null): string {
  if (input === 'DEGRADED') return 'OUTDATED';
  if (input === 'DOWN') return 'UNAVAILABLE';
  return input ?? 'unknown';
}
