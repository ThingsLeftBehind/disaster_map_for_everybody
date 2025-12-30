import { Seo } from '../components/Seo';
import useSWR from 'swr';
import { useMemo, useState } from 'react';
import classNames from 'classnames';
import { useDevice } from '../components/device/DeviceProvider';
import { DataFetchDetails } from '../components/DataFetchDetails';
import { intensityBadgeClasses, intensityRowClasses } from '../lib/ui/quakes';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function normalizeFullWidthDigits(input: string): string {
  return input.replace(/[０-９]/g, (ch) => String('０１２３４５６７８９'.indexOf(ch)));
}

function formatEventTime(time: string | null | undefined): string {
  if (!time) return '不明';
  const t = Date.parse(time);
  if (Number.isNaN(t)) return normalizeFullWidthDigits(String(time).trim()) || '不明';
  return new Date(t).toLocaleString();
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

function formatDepth(depthKm: number | null | undefined): string {
  if (typeof depthKm !== 'number' || !Number.isFinite(depthKm)) return '深さ不明';
  const rounded = depthKm < 10 ? depthKm.toFixed(1) : String(Math.round(depthKm));
  return `深さ${rounded}km`;
}

type QuakeItem = {
  id: string;
  time: string | null;
  title: string;
  link: string | null;
  maxIntensity: string | null;
  magnitude: string | null;
  epicenter: string | null;
  depthKm?: number | null;
  intensityAreas?: Array<{ intensity: string; areas: string[] }> | null;
};

type QuakeView = QuakeItem & {
  intensityLabel: string | null;
  intensityScore: number | null;
  magnitudeValue: number | null;
  timeMs: number | null;
  depthValue: number | null;
};

function IntensityAreas({ groups }: { groups: Array<{ intensity: string; areas: string[] }> }) {
  if (!groups || groups.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-gray-600">感じた地域</summary>
      <div className="mt-2 space-y-1 text-xs text-gray-700">
        {groups.map((group) => (
          <div key={group.intensity} className="leading-relaxed">
            <span className="font-semibold">最大震度{group.intensity}</span>: {group.areas.join(' / ')}
          </div>
        ))}
      </div>
    </details>
  );
}

function QuakeRow({ item }: { item: QuakeView }) {
  const badgeLabel = item.intensityLabel ?? '不明';
  const badgeClass = intensityBadgeClasses(item.intensityScore);

  const metaParts = [
    formatEventTime(item.time),
    item.magnitudeValue !== null ? `M${item.magnitudeValue.toFixed(1).replace(/\.0$/, '')}` : null,
    formatDepth(item.depthValue),
  ].filter((part): part is string => Boolean(part));

  return (
    <div className={classNames('rounded-lg border p-3', intensityRowClasses(item.intensityScore))}>
      <div className="flex items-start gap-3">
        <div className={classNames('flex min-w-[56px] flex-col items-center justify-center rounded-md border px-2 py-1 text-xs font-semibold', badgeClass)}>
          <div className="text-[10px]">震度</div>
          <div className="text-sm">{badgeLabel}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900">{item.epicenter ?? item.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
            {metaParts.map((part) => (
              <span key={part}>{part}</span>
            ))}
          </div>
        </div>
        {item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            気象庁
          </a>
        )}
      </div>
      {item.intensityAreas && item.intensityAreas.length > 0 && <IntensityAreas groups={item.intensityAreas} />}
    </div>
  );
}

export default function QuakesPage() {
  const { device } = useDevice();
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const { data } = useSWR('/api/jma/quakes', fetcher, { refreshInterval: refreshMs });
  const items: QuakeItem[] = data?.items ?? [];

  const normalized = useMemo<QuakeView[]>(() => {
    return items.map((q) => {
      const intensity = parseMaxIntensityRaw(q.maxIntensity) ?? parseMaxIntensityFromTitle(q.title);
      const magnitudeValue = parseMagnitude(q.magnitude);
      const timeMs = q.time ? Date.parse(q.time) : NaN;
      const depthValue = typeof q.depthKm === 'number' && Number.isFinite(q.depthKm) ? q.depthKm : null;
      return {
        ...q,
        intensityLabel: intensity?.label ?? null,
        intensityScore: intensity?.score ?? null,
        magnitudeValue,
        timeMs: Number.isFinite(timeMs) ? timeMs : null,
        depthValue,
      };
    });
  }, [items]);

  const recentItems = useMemo(() => {
    const allowed = ['震源・震度情報', '顕著な地震の震源要素更新のお知らせ'];
    return normalized.filter((q) => allowed.some((a) => String(q.title ?? '').includes(a)));
  }, [normalized]);

  const sortedRecent = useMemo(() => {
    return [...recentItems].sort((a, b) => {
      const ta = a.timeMs ?? Number.NEGATIVE_INFINITY;
      const tb = b.timeMs ?? Number.NEGATIVE_INFINITY;
      return tb - ta;
    });
  }, [recentItems]);

  const strongItems = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return sortedRecent
      .filter((q) => q.intensityScore !== null && q.timeMs !== null)
      .filter((q) => now - (q.timeMs ?? 0) <= sevenDaysMs)
      .filter((q) => (q.intensityScore ?? 0) >= 5)
      .sort((a, b) => (b.intensityScore ?? 0) - (a.intensityScore ?? 0) || (b.timeMs ?? 0) - (a.timeMs ?? 0))
      .slice(0, 9);
  }, [sortedRecent]);

  const [strongVisibleCount, setStrongVisibleCount] = useState(3);
  const [recentVisibleCount, setRecentVisibleCount] = useState(10);

  return (
    <div className="space-y-6">
      <Seo
        title="地震"
        description="地震情報の一覧と最近の強い揺れを表示します。震源・震度・発生時刻を確認し、防災行動の判断に役立てられます。"
      />

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold">地震（JMA）</h1>
        <div className="flex items-center gap-3">
          <a
            href="http://www.kmoni.bosai.go.jp/"
            target="_blank"
            rel="noreferrer"
            className="rounded bg-gray-900 px-3 py-2 text-sm text-white hover:bg-black"
          >
            リアルタイム地震モニタ（外部）
          </a>
        </div>
      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">強い揺れ</h2>
        <div className="mt-2 text-xs text-gray-600">過去7日間の震度5弱以上を表示します（最大9件）。</div>
        <div className="mt-3 space-y-2">
          {strongItems.length === 0 && <div className="text-sm text-gray-600">記録はありません。</div>}
          {strongItems.slice(0, strongVisibleCount).map((item) => (
            <QuakeRow key={item.id} item={item} />
          ))}
        </div>
        {strongItems.length > strongVisibleCount && (
          <button
            className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
            onClick={() => setStrongVisibleCount((prev) => Math.min(prev + 3, 9))}
          >
            もっと見る
          </button>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">最近の地震</h2>
        <div className="mt-2 text-xs text-gray-600">「震源・震度情報」「顕著な地震の震源要素更新のお知らせ」を掲載します。</div>
        <div className="mt-3 space-y-2">
          {sortedRecent.slice(0, recentVisibleCount).map((item) => (
            <QuakeRow key={item.id} item={item} />
          ))}
        </div>
        {sortedRecent.length > recentVisibleCount && (
          <button
            className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
            onClick={() => setRecentVisibleCount((prev) => Math.min(prev + 10, 100))}
          >
            もっと見る
          </button>
        )}
      </section>

      <IntensityGuide />

      <DataFetchDetails
        status={data?.fetchStatus ?? 'DEGRADED'}
        updatedAt={data?.updatedAt}
        fetchStatus={data?.fetchStatus ?? 'DEGRADED'}
        error={data?.lastError}
      />
    </div>
  );
}

const INTENSITY_DATA = [
  { level: '0〜2', feel: 'ほとんど感じない〜揺れを感じる', action: '落下物に注意し、落ち着いて行動。' },
  { level: '3', feel: '家にいる人のほとんどが揺れを感じる', action: '棚や照明器具に注意。' },
  { level: '4', feel: '吊り下げ物が大きく揺れる', action: '火の元を確認、安全な場所へ。' },
  { level: '5弱', feel: '物が落ちる、家具が動く', action: 'テーブル下など安全な場所へ避難。' },
  { level: '5強', feel: '家具が倒れる、窓ガラスが割れる', action: '頭を守り、揺れが収まるまで待機。' },
  { level: '6弱', feel: '立っていられない、ブロック塀が崩れる', action: '建物倒壊に注意、落下物に警戒。' },
  { level: '6強', feel: '這わないと動けない、多くの建物が損壊', action: '周囲の安全確認、避難行動の判断を。' },
  { level: '7', feel: '極めて激しい揺れ、壁や柱が崩れる', action: '命を守る行動。海岸・崖から離れる。' },
];

function IntensityGuide() {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-lg bg-white p-5 shadow">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <h2 className="text-lg font-semibold">震度の目安と行動</h2>
        <span className="text-sm text-blue-600">{open ? 'とじる' : '開く'}</span>
      </button>

      {open && (
        <div className="mt-4">
          <div className="text-xs text-gray-600">気象庁震度階級に基づく目安です。実際の被害は震源の深さや地盤で異なります。</div>

          <div className="mt-3 space-y-2">
            {INTENSITY_DATA.map((row) => {
              const badgeScore = parseMaxIntensityRaw(row.level)?.score ?? null;
              return (
                <div key={row.level} className="flex items-start gap-3 rounded border bg-gray-50 p-2 text-sm">
                  <div className={classNames('mt-0.5 flex min-w-[44px] flex-col items-center justify-center rounded border px-1 py-0.5 text-[10px] font-semibold', intensityBadgeClasses(badgeScore))}>
                    <div>震度</div>
                    <div className="text-xs">{row.level}</div>
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">震度 {row.level}</div>
                    <div className="mt-0.5 text-xs text-gray-700">{row.feel}</div>
                    <div className="mt-0.5 text-xs text-gray-800 font-medium">{row.action}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 rounded border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            震度5弱以上では家具転倒・建物損壊の可能性があります。日頃から備えを行ってください。
          </div>
        </div>
      )}
    </section>
  );
}
