import { Seo } from '../components/Seo';
import useSWR from 'swr';
import { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { useDevice } from '../components/device/DeviceProvider';
import { reverseGeocodeGsi, saveLastLocation } from '../lib/client/location';
import { formatPrefMuniLabel, useAreaName } from '../lib/client/areaName';
import { shapeAlertWarnings, type WarningGroup, deduplicateWarnings } from '../lib/jma/alerts';
import { toJmaClass20 } from '../lib/muni-helper';
import {
  getTokyoContextFromGroup,
  getTokyoContextFromMuniCode,
  getTokyoGroupFromAreaCode,
  getTokyoGroupLabel,
  inferTokyoGroup,
  type TokyoGroupKey,
} from '../lib/alerts/tokyoScope';
import { DataFetchDetails } from '../components/DataFetchDetails';

import { MyAreaWarningsSection } from '../components/MyAreaWarningsSection';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const STALE_MS = 10 * 60 * 1000;

type FetchStatusPayload = {
  fetchStatus?: string | null;
  lastError?: string | null;
  updatedAt?: string | null;
};

type AreaOption = { code: string; name: string };
type TokyoAreaSelectOption = AreaOption & { group: TokyoGroupKey | null };
type Class15AreaOption = AreaOption & {
  class10Code: string | null;
  class10Name: string | null;
};
type Class20AreaOption = AreaOption & {
  parentCode: string | null;
  parentName: string | null;
  class10Code: string | null;
  class10Name: string | null;
};
type WatchRegionAlertOption = {
  id: string;
  label: string;
  placeTypeLabel?: string;
  jma?: {
    prefCode: string | null;
    muniCode: string | null;
    areaCode: string | null;
    class20Code: string | null;
    address: string | null;
  };
};

function shouldShowUnstable({ status, warnings }: { status?: FetchStatusPayload | null; warnings?: FetchStatusPayload | null }): boolean {
  if (status?.lastError || warnings?.lastError) return true;
  if (status?.fetchStatus === 'DOWN' || warnings?.fetchStatus === 'DOWN') return true;
  if (!warnings) return false;
  const updatedAt = warnings.updatedAt;
  if (!updatedAt) return true;
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return true;
  return Date.now() - parsed > STALE_MS;
}

function matchesTokyoGroup(areaCode: string, group: TokyoGroupKey | null): boolean {
  if (!group) return true;
  const raw = typeof areaCode === 'string' ? areaCode.trim() : '';
  const direct = getTokyoGroupFromAreaCode(raw);
  if (direct) return direct === group;
  if (group === 'tokyo-mainland' && /^13001\d$/.test(raw)) return true;
  if (group === 'tokyo-izu-north' && /^13002\d$/.test(raw)) return true;
  if (group === 'tokyo-izu-south' && /^13003\d$/.test(raw)) return true;
  if (group === 'tokyo-ogasawara' && raw === '130040') return true;
  return inferTokyoGroup({ muniCode: raw }) === group;
}

function uniqueAreaOptions(options: AreaOption[]): AreaOption[] {
  const seen = new Set<string>();
  const result: AreaOption[] = [];
  for (const option of options) {
    if (!option.code || !option.name || seen.has(option.code)) continue;
    seen.add(option.code);
    result.push(option);
  }
  return result;
}

function tokyoAreaSortRank(area: TokyoAreaSelectOption): number {
  if (area.group === 'tokyo-mainland') return 1;
  if (area.code === '130020') return 90;
  if (area.code === '130030') return 91;
  if (area.code === '130040') return 92;
  if (area.group === 'tokyo-izu-north') return 93;
  if (area.group === 'tokyo-izu-south') return 94;
  if (area.group === 'tokyo-ogasawara') return 95;
  return 50;
}

function areaDisplayName(area: { code: string; name: string } | null | undefined): string | null {
  if (!area) return null;
  return getTokyoGroupLabel(getTokyoGroupFromAreaCode(area.code)) ?? area.name;
}

import { useRouter } from 'next/router';

export default function AlertsPage() {
  const router = useRouter();

  // 0) CRITICAL: Stop infinite refresh / flashing
  // Guard against /alerts/<areaCode> or other dynamic paths.
  // The page must ALWAYS be at /alerts.
  useEffect(() => {
    if (!router.isReady) return;
    // We only care if we are strictly under /alerts/ something
    // router.pathname might be "/alerts" even if asPath is "/alerts/130000" depending on Next.js config,
    // but usually if no dynamic route exists, it hits 404.
    // However, if we are erroneously on a path starting with /alerts/..., force back.
    const path = router.asPath.split('?')[0];
    if (path.startsWith('/alerts/') && path !== '/alerts') {
      console.warn('AlertsPage: Detect invalid path, forcing replace to /alerts', path);
      // Use shallow replace to avoid server roundtrip if possible, though we want to reset state.
      router.replace('/alerts', undefined, { shallow: true });
    }
  }, [router, router.isReady, router.asPath]);

  const { deviceId, device, selectedArea, selectedJmaAreaCode, currentJmaAreaCode, coarseArea, setSelectedAreaId, setCoarseArea } = useDevice();
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const { label: coarseAreaLabel } = useAreaName({ prefCode: coarseArea?.prefCode ?? null, muniCode: coarseArea?.muniCode ?? null });

  const { data: status } = useSWR('/api/jma/status', fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });

  const [useCurrent, setUseCurrent] = useState(true);
  const [manualPrefCode, setManualPrefCode] = useState('');
  const [manualSubAreaCode, setManualSubAreaCode] = useState('');
  const [manualClass20Code, setManualClass20Code] = useState('');
  const [manualTokyoGroupOverride, setManualTokyoGroupOverride] = useState<TokyoGroupKey | null>(null);
  const [selectedWatchRegionId, setSelectedWatchRegionId] = useState('');

  const [actionBusy, setActionBusy] = useState(false);
  const lastActionRef = useRef(0);

  const { data: prefecturesData } = useSWR('/api/ref/municipalities', fetcher, { dedupingInterval: 60_000 });
  const watchRegionsUrl = deviceId ? `/api/watch-regions/status?deviceId=${encodeURIComponent(deviceId)}` : null;
  const { data: watchRegionsData } = useSWR(watchRegionsUrl, fetcher, { dedupingInterval: 60_000 });
  const watchRegionOptions = useMemo<WatchRegionAlertOption[]>(() => {
    const rows = Array.isArray(watchRegionsData?.regions) ? watchRegionsData.regions : [];
    return rows
      .map((row: any) => ({
        id: typeof row?.id === 'string' ? row.id : '',
        label: typeof row?.label === 'string' ? row.label : '',
        placeTypeLabel: typeof row?.placeTypeLabel === 'string' ? row.placeTypeLabel : undefined,
        jma:
          row?.jma && typeof row.jma === 'object'
            ? {
                prefCode: typeof row.jma.prefCode === 'string' ? row.jma.prefCode : null,
                muniCode: typeof row.jma.muniCode === 'string' ? row.jma.muniCode : null,
                areaCode: typeof row.jma.areaCode === 'string' ? row.jma.areaCode : null,
                class20Code: typeof row.jma.class20Code === 'string' ? row.jma.class20Code : null,
                address: typeof row.jma.address === 'string' ? row.jma.address : null,
              }
            : undefined,
      }))
      .filter((row: WatchRegionAlertOption) => row.id && row.label);
  }, [watchRegionsData?.regions]);
  const selectedWatchRegion = useMemo(
    () => watchRegionOptions.find((region) => region.id === selectedWatchRegionId) ?? null,
    [selectedWatchRegionId, watchRegionOptions]
  );
  const prefectures: Array<{ prefCode: string; prefName: string }> = prefecturesData?.prefectures ?? [];
  const manualPrefName = useMemo(
    () => prefectures.find((p) => p.prefCode === manualPrefCode)?.prefName ?? null,
    [manualPrefCode, prefectures]
  );
  const manualPrefLabel = manualPrefName ?? (manualPrefCode ? '選択中' : null);

  useEffect(() => {
    if (!router.isReady) return;
    const raw = router.query.watchRegionId;
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id || !watchRegionOptions.some((region) => region.id === id)) return;
    setSelectedWatchRegionId(id);
    setUseCurrent(false);
    setManualPrefCode('');
    setManualSubAreaCode('');
    setManualClass20Code('');
    setManualTokyoGroupOverride(null);
    void setSelectedAreaId(null);
  }, [router.isReady, router.query.watchRegionId, setSelectedAreaId, watchRegionOptions]);

  const manualAreaCode = manualPrefCode ? `${manualPrefCode}0000` : null;
  const selectedWatchAreaCode = selectedWatchRegion?.jma?.areaCode ?? null;
  const selectedWatchClass20Code = selectedWatchRegion?.jma?.class20Code ?? null;
  const effectiveAreaCode = selectedWatchAreaCode ?? (useCurrent ? currentJmaAreaCode : manualAreaCode ?? selectedJmaAreaCode);
  const activeMuniCode = selectedWatchRegion ? selectedWatchRegion.jma?.muniCode ?? null : useCurrent ? coarseArea?.muniCode : manualPrefCode ? null : selectedArea?.muniCode;
  const class20 = selectedWatchClass20Code ?? (!useCurrent && manualClass20Code ? manualClass20Code : toJmaClass20(activeMuniCode ?? null));
  const requestedTokyoGroup = useMemo((): TokyoGroupKey | null => {
    if (effectiveAreaCode !== '130000') return null;
    if (selectedWatchRegion) {
      return (
        getTokyoGroupFromAreaCode(selectedWatchClass20Code ?? '') ??
        inferTokyoGroup({
          prefCode: selectedWatchRegion.jma?.prefCode ?? null,
          muniCode: selectedWatchRegion.jma?.muniCode ?? null,
          label: selectedWatchRegion.label,
        }) ??
        'tokyo-mainland'
      );
    }
    if (!useCurrent && manualSubAreaCode) return getTokyoGroupFromAreaCode(manualSubAreaCode) ?? manualTokyoGroupOverride ?? 'tokyo-mainland';
    if (useCurrent) {
      return (
        inferTokyoGroup({
          prefCode: coarseArea?.prefCode ?? null,
          muniCode: coarseArea?.muniCode ?? null,
          label: coarseAreaLabel ?? null,
        }) ?? 'tokyo-mainland'
      );
    }
    if (manualPrefCode === '13') return null;
    if (selectedArea) {
      return (
        inferTokyoGroup({
          prefCode: selectedArea.prefCode ?? null,
          muniCode: selectedArea.muniCode ?? null,
          label: selectedArea.muniName ?? selectedArea.label ?? null,
        }) ?? 'tokyo-mainland'
      );
    }
    return null;
  }, [
    coarseArea?.muniCode,
    coarseArea?.prefCode,
    coarseAreaLabel,
    effectiveAreaCode,
    manualPrefCode,
    manualSubAreaCode,
    manualTokyoGroupOverride,
    selectedArea,
    selectedWatchClass20Code,
    selectedWatchRegion,
    useCurrent,
  ]);
  const warningsUrl = effectiveAreaCode
    ? `/api/jma/warnings?area=${effectiveAreaCode}${manualSubAreaCode && !useCurrent ? `&subArea=${manualSubAreaCode}` : ''}${class20 ? `&class20=${class20}` : ''}${requestedTokyoGroup ? `&tokyoGroup=${requestedTokyoGroup}` : ''}`
    : null;
  const { data: warnings, mutate: mutateWarnings } = useSWR(warningsUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const areaContext = useMemo(() => {
    if (selectedWatchRegion) {
      return {
        prefCode: selectedWatchRegion.jma?.prefCode ?? null,
        muniCode: selectedWatchClass20Code ?? selectedWatchRegion.jma?.muniCode ?? null,
        label: selectedWatchRegion.label,
      };
    }
    if (useCurrent) {
      return {
        prefCode: coarseArea?.prefCode ?? null,
        muniCode: coarseArea?.muniCode ?? null,
        label: coarseAreaLabel ?? null,
      };
    }
    if (manualPrefCode) {
      return {
        prefCode: manualPrefCode,
        muniCode: null,
        label: manualPrefName ?? null,
      };
    }
    if (selectedArea) {
      return {
        prefCode: selectedArea.prefCode ?? null,
        muniCode: selectedArea.muniCode ?? null,
        label: selectedArea.muniName ?? selectedArea.label ?? null,
      };
    }
    return { prefCode: null, muniCode: null, label: null };
  }, [
    coarseArea?.prefCode,
    coarseArea?.muniCode,
    coarseAreaLabel,
    manualPrefCode,
    manualPrefName,
    selectedArea,
    selectedWatchClass20Code,
    selectedWatchRegion,
    useCurrent,
  ]);

  const breakdown = (warnings as any)?.breakdown as Record<string, { name: string; items: any[] }> | null;
  const muniMap = (warnings as any)?.muniMap as Record<string, string> | null;
  const class20Groups = (warnings as any)?.class20Groups as
    | Record<
        string,
        {
          name: string;
          parentCode?: string | null;
          parentName?: string | null;
          class10Code?: string | null;
          class10Name?: string | null;
          items: any[];
        }
      >
    | null;
  const class20Options = useMemo<Class20AreaOption[]>(() => {
    const rows = Array.isArray((warnings as any)?.availableClass20Areas) ? (warnings as any).availableClass20Areas : [];
    return rows
      .map((row: any) => ({
        code: typeof row?.code === 'string' ? row.code : '',
        name: typeof row?.name === 'string' ? row.name : '',
        parentCode: typeof row?.parentCode === 'string' ? row.parentCode : null,
        parentName: typeof row?.parentName === 'string' ? row.parentName : null,
        class10Code: typeof row?.class10Code === 'string' ? row.class10Code : null,
        class10Name: typeof row?.class10Name === 'string' ? row.class10Name : null,
      }))
      .filter((row: Class20AreaOption) => row.code && row.name);
  }, [warnings]);
  const class10Options = useMemo<AreaOption[]>(() => {
    const rows = Array.isArray((warnings as any)?.availableClass10Areas) ? (warnings as any).availableClass10Areas : [];
    return rows
      .map((row: any) => ({
        code: typeof row?.code === 'string' ? row.code : '',
        name: typeof row?.name === 'string' ? row.name : '',
      }))
      .filter((row: AreaOption) => row.code && row.name);
  }, [warnings]);
  const class15Options = useMemo<Class15AreaOption[]>(() => {
    const rows = Array.isArray((warnings as any)?.availableClass15Areas) ? (warnings as any).availableClass15Areas : [];
    return rows
      .map((row: any) => ({
        code: typeof row?.code === 'string' ? row.code : '',
        name: typeof row?.name === 'string' ? row.name : '',
        class10Code: typeof row?.class10Code === 'string' ? row.class10Code : null,
        class10Name: typeof row?.class10Name === 'string' ? row.class10Name : null,
      }))
      .filter((row: Class15AreaOption) => row.code && row.name);
  }, [warnings]);
  const subAreaOptions = useMemo<AreaOption[]>(() => {
    const metadataOptions =
      class15Options.length > 0
        ? uniqueAreaOptions(class15Options.map((area) => ({ code: area.code, name: area.name })))
        : uniqueAreaOptions(class10Options);
    if (metadataOptions.length > 0) return metadataOptions.sort((a, b) => a.code.localeCompare(b.code));
    if (!breakdown) return [];
    return Object.entries(breakdown)
      .map(([code, data]) => ({ code, name: data.name || code }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [breakdown, class10Options, class15Options]);
  const visibleClass20Options = useMemo<Class20AreaOption[]>(() => {
    if (!manualSubAreaCode) return [];
    return class20Options.filter(
      (area) => area.code === manualSubAreaCode || area.parentCode === manualSubAreaCode || area.class10Code === manualSubAreaCode
    );
  }, [class20Options, manualSubAreaCode]);
  const apiTokyoAreaOptions = useMemo<AreaOption[]>(() => {
    const rows = Array.isArray((warnings as any)?.availableTokyoAreas) ? (warnings as any).availableTokyoAreas : [];
    return rows
      .map((row: any) => ({
        code: typeof row?.code === 'string' ? row.code : '',
        name: typeof row?.name === 'string' ? row.name : '',
      }))
      .filter((row: AreaOption) => row.code && row.name);
  }, [warnings]);
  const tokyoAreaOptions = useMemo<TokyoAreaSelectOption[]>(() => {
    const options = new Map<string, TokyoAreaSelectOption>();
    const inferGroup = (code: string): TokyoGroupKey | null => {
      const direct = getTokyoGroupFromAreaCode(code);
      if (direct) return direct;
      const child = class20Options.find((area) => area.code === code || area.parentCode === code || area.class10Code === code);
      const class15 = class15Options.find((area) => area.code === code);
      return getTokyoGroupFromAreaCode(child?.class10Code ?? class15?.class10Code ?? null);
    };
    const add = (area: AreaOption) => {
      const directGroup = getTokyoGroupFromAreaCode(area.code);
      options.set(area.code, {
        ...area,
        group: inferGroup(area.code),
        name: getTokyoGroupLabel(directGroup) ?? area.name,
      });
    };
    const byCode = new Map<string, AreaOption>();
    apiTokyoAreaOptions.forEach((area) => byCode.set(area.code, area));
    class10Options.forEach((area) => byCode.set(area.code, area));
    class15Options
      .filter((area) => area.class10Code === '130010')
      .forEach((area) => byCode.set(area.code, area));
    class15Options
      .filter((area) => area.class10Code === '130010')
      .forEach(add);
    ['130020', '130030', '130040'].forEach((code) => {
      const area = byCode.get(code);
      if (area) add(area);
    });
    return Array.from(options.values()).sort((a, b) => {
      const rankCompare = tokyoAreaSortRank(a) - tokyoAreaSortRank(b);
      if (rankCompare !== 0) return rankCompare;
      return a.code.localeCompare(b.code);
    });
  }, [apiTokyoAreaOptions, class10Options, class15Options, class20Options]);

  useEffect(() => {
    if (useCurrent || !manualPrefCode) {
      setManualSubAreaCode('');
      setManualClass20Code('');
      setManualTokyoGroupOverride(null);
      return;
    }
    const validOptions = manualPrefCode === '13' ? tokyoAreaOptions : subAreaOptions;
    if (manualSubAreaCode && validOptions.length > 0 && !validOptions.some((area) => area.code === manualSubAreaCode)) {
      setManualSubAreaCode('');
      setManualClass20Code('');
      setManualTokyoGroupOverride(null);
    }
  }, [manualPrefCode, manualSubAreaCode, subAreaOptions, tokyoAreaOptions, useCurrent]);

  useEffect(() => {
    if (useCurrent) return;
    if (!manualClass20Code) return;
    if (class20Options.length === 0) return;
    if (!visibleClass20Options.some((area) => area.code === manualClass20Code)) {
      setManualClass20Code('');
    }
  }, [class20Options.length, manualClass20Code, useCurrent, visibleClass20Options]);

  const selectedSubArea = manualSubAreaCode && breakdown?.[manualSubAreaCode] ? breakdown[manualSubAreaCode] : null;
  const selectedSubTokyoGroup = selectedSubArea || manualSubAreaCode ? getTokyoGroupFromAreaCode(manualSubAreaCode) ?? manualTokyoGroupOverride : null;
  const selectedClass20Area = manualClass20Code && class20Groups?.[manualClass20Code] ? class20Groups[manualClass20Code] : null;
  const selectedSubAreaOption = useMemo(
    () =>
      manualSubAreaCode
        ? [...tokyoAreaOptions, ...subAreaOptions].find((area) => area.code === manualSubAreaCode) ?? null
        : null,
    [manualSubAreaCode, subAreaOptions, tokyoAreaOptions]
  );
  const selectedSubAreaLabel = selectedSubAreaOption
    ? selectedSubAreaOption.name
    : selectedSubArea
      ? areaDisplayName({ code: manualSubAreaCode, name: selectedSubArea.name })
      : null;
  const scopedWarnings = useMemo(() => {
    if (selectedClass20Area) {
      return {
        ...(warnings ?? {}),
        items: selectedClass20Area.items,
        tokyoGroups: null,
      };
    }
    if (!manualSubAreaCode) return warnings;
    const childGroups = class20Groups
      ? Object.entries(class20Groups)
          .filter(([, group]) => group.parentCode === manualSubAreaCode || group.class10Code === manualSubAreaCode)
          .flatMap(([, group]) => group.items)
      : [];
    if (!selectedSubArea) {
      return {
        ...(warnings ?? {}),
        items: childGroups.length > 0 ? childGroups : (warnings as any)?.items ?? [],
        tokyoGroups: null,
      };
    }
    return {
      ...(warnings ?? {}),
      items: childGroups.length > 0 ? childGroups : selectedSubArea.items,
      tokyoGroups: null,
    };
  }, [class20Groups, manualSubAreaCode, selectedClass20Area, selectedSubArea, warnings]);
  const warningAreaContext = useMemo(() => {
    if (selectedClass20Area) {
      return {
        prefCode: manualPrefCode || areaContext.prefCode,
        muniCode: manualClass20Code,
        label: selectedClass20Area.name,
      };
    }
    if (manualSubAreaCode && selectedSubAreaLabel) {
      return {
        prefCode: manualPrefCode || areaContext.prefCode,
        muniCode: null,
        label: selectedSubAreaLabel,
      };
    }
    if (requestedTokyoGroup) {
      return { prefCode: areaContext.prefCode, muniCode: null, label: getTokyoGroupLabel(requestedTokyoGroup) };
    }
    return areaContext;
  }, [areaContext, manualClass20Code, manualPrefCode, manualSubAreaCode, requestedTokyoGroup, selectedClass20Area, selectedSubAreaLabel]);

  const warningShape = useMemo(
    () =>
      shapeAlertWarnings({
        warnings: scopedWarnings,
        area: warningAreaContext,
      }),
    [scopedWarnings, warningAreaContext]
  );

  const warningBuckets = warningShape.buckets;
  const warningCounts = warningShape.counts;
  const apiSelectedTokyoGroup = ((warnings as any)?.selectedAreaGroup ?? null) as TokyoGroupKey | null;
  const selectedAreaChildren = (Array.isArray((warnings as any)?.selectedAreaChildren) ? (warnings as any).selectedAreaChildren : []) as Array<{
    code: string;
    name: string;
    level: 'subarea' | 'municipality';
  }>;
  const tokyoGroupFilter = selectedSubTokyoGroup ?? (warningShape.isTokyoArea ? warningShape.tokyoGroup : null) ?? apiSelectedTokyoGroup ?? requestedTokyoGroup;
  const tokyoContextFromMuni = getTokyoContextFromMuniCode(areaContext.muniCode ?? null);
  const tokyoContext = tokyoGroupFilter
    ? getTokyoContextFromGroup(tokyoGroupFilter)
    : selectedSubTokyoGroup
      ? getTokyoContextFromGroup(selectedSubTokyoGroup)
      : tokyoContextFromMuni;
  const tokyoScopeLabel = manualSubAreaCode && selectedSubAreaLabel
    ? selectedSubAreaLabel
    : ((warnings as any)?.selectedAreaName as string | null) ??
      getTokyoGroupLabel(tokyoGroupFilter ?? selectedSubTokyoGroup) ??
      (tokyoContext === 'MAINLAND' ? '東京地方（島しょ除く）' : tokyoContext === 'ISLANDS' ? '東京都島しょ部' : null);
  const showTokyoSubAreaSelector = !selectedWatchRegion && effectiveAreaCode === '130000' && tokyoAreaOptions.length > 0;
  const tokyoSubAreaValue = manualSubAreaCode;
  const manualTokyoSubAreaName = manualPrefCode === '13'
    ? tokyoAreaOptions.find((area) => area.code === manualSubAreaCode)?.name ?? null
    : null;
  const forecastAreaOptions = showTokyoSubAreaSelector ? tokyoAreaOptions : subAreaOptions;
  const forecastAreaValue = showTokyoSubAreaSelector ? tokyoSubAreaValue : manualSubAreaCode;
  const showForecastAreaSelect =
    !selectedWatchRegion &&
    forecastAreaOptions.length > 0 &&
    (showTokyoSubAreaSelector || (!useCurrent && Boolean(manualPrefCode)));
  const showForecastAreaEmpty =
    !selectedWatchRegion &&
    !useCurrent &&
    Boolean(manualPrefCode) &&
    Boolean(warnings) &&
    forecastAreaOptions.length === 0;
  const showClass20Empty =
    !selectedWatchRegion &&
    !useCurrent &&
    Boolean(manualPrefCode) &&
    Boolean(manualSubAreaCode) &&
    Boolean(warnings) &&
    visibleClass20Options.length === 0;
  const handleForecastAreaChange = (nextCode: string) => {
    setUseCurrent(false);
    setSelectedWatchRegionId('');
    setSelectedAreaId(null);
    setManualClass20Code('');
    if (showTokyoSubAreaSelector) {
      setManualPrefCode('13');
      setManualSubAreaCode(nextCode);
      setManualTokyoGroupOverride(tokyoAreaOptions.find((area) => area.code === nextCode)?.group ?? null);
      return;
    }
    setManualSubAreaCode(nextCode);
    setManualTokyoGroupOverride(null);
  };

  const targetLabel = selectedWatchRegion
    ? `登録済み: ${selectedWatchRegion.label}`
    : useCurrent
    ? currentJmaAreaCode
      ? coarseAreaLabel
        ? `現在地: ${coarseAreaLabel}`
        : '現在地: エリア未確定'
      : '現在地: エリア未確定'
    : manualPrefLabel
      ? `手動: ${manualPrefLabel}${manualSubAreaCode && selectedSubAreaLabel ? ` / ${selectedSubAreaLabel}` : manualTokyoSubAreaName ? ` / ${manualTokyoSubAreaName}` : ''}${selectedClass20Area ? ` / ${selectedClass20Area.name}` : ''}`
      : selectedArea
        ? `選択エリア: ${formatPrefMuniLabel({ prefName: selectedArea.prefName, muniName: selectedArea.muniName ?? null }) ?? selectedArea.prefName}`
        : 'エリア未確定';

  const targetForecastCode = activeMuniCode && muniMap ? muniMap[activeMuniCode] : null;
  const highlightedForecastCode = selectedSubArea ? manualSubAreaCode : targetForecastCode;

  const activeAreas = useMemo(() => {
    if (!breakdown) return [];
    return Object.entries(breakdown)
      .map(([code, data]) => {
        if (manualSubAreaCode && code !== manualSubAreaCode) return null;
        if (!matchesTokyoGroup(code, tokyoGroupFilter)) return null;
        const activeItems = data.items.filter((i: any) => {
          const s = i.status || '';
          return !s.includes('解除') && !s.includes('なし') && !s.includes('ありません');
        });
        const items = deduplicateWarnings(activeItems);
        return { code, ...data, items };
      })
      .filter((area): area is NonNullable<typeof area> => area !== null && area.items.length > 0)
      .sort((a, b) => b.items.length - a.items.length || a.code.localeCompare(b.code));
  }, [breakdown, manualSubAreaCode, tokyoGroupFilter]);

  const activeAreaNames = activeAreas.slice(0, 3).map(a => a.name);
  if (activeAreas.length > 3) activeAreaNames.push('ほか');

  const beginAction = () => {
    const now = Date.now();
    if (actionBusy || now - lastActionRef.current < 800) return false;
    lastActionRef.current = now;
    setActionBusy(true);
    return true;
  };

  const endAction = () => setActionBusy(false);

  const handleUseCurrentLocation = () => {
    if (!beginAction()) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        saveLastLocation(next);
        try {
          const r = await reverseGeocodeGsi(next);
          setCoarseArea({ prefCode: r.prefCode, muniCode: r.muniCode, address: r.address });
          setSelectedWatchRegionId('');
          setManualTokyoGroupOverride(null);
          setUseCurrent(true);
          endAction();
        } catch {
          setCoarseArea(null);
          endAction();
          alert('現在地（行政区）の取得に失敗しました');
        }
      },
      () => {
        endAction();
        alert('位置情報の取得に失敗しました');
      }
    );
  };

  const warningResultTitle = selectedWatchRegion
    ? `${selectedWatchRegion.label}の警報・注意報`
    : useCurrent
    ? 'マイエリアの警報・注意報'
    : selectedClass20Area
      ? `${selectedClass20Area.name}の警報・注意報`
    : manualSubAreaCode && selectedSubAreaLabel
      ? `${selectedSubAreaLabel}の警報・注意報`
        : manualPrefName
          ? `${manualPrefName}の警報・注意報`
          : '選択エリアの警報・注意報';
  const warningResultMessage = (() => {
    if (!warningsUrl) return { text: '都道府県・発表区域を選択してください。', tone: 'text-gray-600' };
    if (!warnings) return { text: '確認中です。', tone: 'text-gray-600' };
    const fetchStatus = String((warnings as any)?.fetchStatus ?? '');
    const hasFetchError = Boolean((warnings as any)?.lastError);
    if (fetchStatus === 'DOWN' || (hasFetchError && warningCounts.total === 0 && fetchStatus !== 'EMPTY')) {
      return { text: '警報・注意報を取得できませんでした。', tone: 'text-red-700' };
    }
    if (warningCounts.total === 0) {
      return { text: '現在、警報・注意報は発表されていません。', tone: 'text-gray-700' };
    }
    return { text: `${warningCounts.total}種類`, tone: 'text-gray-700' };
  })();

  return (
    <div className="space-y-6">
      <Seo
        title="警報・注意報"
        description="気象庁の警報・注意報・特別警報をエリア別に確認できるページ。発表区域の内訳や東京本土/島しょの区分にも対応し、最新の警戒レベル把握と避難判断を支援します。"
      />

      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">警報・注意報</h1>
            </div>
            {/* Mobile: Counts on right, same row if possible? Header is flex-col on mobile?
                    User said: "Mobile layout: move counts to header’s right side, same row"
                    The current structure has `flex-col` for mobile wrapper.
                    To put counts on RIGHT of header on mobile, we need valid flex row.
                 */}
            <div className="flex flex-col items-end gap-1 md:hidden">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={classNames(
                    'rounded-full px-3 py-1 text-xs font-bold ring-1',
                    warningCounts.urgent > 0 ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-gray-50 text-gray-800 ring-gray-200'
                  )}
                >
                  警報 {warningCounts.urgent}
                </span>
                <span
                  className={classNames(
                    'rounded-full px-3 py-1 text-xs font-bold ring-1',
                    warningCounts.advisory > 0 ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-gray-50 text-gray-800 ring-gray-200'
                  )}
                >
                  注意報 {warningCounts.advisory}
                </span>
              </div>
            </div>
          </div>

          <div className="hidden md:flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={classNames(
                  'rounded-full px-3 py-1 text-xs font-bold ring-1',
                  warningCounts.urgent > 0 ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-gray-50 text-gray-800 ring-gray-200'
                )}
              >
                警報 {warningCounts.urgent}種類
              </span>
              <span
                className={classNames(
                  'rounded-full px-3 py-1 text-xs font-bold ring-1',
                  warningCounts.advisory > 0 ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-gray-50 text-gray-800 ring-gray-200'
                )}
              >
                注意報 {warningCounts.advisory}種類
              </span>
            </div>
            {tokyoScopeLabel && <div className="text-[11px] text-gray-600">対象: {tokyoScopeLabel}</div>}
            {activeAreas.length > 0 && (
              <div className="text-[11px] text-gray-600">
                発表区域: {activeAreas.length}区域 ({activeAreaNames.join('、')})
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-2xl border bg-gray-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs text-gray-600">対象エリア</div>
                <div className="mt-1 font-semibold">{targetLabel}</div>
                {tokyoScopeLabel && <div className="mt-1 text-xs font-semibold text-blue-900">発表区域: {tokyoScopeLabel}</div>}
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <button
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  onClick={handleUseCurrentLocation}
                  disabled={actionBusy}
                >
                  現在地を使う
                </button>
                {useCurrent && (
                  <button
                    className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-300"
                    onClick={() => {
                      setUseCurrent(false);
                    }}
                    disabled={actionBusy}
                  >
                    現在地を解除
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-gray-50 p-4 md:col-span-2">
              <div className="text-xs text-gray-600">エリア選択</div>
              <div className="mt-2 space-y-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-700">都道府県</span>
                  <select
                    className="min-h-[44px] w-full rounded border px-3 py-2"
                    aria-label="都道府県"
                    value={manualPrefCode}
                    onChange={(e) => {
                      setUseCurrent(false);
                      setSelectedWatchRegionId('');
                      setSelectedAreaId(null);
                      setManualPrefCode(e.target.value);
                      setManualSubAreaCode('');
                      setManualClass20Code('');
                      setManualTokyoGroupOverride(null);
                    }}
                  >
                    <option value="">都道府県を選択</option>
                    {prefectures.map((p) => (
                      <option key={p.prefCode} value={p.prefCode}>
                        {p.prefName}
                      </option>
                    ))}
                  </select>
                </label>

                {!selectedWatchRegion && !useCurrent && manualPrefCode && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-gray-700">発表区域</span>
                    {showForecastAreaSelect ? (
                    <select
                      className="min-h-[44px] w-full rounded border px-3 py-2"
                      value={forecastAreaValue}
                      onChange={(e) => handleForecastAreaChange(e.target.value)}
                      aria-label="発表区域"
                    >
                      <option value="">発表区域を選択</option>
                      {forecastAreaOptions.map((area) => (
                        <option key={area.code} value={area.code}>
                          {area.name}
                        </option>
                      ))}
                    </select>
                    ) : (
                      <div className="py-2 text-xs text-gray-600">
                        {showForecastAreaEmpty ? 'この区域には下位の選択肢がありません。' : '発表区域を読み込み中...'}
                      </div>
                    )}
                  </label>
                )}

                {!selectedWatchRegion && !useCurrent && manualPrefCode && manualSubAreaCode && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-gray-700">市区町村・詳細区域</span>
                    {visibleClass20Options.length > 0 ? (
                    <select
                      className="min-h-[44px] w-full rounded border px-3 py-2"
                      value={manualClass20Code}
                      onChange={(e) => setManualClass20Code(e.target.value)}
                      aria-label="市区町村・詳細区域"
                    >
                      <option value="">すべて表示</option>
                      {visibleClass20Options.map((area) => (
                        <option key={area.code} value={area.code}>
                          {area.name}
                        </option>
                      ))}
                    </select>
                    ) : showClass20Empty ? (
                      <div className="py-2 text-xs text-gray-600">この区域には下位の選択肢がありません。</div>
                    ) : (
                      <div className="py-2 text-xs text-gray-600">市区町村・詳細区域を読み込み中...</div>
                    )}
                  </label>
                )}

                <button
                  className="min-h-[44px] rounded-xl bg-white px-4 py-2 font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
                  onClick={async () => {
                    if (!beginAction()) return;
                    if (!selectedWatchRegion && !selectedArea && !manualPrefCode) {
                      alert('都道府県を選択してください');
                      endAction();
                      return;
                    }
                    const wasCurrent = useCurrent;
                    setUseCurrent(false);
                    try {
                      if (!wasCurrent && warningsUrl) await mutateWarnings();
                    } finally {
                      endAction();
                    }
                  }}
                  disabled={actionBusy}
                >
                  検索
                </button>
              </div>
            </div>
          </div>
        </div>

        {tokyoScopeLabel && selectedAreaChildren.length > 0 && (
          <details className="mt-3 rounded-xl border bg-gray-50 px-3 py-2 text-sm">
            <summary className="cursor-pointer py-2 font-semibold text-gray-900">この発表区域に含まれる地域</summary>
            <div className="mt-2 flex flex-wrap gap-2 pb-2 text-xs text-gray-700">
              {selectedAreaChildren.slice(0, 60).map((area) => (
                <span key={area.code} className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                  {area.name}
                </span>
              ))}
              {selectedAreaChildren.length > 60 && <span className="px-2 py-1 text-gray-500">ほか {selectedAreaChildren.length - 60} 件</span>}
            </div>
            <div className="border-t pt-2 text-xs text-gray-600">気象庁の区域定義に基づいて表示しています。</div>
          </details>
        )}

        {/* Note moved to bottom */}
      </section >

      <section className="space-y-6">
        <MyAreaWarningsSection />

        <div className="rounded-2xl bg-white p-5 shadow">
          <h2 className="text-lg font-bold text-gray-900">{warningResultTitle}</h2>

          <div className={classNames('mt-3 text-sm', warningResultMessage.tone)}>{warningResultMessage.text}</div>

          {shouldShowUnstable({ status, warnings }) && (
            <div className="mt-3 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="font-semibold">取得が不安定</div>
              <div className="mt-1 text-xs">通信状況により遅延/欠落の可能性があります。直近のデータを表示中です。</div>
            </div>
          )}

          {warnings && (
            <>
              <div className="mt-4 space-y-4">
                <WarningGroupSection title="緊急（警報/特別警報）" groups={warningBuckets.urgent} />
                <WarningGroupSection title="注意報" groups={warningBuckets.advisory} />
              </div>

              {breakdown && (
                <div className="mt-6 border-t pt-4">
                  <SubAreaBreakdown
                    breakdown={breakdown}
                    class20Groups={class20Groups}
                    highlightCode={highlightedForecastCode}
                    tokyoGroup={tokyoGroupFilter}
                    parentCode={selectedSubArea ? manualSubAreaCode : null}
                    exactCode={selectedClass20Area ? manualClass20Code : null}
                  />
                </div>
              )}

            </>
          )}
        </div>
      </section>

      <GuidanceSection urgent={warningBuckets.urgent} advisory={warningBuckets.advisory} />

      <div className="rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <div className="font-semibold">発表区域について</div>
        <div className="mt-1 text-xs leading-relaxed">
          警報・注意報は地域ごとに発表されます。必要に応じて発表区域と市区町村・詳細区域を切り替えて確認してください。
        </div>
      </div>

      <DataFetchDetails
        status={status?.fetchStatus ?? 'PENDING'}
        updatedAt={status?.updatedAt}
        fetchStatus={warnings?.fetchStatus ?? 'PENDING'}
        error={warnings?.lastError ?? status?.lastError}
      />
    </div >
  );
}

function WarningGroupSection({
  title,
  groups,
  hidden,
}: {
  title: string;
  groups: WarningGroup[];
  hidden?: boolean;
}) {
  if (hidden) return null;
  if (!groups || groups.length === 0) return null;

  const sorted = [...groups].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
    if (a.count !== b.count) return b.count - a.count;
    return a.kind.localeCompare(b.kind);
  });

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <div className="text-xs text-gray-600">{sorted.length}種類</div>
      </div>
      <ul className="mt-2 space-y-2">
        {sorted.map((g) => (
          <li key={g.key} className="rounded-2xl border bg-gray-50 px-3 py-2 text-sm break-words">
            <div className="font-semibold break-words">{g.kind}</div>
            {g.statuses.length > 0 && <div className="mt-1 text-xs text-gray-600 break-words">状態: {g.statuses.join(' / ')}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Phenomenon color mapping (Tailwind classes)
const PHENOMENON_COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  '雷': { bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-800' },
  '落雷': { bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-800' },
  '濃霧': { bg: 'bg-sky-100', border: 'border-sky-300', text: 'text-sky-800' },
  '大雨': { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-800' },
  '洪水': { bg: 'bg-teal-100', border: 'border-teal-400', text: 'text-teal-800' },
  '強風': { bg: 'bg-green-100', border: 'border-green-400', text: 'text-green-800' },
  '暴風': { bg: 'bg-green-100', border: 'border-green-400', text: 'text-green-800' },
  '大雪': { bg: 'bg-slate-100', border: 'border-slate-400', text: 'text-slate-700' },
  '暴風雪': { bg: 'bg-slate-100', border: 'border-slate-400', text: 'text-slate-700' },
  '波浪': { bg: 'bg-cyan-100', border: 'border-cyan-400', text: 'text-cyan-800' },
  '高潮': { bg: 'bg-indigo-100', border: 'border-indigo-400', text: 'text-indigo-800' },
};

const DEFAULT_PHENOMENON_COLOR = { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-700' };

// Phenomenon info mapping
const PHENOMENON_INFO: Record<string, { description: string; action: string }> = {
  '雷': {
    description: '雷雲が発達し、落雷や突風、急な強い雨が起こることがあります。',
    action: '屋外では開けた場所を避け建物内へ。金属製品から離れてください。',
  },
  '落雷': {
    description: '雷雲が発達し、落雷や突風、急な強い雨が起こることがあります。',
    action: '屋外では開けた場所を避け建物内へ。金属製品から離れてください。',
  },
  '濃霧': {
    description: '視界が著しく悪化し、交通に影響が出ることがあります。',
    action: '運転は速度を落としてライト点灯。交通情報を確認してください。',
  },
  '大雨': {
    description: '雨量が増え、浸水や土砂災害の危険が高まります。',
    action: '低地・地下を避け、河川に近づかない。避難情報に注意。',
  },
  '洪水': {
    description: '河川の増水により氾濫の恐れがあります。',
    action: '川沿いを避け高い場所へ。避難指示が出たら速やかに行動。',
  },
  '強風': {
    description: '強い風が吹き、飛来物や転倒の危険があります。',
    action: '屋外では飛来物に注意。看板や木の近くを避けてください。',
  },
  '暴風': {
    description: '非常に強い風が吹き、重大な被害の恐れがあります。',
    action: '外出を控え、窓から離れてください。飛来物に厳重注意。',
  },
  '大雪': {
    description: '大量の降雪により交通障害や建物被害の恐れがあります。',
    action: '不要な外出を控え、除雪作業に注意。停電に備えてください。',
  },
  '波浪': {
    description: '高い波が発生し、海岸付近での危険が高まります。',
    action: '海岸や堤防に近づかないでください。',
  },
  '高潮': {
    description: '潮位が異常に上昇し、浸水の恐れがあります。',
    action: '海岸や河口から離れ、高い場所へ避難してください。',
  },
};

const DEFAULT_PHENOMENON_INFO = {
  description: '気象状況が悪化する可能性があります。',
  action: '自治体・気象庁の最新情報を確認してください。',
};

// Helper: extract phenomenon from kind name by stripping suffixes
function extractPhenomenon(kind: string): string {
  // Remove suffixes: 特別警報, 警報, 注意報, 情報
  let ph = kind.replace(/(特別警報|警報|注意報|情報)$/, '');
  // Normalize 落雷 to 雷
  if (ph === '落雷') ph = '雷';
  return ph;
}

function GuidanceSection({ urgent, advisory }: { urgent: WarningGroup[]; advisory: WarningGroup[] }) {
  // const [isOpen, setIsOpen] = useState(false); // Removed per request

  // Extract unique phenomena from active alerts, preserving order of appearance
  const activePhenomena = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const g of [...urgent, ...advisory]) {
      const ph = extractPhenomenon(g.kind);
      // Normalize 雷/落雷 to same key
      const key = ph === '落雷' ? '雷' : ph;
      if (!seen.has(key) && key) {
        seen.add(key);
        result.push(key);
      }
    }
    return result;
  }, [urgent, advisory]);

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">行動の目安</h2>
      </div>

      <div className="mt-4 space-y-4">
        <div className="rounded-xl bg-gray-50 p-4 text-sm space-y-2">
          <div><span className="font-bold text-gray-900 border-b-2 border-amber-300">注意報</span>: 災害が起こるおそれがある場合に発表されます。</div>
          <div><span className="font-bold text-red-800 border-b-2 border-red-300">警報</span>: 重大な災害が起こるおそれがある場合に発表されます。</div>
          <div><span className="font-bold text-purple-900 border-b-2 border-purple-300">特別警報</span>: 予想をはるかに超える現象です。直ちに命を守る行動をとってください。</div>

          {/* Phenomenon-specific blocks */}
          {activePhenomena.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
              {activePhenomena.map((ph) => {
                const color = PHENOMENON_COLOR_MAP[ph] ?? DEFAULT_PHENOMENON_COLOR;
                const info = PHENOMENON_INFO[ph] ?? DEFAULT_PHENOMENON_INFO;
                return (
                  <div key={ph} className="flex items-start gap-2 text-sm">
                    <span className={classNames('shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold border', color.bg, color.border, color.text)}>
                      {ph}
                    </span>
                    <div className="min-w-0">
                      <div className="text-gray-700 leading-snug"><span className="font-medium text-gray-600">説明:</span> {info.description}</div>
                      <div className="text-gray-700 leading-snug"><span className="font-medium text-gray-600">対応:</span> {info.action}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </section>
  );
}

function SubAreaBreakdown({
  breakdown,
  class20Groups,
  highlightCode,
  tokyoGroup,
  parentCode,
  exactCode,
}: {
  breakdown: Record<string, { name: string; items: any[] }>;
  class20Groups?: Record<
    string,
    {
      name: string;
      parentCode?: string | null;
      parentName?: string | null;
      class10Code?: string | null;
      class10Name?: string | null;
      items: any[];
    }
  > | null;
  highlightCode?: string | null;
  tokyoGroup?: TokyoGroupKey | null;
  parentCode?: string | null;
  exactCode?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const class20Items = class20Groups
    ? Object.entries(class20Groups)
        .filter(([code, data]) => {
          if (exactCode) return code === exactCode;
          if (parentCode) return data.parentCode === parentCode || data.class10Code === parentCode;
          if (tokyoGroup) return matchesTokyoGroup(code, tokyoGroup);
          return true;
        })
        .map(([code, data]) => {
          const activeItems = deduplicateWarnings(
            data.items.filter((i: any) => {
              const s = i.status || '';
              return !s.includes('解除') && !s.includes('なし') && !s.includes('ありません');
            })
          );
          return { code, ...data, items: activeItems };
        })
        .filter((area) => area.items.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name, 'ja') || a.code.localeCompare(b.code))
    : [];

  if (class20Items.length > 0) {
    return (
      <div>
        <h3 className="font-bold text-gray-800">市区町村ごとの警報・注意報</h3>
        <p className="mt-1 text-xs text-gray-600">警報・注意報が発表されている地域を表示しています。</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {class20Items.map((area) => (
            <div key={area.code} className="rounded-lg border bg-white p-3 text-sm">
              <div className="font-bold flex items-center justify-between gap-2">
                <span>{area.name}</span>
                <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-800">
                  {area.items.length}
                </span>
              </div>
              {area.parentName && <div className="mt-1 text-xs text-gray-500">{area.parentName}</div>}
              <div className="mt-2 flex flex-wrap gap-1">
                {area.items.map((it: any) => (
                  <span key={it.id ?? `${area.code}-${it.kind}`} className="rounded border bg-white px-1.5 py-0.5 text-xs text-gray-700">
                    {it.kind}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Sort: highlighted first, then by code
  // Also filter by Tokyo scope if applicable
  const items = Object.entries(breakdown)
    .filter(([code]) => (parentCode ? code === parentCode : exactCode ? code === exactCode : matchesTokyoGroup(code, tokyoGroup ?? null)))
    .sort((a, b) => {
      if (highlightCode) {
        if (a[0] === highlightCode) return -1;
        if (b[0] === highlightCode) return 1;
      }
      return a[0].localeCompare(b[0]);
    });

  const hasContent = items.some(([, d]) => d.items.length > 0);
  if (!hasContent) return null;

  return (
    <div>
      <button
        className="flex w-full items-center justify-between group"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <h3 className="font-bold text-gray-800 group-hover:text-blue-700 transition-colors">発表区域（予報区）ごとの内訳</h3>
        <span className={classNames("text-gray-400 transition-transform", isOpen ? "rotate-180" : "rotate-0")}>
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {highlightCode && (
            <div className="text-xs text-blue-800 bg-blue-50 px-2 py-1 rounded inline-block">
              選択した市区町村に対応する発表区域を強調表示しています（境界は一致しない場合あり）。
            </div>
          )}

          <div className="grid gap-2 md:grid-cols-2">
            {items.map(([code, data]) => {
              const isHighlighted = code === highlightCode;
              const activeItems = data.items.filter((i: any) => {
                const s = i.status || '';
                return !s.includes('解除') && !s.includes('なし') && !s.includes('ありません');
              });

              // Robust deduplication
              const dedupedItems = deduplicateWarnings(activeItems);
              const hasActive = dedupedItems.length > 0;

              if (!hasActive && !isHighlighted) return null;

              return (
                <div
                  key={code}
                  className={classNames(
                    'rounded-lg border p-3 text-sm',
                    isHighlighted ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-300' : 'bg-white'
                  )}
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>{data.name}</span>
                    {hasActive ? (
                      <span className="text-xs font-normal bg-red-100 text-red-800 px-1.5 py-0.5 rounded-full">
                        {dedupedItems.length}
                      </span>
                    ) : (
                      <span className="text-xs font-normal text-gray-400">発表なし</span>
                    )}
                  </div>
                  {hasActive && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {dedupedItems.map((it: any) => (
                        <span key={it.id ?? it.kind} className="text-xs border px-1.5 py-0.5 rounded bg-white text-gray-700">
                          {it.kind}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
