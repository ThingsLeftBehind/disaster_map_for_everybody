import Head from 'next/head';
import useSWR from 'swr';
import { useMemo } from 'react';
import { useDevice } from '../components/device/DeviceProvider';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return 'No successful fetch yet';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return 'No successful fetch yet';
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
      if (picks.length >= 3) break;
    }
    if (picks.length < 3) {
      for (const v of scored.filter((s) => !picks.some((p) => p.q.id === s.q.id)).sort(bySeverity)) {
        picks.push(v);
        if (picks.length >= 3) break;
      }
    }
    return picks.slice(0, 3);
  }, [recentItems]);

  return (
    <div className="space-y-6">
      <Head>
        <title>地震 | 全国避難場所ファインダー</title>
      </Head>

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
        <h2 className="text-lg font-semibold">最近の強い揺れ</h2>
        <div className="mt-2 text-xs text-gray-600">最大震度（震度）に基づいて表示します。</div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {(strongPicks.length > 0 ? strongPicks : [null, null, null]).slice(0, 3).map((v, idx) => {
            if (!v) {
              return (
                <div key={`empty-${idx}`} className="rounded border bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  該当なし
                </div>
              );
            }

            const tone = severityTone({ intensityScore: v.intensity?.score ?? null, magnitude: null });
            const summary = v.intensity ? `最大震度${v.intensity.label}` : '最大震度不明';
            return (
              <div key={v.q.id} className={`rounded border px-3 py-3 ${toneClasses(tone)}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-bold">{summary}</div>
                  <span className="rounded bg-white/70 px-2 py-1 text-[11px] font-semibold">{formatEventTime(v.rawTime)}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-gray-900">{v.q.epicenter ?? v.q.title}</div>
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
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">最近の地震</h2>
        <div className="mt-2 text-xs text-gray-600">「震源・震度情報」と「顕著な地震の震源要素更新のお知らせ」のみ表示します。</div>

        {!data && <div className="mt-3 text-sm text-gray-600">読み込み中...</div>}
        {data && recentItems.length === 0 && <div className="mt-3 text-sm text-gray-600">表示できる地震情報がありません。</div>}

        <ul className="mt-3 space-y-2">
          {recentItems.map((q) => {
            const intensity = parseMaxIntensityRaw(q.maxIntensity) ?? parseMaxIntensityFromTitle(q.title);
            const magnitudeNum = parseMagnitude(q.magnitude);
            const tone = severityTone({ intensityScore: intensity?.score ?? null, magnitude: magnitudeNum });
            return (
            <li key={q.id} className={`rounded border px-3 py-2 text-sm ${toneClasses(tone)}`}>
              <div className="font-semibold">{q.title}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-700">
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
      </section>

      <section className="rounded-lg border bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold">注意</div>
        <div className="mt-1">
          本表示は速報目的です。必ず気象庁等の公式情報を確認してください。リアルタイム地震モニタは外部リンクのみです（埋め込み/再配布しません）。
          <div className="mt-1 text-xs">環境によってはアクセスできない場合があります（ネットワーク設定等）。</div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">取得状況</h2>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">fetchStatus</div>
            <div className="mt-1 font-semibold">{data?.fetchStatus ?? 'DEGRADED'}</div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">updatedAt</div>
            <div className="mt-1 text-xs text-gray-700">{formatUpdatedAt(data?.updatedAt)}</div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">lastError</div>
            <div className="mt-1 text-xs text-gray-700">{lastErrorLabel}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
