import useSWR from 'swr';

export type AreaName = {
  prefCode: string | null;
  prefName: string | null;
  muniCode: string | null;
  muniName: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function formatPrefMuniLabel(area: { prefName?: string | null; muniName?: string | null } | null | undefined): string | null {
  const prefName = area?.prefName ?? null;
  const muniName = area?.muniName ?? null;
  if (!prefName) return null;
  if (muniName) return `${prefName} ${muniName}`;
  return prefName;
}

export function useAreaName(args: { prefCode?: string | null; muniCode?: string | null }) {
  const prefCode = typeof args.prefCode === 'string' ? args.prefCode : null;
  const muniCode = typeof args.muniCode === 'string' ? args.muniCode : null;

  const params = new URLSearchParams();
  if (prefCode) params.set('prefCode', prefCode);
  if (muniCode) params.set('muniCode', muniCode);

  const key = params.toString() ? `/api/ref/area-name?${params.toString()}` : null;
  const { data, error, isLoading } = useSWR(key, fetcher, { dedupingInterval: 60_000 });

  const area: AreaName | null = (data?.area as AreaName | undefined) ?? null;
  const label = formatPrefMuniLabel(area);

  return { area, label, error, isLoading };
}

