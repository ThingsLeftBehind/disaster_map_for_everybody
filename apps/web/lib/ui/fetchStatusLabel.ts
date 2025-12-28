export type DisplayFetchStatus = 'OK' | 'OUTDATED' | 'DOWN' | string;

export function toDisplayFetchStatus(input?: string | null): string {
  if (input === 'DEGRADED') return 'OUTDATED';
  return input ?? 'unknown';
}
