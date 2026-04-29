import { Seo } from '../components/Seo';
import useSWR from 'swr';
import { useMemo, useState } from 'react';
import { useDevice } from '../components/device/DeviceProvider';
import { DataFetchDetails } from '../components/DataFetchDetails';
import dynamic from 'next/dynamic';

const QuakeMonitorMap = dynamic(() => import('../components/QuakeMonitorMap'), {
  ssr: false,
  loading: () => <div className="h-[360px] animate-pulse rounded-xl border bg-gray-100" />,
});

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '確認中';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return '確認中';
  return new Date(t).toLocaleString();
}

function formatEventTime(time: string | null | undefined): string {
  if (!time) return '不明';
  const t = Date.parse(time);
  if (Number.isNaN(t)) return normalizeFullWidthDigits(String(time).trim()) || '不明';
  return new Date(t).toLocaleString();
}

function normalizeFullWidthDigits(input: string): string {
  return input.replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch)));
}

function parseMaxIntensityRaw(raw: string | null | undefined): { label: string; score: number } | null {
  if (!raw) return null;
  const t = normalizeFullWidthDigits(String(raw).trim());
  if (!t) return null;
  const m = t.match(/([0-7])\s*([+\-]|弱|強)?/);
  if (!m) return null;

  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;

  const mod = (m[2] ?? '').trim();
  if (!mod) return { label: String(base), score: base };
  if (mod === '-' || mod === '弱') return { label: `${base}弱`, score: base };
  if (mod === '+' || mod === '強') return { label: `${base}強`, score: base + 0.5 };
  return { label: `${base}${mod}`, score: base };
}

function parseMaxIntensityFromTitle(title: string): { label: string; score: number } | null {
  const t = normalizeFullWidthDigits(title ?? '');
  const m = t.match(/最大震度\s*([0-7])\s*([+\-]|弱|強)?/);
  if (!m) return null;

  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;

  const mod = (m[2] ?? '').trim();
  if (!mod) return { label: String(base), score: base };
  if (mod === '-' || mod === '弱') return { label: `${base}弱`, score: base };
  if (mod === '+' || mod === '強') return { label: `${base}強`, score: base + 0.5 };
  return { label: `${base}${mod}`, score: base };
}

function parseMagnitude(magnitude: string | null): number | null {
  if (!magnitude) return null;
  const cleaned = normalizeFullWidthDigits(magnitude).replace(/[^0-9.]/g, '');
  const n = cleaned ? Number(cleaned) : NaN;
  if (!Number.isFinite(n)) return null;
  return n;
}

function severityTone(args: { intensityScore: number | null; magnitude: number | null }): 'red' | 'yellow' | 'blue' | 'purple' | 'neutral' {
  if (args.intensityScore !== null) {
    if (args.intensityScore >= 6) return 'red';
    if (args.intensityScore >= 5) return 'yellow';
    if (args.intensityScore >= 4) return 'blue';
    return 'neutral';
  }
  if (args.magnitude !== null) {
    if (args.magnitude >= 7) return 'purple';
    if (args.magnitude >= 6.5) return 'red';
    if (args.magnitude >= 6) return 'yellow';
    if (args.magnitude >= 5) return 'blue';
    return 'neutral';
  }
  return 'neutral';
}

function toneClasses(tone: ReturnType<typeof severityTone>): string {
  switch (tone) {
    case 'purple':
      return 'border-purple-200 bg-purple-50 text-purple-900';
    case 'red':
      return 'border-red-200 bg-red-50 text-red-900';
    case 'yellow':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'blue':
      return 'border-blue-200 bg-blue-50 text-blue-900';
    default:
      return 'border-gray-200 bg-gray-50 text-gray-900';
  }
}

function sourceHealth(updatedAt: string | null | undefined, fetchStatus: string | null | undefined): 'OK' | 'DEGRADED' | 'DOWN' | 'PENDING' {
  if (!fetchStatus) return 'PENDING';
  if (fetchStatus === 'DOWN') return 'DOWN';
  if (!updatedAt) return 'DOWN';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return 'DOWN';
  const ageMs = Date.now() - t;
  if (fetchStatus === 'OK' && ageMs <= 10 * 60_000) return 'OK';
  if (ageMs <= 60 * 60_000) return 'DEGRADED';
  return 'DOWN';
}

function healthLabel(status: 'OK' | 'DEGRADED' | 'DOWN' | 'PENDING'): string {
  if (status === 'OK') return 'Online';
  if (status === 'DEGRADED') return 'Delayed';
  if (status === 'PENDING') return 'Checking';
  return 'Outdated';
}

function healthClass(status: 'OK' | 'DEGRADED' | 'DOWN' | 'PENDING'): string {
  if (status === 'OK') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (status === 'DEGRADED') return 'bg-amber-50 text-amber-900 ring-amber-200';
  if (status === 'PENDING') return 'bg-gray-50 text-gray-800 ring-gray-200';
  return 'bg-red-50 text-red-800 ring-red-200';
}

function tsunamiPanel(items: Array<{ title: string; tsunami?: string | null; time: string | null; magnitude: string | null; maxIntensity: string | null }>) {
  const recent = items.slice(0, 10);
  const hit = recent.find((item) => /津波警報|大津波警報/.test(item.title) || /警報/.test(String(item.tsunami ?? '')));
  if (hit) return { state: 'warning', label: '津波警報の見出しあり', updatedAt: hit.time };
  const advisory = recent.find((item) => /津波注意報/.test(item.title) || /注意報/.test(String(item.tsunami ?? '')));
  if (advisory) return { state: 'advisory', label: '津波注意報の見出しあり', updatedAt: advisory.time };
  const latest = items[0];
  const intensity = parseMaxIntensityRaw(latest?.maxIntensity)?.score ?? parseMaxIntensityFromTitle(latest?.title ?? '')?.score ?? 0;
  const magnitude = parseMagnitude(latest?.magnitude ?? null) ?? 0;
  const latestTime = latest?.time ? Date.parse(latest.time) : NaN;
  if (latest && Number.isFinite(latestTime) && Date.now() - latestTime < 15 * 60_000 && (intensity >= 4 || magnitude >= 6)) {
    return { state: 'checking', label: '津波有無を確認中', updatedAt: latest.time };
  }
  return { state: 'none', label: '津波警報・注意報の見出しなし', updatedAt: latest?.time ?? null };
}

export default function QuakesPage() {
  const { device } = useDevice();
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const { data } = useSWR('/api/jma/quakes', fetcher, { refreshInterval: refreshMs });
  const items: Array<{
    id: string;
    time: string | null;
    title: string;
    link: string | null;
    maxIntensity: string | null;
    magnitude: string | null;
    epicenter: string | null;
    depth?: string | null;
    lat?: number | null;
    lon?: number | null;
    tsunami?: string | null;
    intensityAreas?: Array<{ code: string; maxIntensity: string | null }>;
  }> = data?.items ?? [];

  const recentItems = useMemo(() => {
    const allowed = ['震源・震度情報', '顕著な地震の震源要素更新のお知らせ'];
    return items.filter((q) => allowed.some((a) => String(q.title ?? '').includes(a)));
  }, [items]);

  const lastErrorLabel = data?.lastError ? '取得エラー' : 'なし';

  const strongPicks = useMemo(() => {
    const uniqueRecent = Array.from(new Map(recentItems.map((q) => [q.id, q])).values());
    const scored = uniqueRecent
      .map((q) => {
        const intensity = parseMaxIntensityRaw(q.maxIntensity) ?? parseMaxIntensityFromTitle(q.title);
        if (!intensity) return null;
        const rawTime = typeof q.time === 'string' ? q.time : null;
        const t = rawTime ? Date.parse(rawTime) : NaN;
        if (!Number.isFinite(t)) return null;
        const severityScore = intensity.score * 10;
        return { q, intensity, timeMs: t, severityScore, rawTime };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v));

    const bySeverity = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
      b.severityScore - a.severityScore || b.timeMs - a.timeMs;

    const picks: (typeof scored)[number][] = [];
    for (const v of scored.filter((s) => (s.intensity?.score ?? 0) >= 6).sort(bySeverity)) {
      picks.push(v);
      if (picks.length >= 9) break;
    }
    if (picks.length < 9) {
      for (const v of scored.filter((s) => !picks.some((p) => p.q.id === s.q.id)).sort(bySeverity)) {
        picks.push(v);
        if (picks.length >= 9) break;
      }
    }
    return picks.slice(0, 9);
  }, [recentItems]);
  const displayStrong = strongPicks;


  // Pagination for Recent Quakes
  const [strongVisibleCount, setStrongVisibleCount] = useState(3);
  const handleStrongLoadMore = () => {
    setStrongVisibleCount((prev) => Math.min(prev + 3, 9));
  };
  const [visibleCount, setVisibleCount] = useState(10);
  const visibleRecentItems = recentItems.slice(0, visibleCount);
  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + 10, 50));
  };
  const latestEvent = recentItems[0] ?? items[0] ?? null;
  const latestIntensity = latestEvent ? parseMaxIntensityRaw(latestEvent.maxIntensity) ?? parseMaxIntensityFromTitle(latestEvent.title) : null;
  const quakeHealth = sourceHealth(data?.updatedAt, data?.fetchStatus);
  const tsunami = data ? tsunamiPanel(items) : { state: 'checking', label: '津波情報を確認中', updatedAt: null };

  return (
    <div className="space-y-6">
      <Seo
        title="地震"
        description="地震情報の一覧と最近の強い揺れを表示します。震源・震度・発生時刻を確認し、過去の揺れの傾向を把握できます。震度の目安解説も掲載し、防災行動の判断に役立ちます。"
      />

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">地震情報</h1>
          <div className="mt-1 text-sm text-gray-600">気象庁の地震情報をもとに、震源・震度・津波確認状況を表示します。</div>
        </div>
        <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ${healthClass(quakeHealth)}`}>
          JMA {healthLabel(quakeHealth)}
        </span>
      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">リアルタイム地震モニタ</h2>
            <div className="mt-1 text-xs text-gray-600">最終取得: {formatUpdatedAt(data?.updatedAt)} / 情報源: 気象庁 地震情報</div>
          </div>
          <div className="text-xs text-gray-600">自動更新: {Math.round(refreshMs / 1000)}秒ごと</div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <QuakeMonitorMap
            epicenter={
              latestEvent
                ? {
                    lat: typeof latestEvent.lat === 'number' ? latestEvent.lat : null,
                    lon: typeof latestEvent.lon === 'number' ? latestEvent.lon : null,
                    name: latestEvent.epicenter ?? null,
                    maxIntensity: latestIntensity?.label ?? latestEvent.maxIntensity ?? null,
                  }
                : null
            }
            intensityAreas={latestEvent?.intensityAreas ?? []}
          />

          <div className="space-y-3">
            <div className="rounded-xl border bg-gray-50 p-4">
              <div className="text-xs font-semibold text-gray-600">最新イベント</div>
              {latestEvent ? (
                <div className="mt-2 space-y-2 text-sm">
                  <div className="text-lg font-bold text-gray-900">{latestEvent.epicenter ?? latestEvent.title}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Fact label="発生" value={formatEventTime(latestEvent.time)} />
                    <Fact label="最大震度" value={latestIntensity?.label ?? latestEvent.maxIntensity ?? '不明'} />
                    <Fact label="M" value={latestEvent.magnitude ?? '不明'} />
                    <Fact label="深さ" value={latestEvent.depth ?? '不明'} />
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2 text-xs text-gray-700 ring-1 ring-gray-200">
                    状態: {latestEvent.title}
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded-lg bg-white px-3 py-3 text-sm text-gray-600 ring-1 ring-gray-200">
                  表示できる地震情報がまだありません。
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-gray-50 p-4">
              <div className="text-xs font-semibold text-gray-600">津波情報</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-base font-bold text-gray-900">{tsunami.label}</div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ring-1 ${
                  tsunami.state === 'warning'
                    ? 'bg-red-50 text-red-800 ring-red-200'
                    : tsunami.state === 'advisory' || tsunami.state === 'checking'
                      ? 'bg-amber-50 text-amber-900 ring-amber-200'
                      : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                }`}>
                  {tsunami.state === 'warning' ? 'Warning' : tsunami.state === 'advisory' ? 'Advisory' : tsunami.state === 'checking' ? 'Checking' : 'None'}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-600">更新: {formatUpdatedAt(tsunami.updatedAt)}</div>
              <div className="mt-2 text-xs text-gray-700">津波の最終判断は気象庁・自治体の発表を確認してください。</div>
            </div>

            <div className="rounded-xl border bg-gray-50 p-4">
              <div className="text-xs font-semibold text-gray-600">外部参考</div>
              <a href="http://www.kmoni.bosai.go.jp/" target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-lg bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-100">
                防災科研 強震モニタ
              </a>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-700">
          {['1-2', '3', '4', '5弱', '5強', '6弱以上'].map((label) => (
            <span key={label} className="rounded-full bg-gray-50 px-2 py-1 ring-1 ring-gray-200">震度 {label}</span>
          ))}
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">最近の強い揺れ</h2>
        <div className="mt-2 text-xs text-gray-600">過去7日間の最大震度上位を表示します（最大9件まで）。</div>

        {!data && <div className="mt-3 text-sm text-gray-600">読み込み中...</div>}
        {data && displayStrong.length === 0 && (
          <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-3 text-sm text-gray-600">
            直近データ内に強い揺れとして表示できる地震情報はありません。
          </div>
        )}
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {displayStrong.slice(0, strongVisibleCount).map((v) => {
            const tone = severityTone({ intensityScore: v.intensity?.score ?? null, magnitude: null });
            const summary = v.intensity ? `最大震度${v.intensity.label}` : '最大震度不明';
            return (
              <div key={v.q.id} className={`rounded border px-3 py-3 ${toneClasses(tone)}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-bold">{summary}</div>
                  <span className="rounded bg-white/70 px-2 py-1 text-[11px] font-semibold">{formatEventTime(v.rawTime)}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-gray-900 break-words">{v.q.epicenter ?? v.q.title}</div>
                {v.q.link && (
                  <div className="mt-2">
                    <a href={v.q.link} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline">
                      気象庁（詳細）
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {displayStrong.length > strongVisibleCount && strongVisibleCount < 9 && (
          <div className="mt-4 text-center">
            <button
              onClick={handleStrongLoadMore}
              className="rounded-full bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
            >
              もっと見る ({Math.min(displayStrong.length - strongVisibleCount, 3)}件)
            </button>
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">最近の地震</h2>
        <div className="mt-2 text-xs text-gray-600">「震源・震度情報」と「顕著な地震の震源要素更新のお知らせ」のみ表示します。</div>

        {!data && <div className="mt-3 text-sm text-gray-600">読み込み中...</div>}
        {data && visibleRecentItems.length === 0 && <div className="mt-3 text-sm text-gray-600">表示できる地震情報がありません。</div>}

        <ul className="mt-3 space-y-2">
          {visibleRecentItems.map((q) => {
            const intensity = parseMaxIntensityRaw(q.maxIntensity) ?? parseMaxIntensityFromTitle(q.title);
            const magnitudeNum = parseMagnitude(q.magnitude);
            const tone = severityTone({ intensityScore: intensity?.score ?? null, magnitude: magnitudeNum });
            return (
              <li key={q.id} className={`rounded border px-3 py-2 text-sm ${toneClasses(tone)}`}>
                <div className="font-semibold break-words">{q.title}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <span>時刻: {formatEventTime(q.time)}</span>
                  <span>震源: {q.epicenter ?? '不明'}</span>
                  <span>最大震度: {intensity?.label ?? '不明'}</span>
                  <span>M: {q.magnitude ?? '不明'}</span>
                </div>
                {q.link && (
                  <div className="mt-2">
                    <a href={q.link} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                      気象庁（詳細）
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {recentItems.length > visibleCount && visibleCount < 50 && (
          <div className="mt-4 text-center">
            <button
              onClick={handleLoadMore}
              className="rounded-full bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
            >
              もっと見る ({Math.min(recentItems.length - visibleCount, 10)}件)
            </button>
          </div>
        )}
      </section>

      <IntensityGuide />

      <DataFetchDetails
        status={data?.fetchStatus ?? 'PENDING'}
        updatedAt={data?.updatedAt}
        fetchStatus={data?.fetchStatus ?? 'PENDING'}
        error={data?.lastError}
      />
    </div>
  );
}

const INTENSITY_DATA = [
  { level: '0〜2', color: 'bg-green-500', feel: 'ほとんど感じない〜揺れを感じる', action: '特に行動不要。' },
  { level: '3', color: 'bg-lime-500', feel: '家にいる人のほとんどが揺れを感じる', action: '棚や照明器具に注意。' },
  { level: '4', color: 'bg-yellow-400', feel: '吊り下げ物が大きく揺れる', action: '火の元を確認、安全な場所へ。' },
  { level: '5弱', color: 'bg-orange-400', feel: '物が落ちる、家具が動く', action: 'テーブル下など安全な場所へ避難。' },
  { level: '5強', color: 'bg-orange-600', feel: '家具が倒れる、窓ガラスが割れる', action: '頭を守り、揺れが収まるまで待機。' },
  { level: '6弱', color: 'bg-red-500', feel: '立っていられない、ブロック塀が崩れる', action: '建物倒壊に注意、屋外へ逃げる際は落下物注意。' },
  { level: '6強', color: 'bg-red-700', feel: '這わないと動けない、多くの建物が損壊', action: '周囲の安全確認、津波や土砂災害にも警戒。' },
  { level: '7', color: 'bg-purple-900', feel: '極めて激しい揺れ、壁や柱が崩れる', action: '命を守る行動。直ちに海岸・崖から離れる。' },
];

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-gray-200">
      <div className="text-[11px] font-semibold text-gray-600">{label}</div>
      <div className="mt-1 font-bold text-gray-900">{value}</div>
    </div>
  );
}

function IntensityGuide() {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-lg bg-white p-5 shadow">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(!open)}
      >
        <h2 className="text-lg font-semibold">震度の目安と行動</h2>
        <span className="text-sm text-blue-600">{open ? 'とじる' : '開く'}</span>
      </button>

      {open && (
        <div className="mt-4">
          <div className="text-xs text-gray-600">気象庁震度階級に基づく目安です。実際の被害は震源の深さや地盤で異なります。</div>

          <div className="mt-3 space-y-2">
            {INTENSITY_DATA.map((row) => (
              <div key={row.level} className="flex items-start gap-3 rounded border bg-gray-50 p-2 text-sm">
                <div className={`mt-1 h-4 w-4 flex-shrink-0 rounded ${row.color}`} title={`震度${row.level}`} />
                <div className="flex-1">
                  <div className="font-semibold">震度 {row.level}</div>
                  <div className="mt-0.5 text-xs text-gray-700">{row.feel}</div>
                  <div className="mt-0.5 text-xs text-gray-800 font-medium">{row.action}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            <strong>重要:</strong> 震度5弱以上では家具転倒・建物損壊の可能性があります。事前に家具固定や避難経路確認を。
          </div>
        </div>
      )}
    </section>
  );
}
