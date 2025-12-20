import Head from 'next/head';
import useSWR from 'swr';
import { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { useDevice } from '../components/device/DeviceProvider';
import { loadLastLocation, reverseGeocodeGsi, saveLastLocation, type Coords } from '../lib/client/location';
import { getJmaWarningPriority, type JmaWarningPriority } from '../lib/jma/filters';
import { formatPrefMuniLabel, useAreaName } from '../lib/client/areaName';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '未取得';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return '未取得';
  return new Date(t).toLocaleString();
}

type WarningItem = { id: string; kind: string; status: string | null; source: string };

type WarningGroup = {
  kind: string;
  count: number;
  statuses: string[];
  priority: JmaWarningPriority;
};

type TokyoGroupKey = 'mainland' | 'izu' | 'ogasawara';
type TokyoGroups = Partial<Record<TokyoGroupKey, { label: string; items: WarningItem[] }>>;

const PRIORITY_RANK: Record<JmaWarningPriority, number> = { URGENT: 2, ADVISORY: 1, REFERENCE: 0 };

function maxPriority(a: JmaWarningPriority, b: JmaWarningPriority): JmaWarningPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

function priorityFromStatus(status: string | null | undefined): JmaWarningPriority | null {
  const s = String(status ?? '').trim();
  if (!s) return null;
  if (/(特別警報|警報)/.test(s) && !/注意報/.test(s)) return 'URGENT';
  if (/注意報/.test(s)) return 'ADVISORY';
  if (/(特別警報|警報)/.test(s)) return 'URGENT';
  return null;
}

function groupWarnings(items: WarningItem[]): WarningGroup[] {
  const map = new Map<string, WarningGroup>();
  for (const it of items) {
    const kind = String(it.kind ?? '').trim();
    if (!kind) continue;
    const base = getJmaWarningPriority(kind);
    const statusPriority = priorityFromStatus(it.status);
    const itemPriority = statusPriority ? maxPriority(base, statusPriority) : base;

    const existing = map.get(kind);
    if (!existing) {
      map.set(kind, {
        kind,
        count: 1,
        statuses: it.status ? [it.status] : [],
        priority: itemPriority,
      });
      continue;
    }
    existing.count += 1;
    if (it.status && !existing.statuses.includes(it.status)) existing.statuses.push(it.status);
    existing.priority = maxPriority(existing.priority, itemPriority);
  }
  return Array.from(map.values());
}

function buildWarningBuckets(items: WarningItem[]): {
  urgent: WarningGroup[];
  advisory: WarningGroup[];
  reference: WarningGroup[];
} {
  const grouped = groupWarnings(items);
  return {
    urgent: grouped.filter((g) => g.priority === 'URGENT'),
    advisory: grouped.filter((g) => g.priority === 'ADVISORY'),
    reference: grouped.filter((g) => g.priority === 'REFERENCE'),
  };
}

function inferTokyoGroup(coords: Coords | null, label: string | null | undefined): TokyoGroupKey | null {
  if (label) {
    if (label.includes('小笠原')) return 'ogasawara';
    if (label.includes('伊豆')) return 'izu';
  }
  if (!coords) return null;
  const { lat, lon } = coords;
  if (lat < 28.5 && lon >= 141.0 && lon <= 143.5) return 'ogasawara';
  if (lat >= 32.0 && lat <= 34.5 && lon >= 138.5 && lon <= 140.6) return 'izu';
  return 'mainland';
}

function sanitizeFetchError(message: string | null | undefined): string {
  return message ? '取得エラー' : 'なし';
}

export default function AlertsPage() {
  const { device, selectedArea, selectedJmaAreaCode, currentJmaAreaCode, coarseArea, setSelectedAreaId, setCoarseArea } = useDevice();
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const { label: coarseAreaLabel } = useAreaName({ prefCode: coarseArea?.prefCode ?? null, muniCode: coarseArea?.muniCode ?? null });

  const { data: status } = useSWR('/api/jma/status', fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });

  const [useCurrent, setUseCurrent] = useState(false);
  const [manualPrefCode, setManualPrefCode] = useState('');
  const [showReference, setShowReference] = useState(false);
  const [lastCoords, setLastCoords] = useState<Coords | null>(null);
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
  const effectiveAreaCode = useCurrent ? currentJmaAreaCode : selectedJmaAreaCode ?? manualAreaCode;
  const warningsUrl = effectiveAreaCode ? `/api/jma/warnings?area=${effectiveAreaCode}` : null;
  const { data: warnings, mutate: mutateWarnings } = useSWR(warningsUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });

  const items: WarningItem[] = warnings?.items ?? [];
  const tokyoGroups = (warnings?.tokyoGroups as TokyoGroups | null) ?? null;
  const isTokyoArea = Boolean(tokyoGroups && warnings?.area === '130000');
  const inferredTokyoGroup = inferTokyoGroup(lastCoords, coarseAreaLabel);
  const primaryTokyoGroup: TokyoGroupKey = inferredTokyoGroup ?? 'mainland';
  const primaryItems = useMemo(() => {
    if (!isTokyoArea || !tokyoGroups) return items;
    const primary = tokyoGroups[primaryTokyoGroup]?.items ?? [];
    const groupKeys = new Set(
      Object.values(tokyoGroups ?? {})
        .flatMap((g) => g.items ?? [])
        .map((it) => `${it.kind}|${it.status ?? ''}`)
    );
    const ungrouped = items.filter((it) => !groupKeys.has(`${it.kind}|${it.status ?? ''}`));
    return [...primary, ...ungrouped];
  }, [isTokyoArea, items, primaryTokyoGroup, tokyoGroups]);
  const primaryBuckets = useMemo(() => buildWarningBuckets(primaryItems), [primaryItems]);

  const urgentCount = primaryBuckets.urgent.length;
  const advisoryCount = primaryBuckets.advisory.length;

  const targetLabel = useCurrent
    ? currentJmaAreaCode
      ? coarseAreaLabel
        ? `現在地: ${coarseAreaLabel}`
        : '現在地: エリア未確定'
      : '現在地: エリア未確定'
    : selectedArea
      ? `選択エリア: ${formatPrefMuniLabel({ prefName: selectedArea.prefName, muniName: selectedArea.muniName ?? null }) ?? selectedArea.prefName}`
      : manualPrefLabel
        ? `手動: ${manualPrefLabel}`
        : 'エリア未確定';

  const confidenceNotes: string[] = Array.isArray(warnings?.confidenceNotes) ? warnings.confidenceNotes : [];
  const hasPrefOnlyNote = confidenceNotes.some((n) => /prefecture-level/i.test(n));
  const hasTitleFallbackNote = confidenceNotes.some((n) => /Atom entry titles/i.test(n));
  const showAccuracyNote = Boolean(warningsUrl && (hasPrefOnlyNote || hasTitleFallbackNote));
  const errorLabel = sanitizeFetchError(warnings?.lastError ?? status?.lastError);

  useEffect(() => {
    try {
      const last = loadLastLocation();
      if (last) setLastCoords(last);
    } catch {
      setLastCoords(null);
    }
  }, []);

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
      <Head>
        <title>警報・注意報 | 全国避難場所ファインダー</title>
      </Head>

      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">警報・注意報</h1>
            <div className="mt-1 text-sm text-gray-600">重要なものを上から表示します（可能性・定時などはデフォルト非表示）。</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={classNames(
                'rounded-full px-3 py-1 text-xs font-bold ring-1',
                urgentCount > 0 ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-gray-50 text-gray-800 ring-gray-200'
              )}
            >
              警報 {urgentCount}
            </span>
            <span
              className={classNames(
                'rounded-full px-3 py-1 text-xs font-bold ring-1',
                advisoryCount > 0 ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-gray-50 text-gray-800 ring-gray-200'
              )}
            >
              注意報 {advisoryCount}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-2xl border bg-gray-50 p-4">
            <div className="text-xs text-gray-600">対象エリア</div>
            <div className="mt-1 font-semibold">{targetLabel}</div>
            <div className="mt-2 text-xs text-gray-600">位置情報は端末内でのみ利用されます。</div>
          </div>

          <div className="rounded-2xl border bg-gray-50 p-4 md:col-span-2">
            <div className="text-xs text-gray-600">エリア選択</div>
            <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
              {(device?.savedAreas ?? []).length > 0 ? (
                <select
                  className="w-full rounded border px-3 py-2 md:w-auto"
                  value={selectedArea?.id ?? ''}
                  onChange={(e) => {
                    setUseCurrent(false);
                    setSelectedAreaId(e.target.value || null);
                  }}
                >
                  {(device?.savedAreas ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.prefName}
                      {a.muniName ? ` ${a.muniName}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="w-full rounded border px-3 py-2 md:w-auto"
                  value={manualPrefCode}
                  onChange={(e) => {
                    setUseCurrent(false);
                    setManualPrefCode(e.target.value);
                  }}
                >
                  <option value="">都道府県を選択</option>
                  {prefectures.map((p) => (
                    <option key={p.prefCode} value={p.prefCode}>
                      {p.prefName}
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

              <button
                className="rounded-xl bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-black"
                onClick={() => {
                  if (!beginAction()) return;
                  navigator.geolocation.getCurrentPosition(
                    async (pos) => {
                      const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                      saveLastLocation(next);
                      setLastCoords(next);
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
            </div>

            {!warningsUrl && (
              <div className="mt-3 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <div className="font-semibold">エリア未確定</div>
                <div className="mt-1 text-xs">保存エリアを選ぶか、手動で都道府県を選択してください（誤った都道府県に自動設定しません）。</div>
              </div>
            )}
          </div>
        </div>

        {showAccuracyNote && (
          <div className="mt-3 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="font-semibold">精度に注意</div>
            <div className="mt-1 text-xs">
              {hasPrefOnlyNote && <span>都道府県単位の取得です（市区町村レベルの一致ではありません）。 </span>}
              {hasTitleFallbackNote && <span>一部は見出し情報からの簡易抽出です（詳細は公式情報を確認）。</span>}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">いま出ている情報</h2>
        {warningsUrl && !warnings && <div className="mt-3 text-sm text-gray-600">読み込み中...</div>}
        {!warningsUrl && <div className="mt-3 text-sm text-gray-600">エリアを確定すると表示されます。</div>}

        {warnings?.fetchStatus && warnings.fetchStatus !== 'OK' && (
          <div className="mt-3 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="font-semibold">取得が不安定</div>
            <div className="mt-1 text-xs">通信状況により遅延/欠落の可能性があります。直近のデータを表示中です。</div>
          </div>
        )}

        {warnings && (
          <>
            <div className="mt-2 text-sm text-gray-700">
              {primaryBuckets.urgent.length + primaryBuckets.advisory.length + (showReference ? primaryBuckets.reference.length : 0) > 0
                ? `${primaryBuckets.urgent.length + primaryBuckets.advisory.length + (showReference ? primaryBuckets.reference.length : 0)}種類`
                : '該当なし'}
              {!showReference && primaryBuckets.reference.length > 0 && (
                <span className="ml-2 text-xs text-gray-500">（参考 {primaryBuckets.reference.length}種類を非表示）</span>
              )}
            </div>

            {isTokyoArea && tokyoGroups && (
              <div className="mt-2 text-xs text-gray-600">
                優先表示: {tokyoGroups[primaryTokyoGroup]?.label ?? '（島しょ除く）'}（他エリアは下に表示）
              </div>
            )}

            {primaryBuckets.reference.length > 0 && (
              <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)} />
                <span>参考情報も表示する（可能性・定時など）</span>
              </label>
            )}

            <div className="mt-4 space-y-4">
              <WarningGroupSection title="緊急（警報/特別警報）" groups={primaryBuckets.urgent} />
              <WarningGroupSection title="注意報" groups={primaryBuckets.advisory} />
              <WarningGroupSection title="参考/可能性/定時" groups={primaryBuckets.reference} hidden={!showReference} />
            </div>

            {isTokyoArea && tokyoGroups && (
              <div className="mt-4 space-y-3">
                {(Object.keys(tokyoGroups) as TokyoGroupKey[])
                  .filter((key) => key !== primaryTokyoGroup)
                  .map((key) => {
                    const sectionItems: WarningItem[] = tokyoGroups[key]?.items ?? [];
                    const buckets = buildWarningBuckets(sectionItems);
                    const count = buckets.urgent.length + buckets.advisory.length + (showReference ? buckets.reference.length : 0);
                    return (
                      <details key={key} className="rounded-xl border bg-gray-50 px-3 py-2">
                        <summary className="cursor-pointer text-sm font-semibold text-gray-800">
                          {tokyoGroups[key]?.label ?? 'エリア別'}（{count > 0 ? `${count}種類` : '該当なし'}）
                        </summary>
                        <div className="mt-3 space-y-4">
                          <WarningGroupSection title="緊急（警報/特別警報）" groups={buckets.urgent} />
                          <WarningGroupSection title="注意報" groups={buckets.advisory} />
                          <WarningGroupSection title="参考/可能性/定時" groups={buckets.reference} hidden={!showReference} />
                        </div>
                      </details>
                    );
                  })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">データの取得</h2>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">全体</div>
            <div className="mt-1 font-semibold">{status?.fetchStatus ?? 'DEGRADED'}</div>
            <div className="mt-1 text-xs text-gray-600">更新: {formatUpdatedAt(status?.updatedAt)}</div>
          </div>
          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">対象エリア</div>
            <div className="mt-1 font-semibold">{warnings?.fetchStatus ?? 'DEGRADED'}</div>
            <div className="mt-1 text-xs text-gray-600">更新: {formatUpdatedAt(warnings?.updatedAt)}</div>
          </div>
          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">エラー</div>
            <div className="mt-1 text-xs text-gray-700">{errorLabel}</div>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-600">取得に失敗しても、直近のデータがあれば表示します（ネットワーク状況により遅延/欠落があり得ます）。</div>
      </section>

      <section className="rounded-2xl border bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold">注意</div>
        <div className="mt-1">表示は遅延や欠落があり得ます。避難判断は必ず自治体・気象庁など公式情報を優先してください。</div>
      </section>
    </div>
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
          <li key={g.kind} className="rounded-2xl border bg-gray-50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{g.kind}</div>
              {g.count > 1 && <span className="rounded bg-white px-2 py-1 text-xs text-gray-700">×{g.count}</span>}
            </div>
            {g.statuses.length > 0 && <div className="mt-1 text-xs text-gray-600">状態: {g.statuses.join(' / ')}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
