export type DisplayFetchStatus = 'Online' | 'Delayed' | 'Unavailable' | string;

export function toDisplayFetchStatus(input?: string | null): string {
  if (input === 'OK' || input === 'ONLINE') return 'Online';
  if (input === 'PENDING' || input === 'LOADING') return 'Checking';
  if (input === 'DEGRADED' || input === 'DELAYED' || input === 'OUTDATED') return 'Delayed';
  if (input === 'DOWN' || input === 'UNAVAILABLE') return 'Unavailable';
  return input ?? 'unknown';
}
