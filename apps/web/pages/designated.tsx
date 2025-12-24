import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { useMemo, useState } from 'react';
import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import { normalizeMuniCode } from 'lib/muni-helper';
import MapView from '../components/MapView';
import { DataFetchDetails } from '../components/DataFetchDetails';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatPrefCityLabel(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '所在地不明';
  const m = text.match(/^(.*?[都道府県])(.*)$/);
  if (!m) {
    const muniMatch = text.match(/^(.*?[市区町村])/);
    return muniMatch?.[1]?.trim() || text;
  }
  const pref = m[1];
  const rest = (m[2] || '').trim();
  if (!rest) return pref;
  const muniMatch = rest.match(/^(.*?[市区町村])/);
  const muni = muniMatch?.[1]?.trim() ?? '';
  if (muni) return `${pref} ${muni}`.trim();
  return `${pref} ${rest}`.trim();
}

type ShelterListItem = {
  id: string;
  name: string;
  pref_city: string | null;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  hazards: any;
  notes: string | null;
};

type HazardKey = (typeof hazardKeys)[number];

function hazardTags(hazards: any): HazardKey[] {
  const flags = (hazards ?? {}) as Record<string, boolean>;
  return hazardKeys.filter((k) => Boolean(flags[k])) as HazardKey[];
}

export default function DesignatedPage() {
  const debugEnabled = process.env.NODE_ENV !== 'production';
  const { data: prefecturesData } = useSWR('/api/ref/municipalities', fetcher, { dedupingInterval: 60_000 });
  const prefectures: Array<{ prefCode: string; prefName: string }> = prefecturesData?.prefectures ?? [];
  const [prefCode, setPrefCode] = useState('');
  const [cityText, setCityText] = useState('');
  const [q, setQ] = useState('');

  const municipalitiesUrl = prefCode ? `/api/ref/municipalities?prefCode=${prefCode}` : null;
  const { data: municipalitiesData } = useSWR(municipalitiesUrl, fetcher, { dedupingInterval: 60_000 });
  const municipalities: Array<{ muniCode: string; muniName: string }> = municipalitiesData?.municipalities ?? [];

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (prefCode) params.set('prefCode', prefCode);

    const trimmedCity = cityText.trim();
    if (trimmedCity) {
      // Try to find matching municipality to send strict code
      const match = municipalities.find((m) => m.muniName === trimmedCity);
      if (match) {
        const normalized = normalizeMuniCode(match.muniCode);
        if (normalized) params.set('muniCode', normalized);
      } else {
        params.set('cityText', trimmedCity);
      }
    }

    if (q.trim()) params.set('q', q.trim());
    params.set('designatedOnly', 'true');
    params.set('includeHazardless', 'true');
    params.set('limit', '50');
    if (params.toString().length === 0) return null;
    return `/api/shelters/search?${params.toString()}`;
  }, [prefCode, cityText, q, municipalities]);

  const { data, isLoading } = useSWR(queryUrl, fetcher, { dedupingInterval: 10_000 });
  const items: ShelterListItem[] = data?.sites ?? [];
  const sitesWithCoords = items.filter((site) => Number.isFinite(site.lat) && Number.isFinite(site.lon));
  const noCoordCount = Math.max(0, items.length - sitesWithCoords.length);
  const { data: countsData } = useSWR(debugEnabled ? '/api/shelters/designated-counts' : null, fetcher, { dedupingInterval: 60_000 });
  const countsError = countsData?.ok === false;
  const zeroPrefectures: Array<{ prefCode: string; prefName: string }> = countsData?.zeroPrefectures ?? [];


  return (
    <div className="space-y-6">
      <Head>
        <title>指定避難所 | 全国避難場所ファインダー</title>
      </Head>

      {countsError && (
        <div className="rounded-lg border bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">注意:</span> カウントデータの取得に失敗しました。一部の情報が表示されない場合があります。
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">指定避難所一覧（参考）</h1>
          <div className="mt-1 text-sm text-gray-600">
            緊急時の最適化は行っていない参考リストです。詳細は自治体の公式情報をご確認ください。
          </div>
        </div>
        <Link href="/list" className="text-sm font-semibold text-blue-700 hover:underline">
          緊急時は避難場所検索へ
        </Link>
      </div>

      {!isLoading && sitesWithCoords.length > 0 && (
        <section className="rounded-lg bg-white p-2 shadow md:p-3">
          <MapView
            sites={sitesWithCoords as any}
            center={{
              lat: sitesWithCoords[0]?.lat ?? 35.681236,
              lon: sitesWithCoords[0]?.lon ?? 139.767125,
            }}
            onSelect={() => { }}
          />
        </section>
      )}

      <section className="rounded-2xl bg-white p-4 shadow">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            <div className="mb-1 text-xs text-gray-600">都道府県</div>
            <select
              className="w-full rounded border px-2 py-2 text-sm"
              value={prefCode}
              onChange={(e) => setPrefCode(e.target.value)}
            >
              <option value="">選択しない</option>
              {prefectures.map((p) => (
                <option key={p.prefCode} value={p.prefCode}>
                  {p.prefName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-xs text-gray-600">市区町村（任意）</div>
            <input
              className="w-full rounded border px-2 py-2 text-sm"
              value={cityText}
              onChange={(e) => setCityText(e.target.value)}
              placeholder="例: 渋谷区"
              list="muni-options"
            />
            <datalist id="muni-options">
              {municipalities.map((m) => (
                <option key={m.muniCode} value={m.muniName} />
              ))}
            </datalist>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-xs text-gray-600">キーワード（任意）</div>
            <input
              className="w-full rounded border px-2 py-2 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="施設名など"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow">
        <div className="text-xs text-gray-600">
          {isLoading && '読み込み中...'}
          {!isLoading && queryUrl && items.length === 0 && '該当する指定避難所が見つかりませんでした。'}
          {!queryUrl && '都道府県やキーワードを入力すると表示します。'}
        </div>
        {!isLoading && items.length > 0 && (
          <div className="mt-2 text-xs text-gray-600">座標なし: {noCoordCount}件</div>
        )}
        {!isLoading && debugEnabled && zeroPrefectures.length > 0 && (
          <div className="mt-2 text-[11px] text-gray-600">
            0件の都道府県: {zeroPrefectures.map((p) => p.prefName).join('、')}
          </div>
        )}

        {items.length > 0 && (
          <ul className="mt-3 space-y-2">
            {items.map((site) => {
              const tags = hazardTags(site.hazards);
              const hasCoords = Number.isFinite(site.lat) && Number.isFinite(site.lon);
              return (
                <li key={site.id} className="rounded-xl border bg-gray-50 px-3 py-2 text-sm">
                  <div className="font-semibold">{site.name}</div>
                  <div className="mt-1 text-xs text-gray-600">{formatPrefCityLabel(site.pref_city)}</div>
                  {!hasCoords && <div className="mt-1 text-[11px] text-gray-500">座標なし</div>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {tags.length > 0 ? (
                      tags.slice(0, 4).map((k) => (
                        <span
                          key={k}
                          className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
                        >
                          {hazardLabels[k]}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700 ring-1 ring-gray-200">
                        対応ハザード: 不明
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">条件検索</h2>
        <div className="mt-3 rounded border bg-gray-100 p-4 text-center text-sm text-gray-600">
          この条件検索は準備中です。現在は地図中心検索をご利用ください（<Link href="/list" className="text-blue-600 hover:underline">/list</Link>）。
        </div>
      </section>
    </div>
  );
}
