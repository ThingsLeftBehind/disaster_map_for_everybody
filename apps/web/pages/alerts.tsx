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
  return getTokyoGroupFromAreaCode(areaCode) === group;
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

  const { device, selectedArea, selectedJmaAreaCode, currentJmaAreaCode, coarseArea, setSelectedAreaId, setCoarseArea } = useDevice();
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const { label: coarseAreaLabel } = useAreaName({ prefCode: coarseArea?.prefCode ?? null, muniCode: coarseArea?.muniCode ?? null });

  const { data: status } = useSWR('/api/jma/status', fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });

  const [useCurrent, setUseCurrent] = useState(true);
  const [manualPrefCode, setManualPrefCode] = useState('');
  const [manualSubAreaCode, setManualSubAreaCode] = useState('');

  const [actionBusy, setActionBusy] = useState(false);
  const lastActionRef = useRef(0);

  const { data: prefecturesData } = useSWR('/api/ref/municipalities', fetcher, { dedupingInterval: 60_000 });
  const prefectures: Array<{ prefCode: string; prefName: string }> = prefecturesData?.prefectures ?? [];
  const manualPrefName = useMemo(
    () => prefectures.find((p) => p.prefCode === manualPrefCode)?.prefName ?? null,
    [manualPrefCode, prefectures]
  );
  const manualPrefLabel = manualPrefName ?? (manualPrefCode ? '選択中' : null);

  const manualAreaCode = manualPrefCode ? `${manualPrefCode}0000` : null;
  const effectiveAreaCode = useCurrent ? currentJmaAreaCode : manualAreaCode ?? selectedJmaAreaCode;
  const activeMuniCode = useCurrent ? coarseArea?.muniCode : manualPrefCode ? null : selectedArea?.muniCode;
  const class20 = toJmaClass20(activeMuniCode ?? null);
  const warningsUrl = effectiveAreaCode
    ? `/api/jma/warnings?area=${effectiveAreaCode}${class20 ? `&class20=${class20}` : ''}`
    : null;
  const { data: warnings, mutate: mutateWarnings } = useSWR(warningsUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const areaContext = useMemo(() => {
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
    useCurrent,
  ]);

  const breakdown = (warnings as any)?.breakdown as Record<string, { name: string; items: any[] }> | null;
  const muniMap = (warnings as any)?.muniMap as Record<string, string> | null;
  const subAreaOptions = useMemo(() => {
    if (!breakdown) return [] as Array<{ code: string; name: string }>;
    return Object.entries(breakdown)
      .map(([code, data]) => ({ code, name: data.name || code }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [breakdown]);

  useEffect(() => {
    if (useCurrent || !manualPrefCode) {
      setManualSubAreaCode('');
      return;
    }
    if (manualPrefCode === '13') {
      setManualSubAreaCode((current) => current || '130010');
      return;
    }
    if (subAreaOptions.length > 0 && !subAreaOptions.some((area) => area.code === manualSubAreaCode)) {
      setManualSubAreaCode(subAreaOptions[0].code);
    }
  }, [manualPrefCode, manualSubAreaCode, subAreaOptions, useCurrent]);

  const selectedSubArea = manualSubAreaCode && breakdown?.[manualSubAreaCode] ? breakdown[manualSubAreaCode] : null;
  const scopedWarnings = useMemo(() => {
    if (!selectedSubArea) return warnings;
    return {
      ...(warnings ?? {}),
      items: selectedSubArea.items,
      tokyoGroups: null,
    };
  }, [selectedSubArea, warnings]);

  const warningShape = useMemo(
    () =>
      shapeAlertWarnings({
        warnings: scopedWarnings,
        area: selectedSubArea
          ? { prefCode: manualPrefCode || areaContext.prefCode, muniCode: null, label: selectedSubArea.name }
          : areaContext,
      }),
    [areaContext, manualPrefCode, scopedWarnings, selectedSubArea]
  );

  const warningBuckets = warningShape.buckets;
  const warningCounts = warningShape.counts;
  const tokyoGroupFilter = warningShape.isTokyoArea ? warningShape.tokyoGroup : null;
  const selectedSubTokyoGroup = selectedSubArea ? getTokyoGroupFromAreaCode(manualSubAreaCode) : null;
  const tokyoContextFromMuni = getTokyoContextFromMuniCode(areaContext.muniCode ?? null);
  const tokyoContext = tokyoGroupFilter
    ? getTokyoContextFromGroup(tokyoGroupFilter)
    : selectedSubTokyoGroup
      ? getTokyoContextFromGroup(selectedSubTokyoGroup)
      : tokyoContextFromMuni;
  const tokyoScopeLabel = tokyoContext === 'MAINLAND' ? '東京都' : tokyoContext === 'ISLANDS' ? '東京都（島しょ）' : null;
  const showTokyoSubAreaSelector = effectiveAreaCode === '130000' && subAreaOptions.length > 0;
  const tokyoMainlandDefault = subAreaOptions.some((area) => area.code === '130010') ? '130010' : subAreaOptions[0]?.code ?? '';
  const tokyoSubAreaValue = selectedSubArea ? manualSubAreaCode : tokyoMainlandDefault;

  const targetLabel = useCurrent
    ? currentJmaAreaCode
      ? coarseAreaLabel
        ? `現在地: ${coarseAreaLabel}`
        : '現在地: エリア未確定'
      : '現在地: エリア未確定'
    : manualPrefLabel
      ? `手動: ${manualPrefLabel}${selectedSubArea ? ` / ${selectedSubArea.name}` : ''}`
      : selectedArea
        ? `選択エリア: ${formatPrefMuniLabel({ prefName: selectedArea.prefName, muniName: selectedArea.muniName ?? null }) ?? selectedArea.prefName}`
        : 'エリア未確定';

  const targetForecastCode = activeMuniCode && muniMap ? muniMap[activeMuniCode] : null;
  const highlightedForecastCode = selectedSubArea ? manualSubAreaCode : targetForecastCode;

  const activeAreas = useMemo(() => {
    if (!breakdown) return [];
    return Object.entries(breakdown)
      .map(([code, data]) => {
        if (selectedSubArea && code !== manualSubAreaCode) return null;
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
  }, [breakdown, manualSubAreaCode, selectedSubArea, tokyoGroupFilter]);

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
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-600">対象エリア</div>
                <div className="mt-1 font-semibold">{targetLabel}</div>
              </div>
              {useCurrent ? (
                <button
                  className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-300"
                  onClick={() => {
                    if (useCurrent) {
                      setUseCurrent(false);
                      return;
                    }
                  }}
                  disabled={actionBusy}
                >
                  現在地を解除
                </button>
              ) : (
                <button
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  onClick={() => {
                    if (!beginAction()) return;
                    navigator.geolocation.getCurrentPosition(
                      async (pos) => {
                        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                        saveLastLocation(next);
                        try {
                          const r = await reverseGeocodeGsi(next);
                          setCoarseArea({ prefCode: r.prefCode, muniCode: r.muniCode, address: r.address });
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
                  }}
                  disabled={actionBusy}
                >
                  現在地で表示
                </button>
              )}
            </div>

            <div className="mt-2 text-xs text-gray-600">位置情報は端末内でのみ利用されます。</div>
          </div>

          <div className="rounded-2xl border bg-gray-50 p-4 md:col-span-2">
            <div className="text-xs text-gray-600">エリア選択</div>
            <div className="mt-2 space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <select
                  className="w-full rounded border px-3 py-2 md:w-auto"
                  aria-label="都道府県を選択"
                  value={manualPrefCode}
                  onChange={(e) => {
                    setUseCurrent(false);
                    setSelectedAreaId(null); // Clear myarea selection if pref selected manual
                    setManualPrefCode(e.target.value);
                    setManualSubAreaCode('');
                  }}
                >
                  <option value="">都道府県を選択</option>
                  {prefectures.map((p) => (
                    <option key={p.prefCode} value={p.prefCode}>
                      {p.prefName}
                    </option>
                  ))}
                </select>

                {manualPrefCode && manualPrefCode !== '13' && subAreaOptions.length > 0 && !useCurrent && (
                  <select
                    className="w-full rounded border px-3 py-2 md:w-auto"
                    value={manualSubAreaCode}
                    onChange={(e) => setManualSubAreaCode(e.target.value)}
                    aria-label="気象庁の発表区域"
                  >
                    {subAreaOptions.map((area) => (
                      <option key={area.code} value={area.code}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  className="rounded-xl bg-white px-4 py-2 font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
                  onClick={async () => {
                    if (!beginAction()) return;
                    if (!selectedArea && !manualPrefCode) {
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

              {manualPrefCode && manualPrefCode !== '13' && subAreaOptions.length > 0 && !useCurrent && (
                <div className="text-xs text-gray-600">
                  表示単位: 気象庁の一次細分区域。東京都は初期表示を東京地方（本土側）にしています。
                </div>
              )}

              {showTokyoSubAreaSelector && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3">
                  <label className="block text-xs font-semibold text-blue-950" htmlFor="tokyo-subarea-select">
                    東京都の発表区域
                  </label>
                  <select
                    id="tokyo-subarea-select"
                    className="mt-2 w-full rounded border border-blue-200 bg-white px-3 py-2 text-sm md:w-auto"
                    value={tokyoSubAreaValue}
                    onChange={(e) => {
                      setUseCurrent(false);
                      setSelectedAreaId(null);
                      setManualPrefCode('13');
                      setManualSubAreaCode(e.target.value);
                    }}
                  >
                    {subAreaOptions.map((area) => (
                      <option key={area.code} value={area.code}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                  <div className="mt-2 text-xs text-blue-900">
                    初期表示は東京地方です。島しょ部は必要な区域を明示的に選んで表示します。
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Note moved to bottom */}
      </section >

      <section className="space-y-6">
        <MyAreaWarningsSection />

        <div className="rounded-2xl bg-white p-5 shadow">

          {warningsUrl && !warnings && <div className="mt-3 text-sm text-gray-600">読み込み中...</div>}
          {!warningsUrl && <div className="mt-3 text-sm text-gray-600">エリアを確定すると表示されます。</div>}

          {shouldShowUnstable({ status, warnings }) && (
            <div className="mt-3 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="font-semibold">取得が不安定</div>
              <div className="mt-1 text-xs">通信状況により遅延/欠落の可能性があります。直近のデータを表示中です。</div>
            </div>
          )}

          {warnings && (
            <>
              <div className="mt-2 text-sm text-gray-700">
                {warningCounts.total > 0
                  ? `${warningCounts.total}種類`
                  : '該当なし'}
              </div>

              {/* Checkbox removed per request */}

              <div className="mt-4 space-y-4">
                <WarningGroupSection title="緊急（警報/特別警報）" groups={warningBuckets.urgent} />
                <WarningGroupSection title="注意報" groups={warningBuckets.advisory} />
                {/* Reference info always hidden or removed? User said remove checkbox. 
                  But also 'Dedupe per area card...'. 
                  If we want to show reference (possibility etc), user didn't explicitly say "Show reference always".
                  They said "Remove '参考情報も表示する' checkbox entirely".
                  Usually implies default behavior or always visible?
                  "Important things top... (possibility etc default hidden)" text at line 294 suggests hidden.
                  Task says "Remove checkbox entirely". 
                  Implementation: I will omit Reference section unless it was intended to be always shown.
                  Given "行動の目安 must ALWAYS be expanded", maybe reference info too?
                  Use judgement: The checkbox toggled visibility. If removed, we either never show or always show.
                  Given it's "Reference" (Series/Potential), usually clutter. I'll hide it.
              */}
              </div>

              {breakdown && (
                <div className="mt-6 border-t pt-4">
                  <SubAreaBreakdown
                    breakdown={breakdown}
                    highlightCode={highlightedForecastCode}
                    tokyoGroup={tokyoGroupFilter}
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
          気象庁の警報・注意報は『予報区（一次細分区域）』などの区域単位で発表されます。市区町村の境界と一致しない場合があります。
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
  highlightCode,
  tokyoGroup,
}: {
  breakdown: Record<string, { name: string; items: any[] }>;
  highlightCode?: string | null;
  tokyoGroup?: TokyoGroupKey | null;
}) {
  // Sort: highlighted first, then by code
  // Also filter by Tokyo scope if applicable
  const items = Object.entries(breakdown)
    .filter(([code]) => matchesTokyoGroup(code, tokyoGroup ?? null))
    .sort((a, b) => {
      if (highlightCode) {
        if (a[0] === highlightCode) return -1;
        if (b[0] === highlightCode) return 1;
      }
      return a[0].localeCompare(b[0]);
    });

  const [isOpen, setIsOpen] = useState(false);

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
