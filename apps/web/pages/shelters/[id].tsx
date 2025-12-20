import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import { useDevice } from '../../components/device/DeviceProvider';
import ShareMenu from '../../components/ShareMenu';
import { buildUrl, formatShelterShareText } from '../../lib/client/share';
import { loadLastLocation, saveLastLocation, type Coords } from '../../lib/client/location';
import { formatPrefMuniLabel, useAreaName } from '../../lib/client/areaName';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '未取得';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return '未取得';
  return new Date(t).toLocaleString();
}

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

function googleMapsRouteUrl(args: { origin?: Coords | null; dest: Coords }) {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${args.dest.lat},${args.dest.lon}`);
  if (args.origin) u.searchParams.set('origin', `${args.origin.lat},${args.origin.lon}`);
  u.searchParams.set('travelmode', 'walking');
  return u.toString();
}

export default function ShelterDetailPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : Array.isArray(router.query.id) ? router.query.id[0] : null;

  const { device, deviceId, updateDevice, checkin, coarseArea } = useDevice();
  const communityRefresh = device?.settings?.powerSaving || device?.settings?.lowBandwidth ? 0 : 30_000;

  const { data: siteData } = useSWR(id ? `/api/shelters/${id}` : null, fetcher, { dedupingInterval: 10_000 });
  const site = siteData?.site as any;

  const { data: community, mutate: mutateCommunity } = useSWR(id ? `/api/store/shelter?id=${id}` : null, fetcher, { refreshInterval: communityRefresh });

  const isFavorite = Boolean(device?.favorites?.shelterIds?.includes(id ?? ''));

  useEffect(() => {
    if (!id || !deviceId) return;
    const current = device?.recent?.shelterIds ?? [];
    const next = [id, ...current.filter((s) => s !== id)].slice(0, 50);
    void updateDevice({ recent: { shelterIds: next } as any } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dest: Coords | null = site?.lat && site?.lon ? { lat: site.lat, lon: site.lon } : null;
  const [originLocal, setOriginLocal] = useState<Coords | null>(null);
  useEffect(() => {
    try {
      setOriginLocal(loadLastLocation());
    } catch {
      setOriginLocal(null);
    }
  }, []);
  const origin = originLocal;

  const { label: coarseAreaLabel } = useAreaName({ prefCode: coarseArea?.prefCode ?? null, muniCode: coarseArea?.muniCode ?? null });
  const shareFromArea = useMemo(() => {
    const selected = device?.settings?.selectedAreaId
      ? device?.savedAreas?.find((a) => a.id === device.settings.selectedAreaId)
      : device?.savedAreas?.[0];
    const selectedLabel = formatPrefMuniLabel(selected ? { prefName: selected.prefName, muniName: selected.muniName ?? null } : null);
    return coarseAreaLabel ?? selectedLabel ?? null;
  }, [coarseAreaLabel, device?.savedAreas, device?.settings?.selectedAreaId]);

  const originUrl = typeof window !== 'undefined' ? window.location.origin : null;
  const shareUrl = id && originUrl ? buildUrl(originUrl, `/shelters/${id}`, {}) : null;

  const votesSummary: Record<string, number> = community?.votesSummary ?? {};
  const topVote = useMemo(() => {
    const entries = Object.entries(votesSummary);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }, [votesSummary]);

  const myActiveCheckin: any =
    (device?.checkins ?? []).find((c: any) => c && typeof c === 'object' && (c as any).active !== false) ?? (device?.checkins ?? [])[0] ?? null;

  const [pinCoords, setPinCoords] = useState<Coords | null>(origin ?? null);
  useEffect(() => {
    if (!pinCoords && origin) setPinCoords(origin);
  }, [origin, pinCoords]);

  const [pinLocating, setPinLocating] = useState(false);
  const [pinPrecise, setPinPrecise] = useState(false);
  const [pinStatus, setPinStatus] = useState<'SAFE' | 'INJURED' | 'ISOLATED' | 'EVACUATING' | 'COMPLETED'>('SAFE');
  const [pinComment, setPinComment] = useState('');

  const requestPinLocation = (highAccuracy: boolean) => {
    setPinLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setPinCoords(next);
        saveLastLocation(next);
        setPinLocating(false);
      },
      () => {
        setPinLocating(false);
        alert('位置情報の取得に失敗しました');
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 15_000 : 8_000,
        maximumAge: highAccuracy ? 0 : 5 * 60_000,
      }
    );
  };

  return (
    <div className="space-y-6">
      <Head>
        <title>{site?.name ? `${site.name} | 避難場所` : '避難場所'} | 全国避難場所ファインダー</title>
      </Head>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/list" className="text-sm text-blue-600 hover:underline">
            ← 一覧へ
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{site?.name ?? '読み込み中...'}</h1>
          <div className="mt-1 text-sm text-gray-700">{formatPrefCityLabel(site?.pref_city)}</div>
        </div>
	        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (!id) return;
              const current = device?.favorites?.shelterIds ?? [];
              if (!isFavorite && current.length >= 5) {
                alert('保存は最大5件です');
                return;
              }
              const next = isFavorite ? current.filter((s) => s !== id) : [id, ...current];
              void updateDevice({ favorites: { shelterIds: Array.from(new Set(next)).slice(0, 5) } as any } as any);
            }}
            className={classNames(
              'rounded px-3 py-2 text-sm font-semibold',
              isFavorite ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
            )}
          >
            {isFavorite ? '★ 保存済み' : '☆ 保存'}
          </button>
	          <ShareMenu
	            shareUrl={shareUrl}
	            getShareText={() =>
	              formatShelterShareText({
	                shelterName: site?.name ?? '避難場所',
	                address: site?.pref_city ? formatPrefCityLabel(site.pref_city) : null,
	                fromArea: shareFromArea,
	                now: new Date(),
	              })
	            }
	          />
	        </div>
	      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">施設情報</h2>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">更新</div>
            <div className="mt-1 text-xs text-gray-800">
              source: {formatUpdatedAt(site?.source_updated_at)} / db: {formatUpdatedAt(site?.updated_at)}
            </div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">注意</div>
            <div className="mt-1 text-xs text-gray-800">
              開設状況/受入可否は自治体情報が最優先です。不明な項目は「不明」と表示します。
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm font-semibold">対応ハザード（避難所データ）</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {hazardKeys
              .filter((k) => Boolean((site?.hazards as any)?.[k]))
              .map((k) => (
                <span key={k} className="rounded bg-emerald-100 px-2 py-1 text-[10px] text-emerald-800">
                  {hazardLabels[k]}
                </span>
              ))}
            {site && hazardKeys.filter((k) => Boolean((site?.hazards as any)?.[k])).length === 0 && (
              <span className="text-xs text-gray-600">不明/未設定</span>
            )}
          </div>
          <div className="mt-2 text-xs text-gray-600">
            地図ハザード（洪水/土砂/津波/液状化）は <Link href="/hazard" className="text-blue-600 hover:underline">/hazard</Link> で表示（デフォルトOFF）。
          </div>
        </div>

        {site?.notes && (
          <div className="mt-4 rounded border bg-gray-50 px-3 py-2 text-sm text-gray-800">
            <div className="font-semibold">備考</div>
            <div className="mt-1 whitespace-pre-wrap text-sm">{site.notes}</div>
          </div>
        )}

        <div className="mt-4">
          {dest ? (
            <a
              href={googleMapsRouteUrl({ origin, dest })}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black"
            >
              Google Mapsで最短ルート
            </a>
          ) : (
            <div className="text-sm text-gray-600">座標不明のためルート表示できません。</div>
          )}
          <div className="mt-2 text-xs text-gray-600">現在地: {shareFromArea ?? 'エリア未確定'}</div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">混雑状況（投票/コメント）</h2>
        <div className="mt-2 text-xs text-gray-600">
          個人情報は書かないでください。多数報告があるコメントは自動的に折りたたまれます（簡易モデレーション）。
        </div>

        {!community && <div className="mt-3 text-sm text-gray-600">読み込み中...</div>}
        {community && (
          <>
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
              <div className="rounded border bg-gray-50 p-3">
                <div className="text-xs text-gray-600">updatedAt</div>
                <div className="mt-1 text-xs text-gray-800">{formatUpdatedAt(community.updatedAt)}</div>
              </div>
              <div className="rounded border bg-gray-50 p-3">
                <div className="text-xs text-gray-600">代表</div>
                <div className="mt-1 font-semibold">{topVote ?? '不明'}</div>
              </div>
              <div className="rounded border bg-gray-50 p-3">
                <div className="text-xs text-gray-600">コメント</div>
                <div className="mt-1 text-xs text-gray-800">
                  {community.commentsCollapsed ? '自動折りたたみ中' : `${community.commentCount}件`} / 非表示 {community.hiddenCount}件
                </div>
              </div>
            </div>

            {!community.commentsCollapsed &&
              typeof community.mostReported === 'number' &&
              typeof community.moderationPolicy?.reportCautionThreshold === 'number' &&
              community.mostReported >= community.moderationPolicy.reportCautionThreshold && (
                <div className="mt-3 rounded border bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  多数の通報があるコメントがあります。内容は参考程度にし、公式情報を優先してください。
                </div>
              )}

            <div className="mt-4">
              <div className="text-sm font-semibold">投票</div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
                {[
                  ['EVACUATING', '避難中'],
                  ['SMOOTH', 'スムーズ'],
                  ['NORMAL', '普通'],
                  ['CROWDED', '混雑'],
                  ['CLOSED', '閉鎖'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className="rounded border bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:bg-gray-100"
                    disabled={!deviceId}
                    onClick={async () => {
                      if (!deviceId || !id) return;
                      const res = await fetch('/api/store/shelter/vote', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ shelterId: id, deviceId, value }),
                      });
                      if (!res.ok) {
                        const j = await res.json().catch(() => null);
                        alert(j?.error ?? '送信できませんでした');
                        return;
                      }
                      await mutateCommunity();
                    }}
                  >
                    {label}
                    <div className="mt-1 text-xs text-gray-600">{votesSummary[value] ?? 0}</div>
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs text-gray-600">同じ避難所への連続投票は時間制限があります。</div>
            </div>

            <CommentThread shelterId={id!} deviceId={deviceId} community={community} onChanged={mutateCommunity} />
          </>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">安否ピン（手動）</h2>
        <div className="mt-2 text-xs text-gray-600">
          現在地にピンを置き、状態と短いコメントを残せます（粗い位置がデフォルト）。個人情報は書かないでください。
        </div>

        <div className="mt-3 space-y-4">
          <div className="rounded border bg-gray-50 px-3 py-3">
            <div className="text-xs font-semibold text-gray-700">1) 位置の確認（保存は粗い位置がデフォルト）</div>
            <div className="mt-1 text-xs text-gray-600">
              保存する位置: {shareFromArea ?? 'エリア未確定'}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="rounded bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-60"
                disabled={pinLocating}
                title="位置情報は端末内で利用。表示・共有は概略のみ。"
                onClick={() => {
                  setPinPrecise(false);
                  requestPinLocation(false);
                }}
              >
                現在地を取得（概略）
              </button>
              <button
                className="rounded bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-60"
                disabled={pinLocating}
                title="高精度はバッテリー消費が増えることがあります。位置情報は端末内で利用。表示・共有は概略のみ。"
                onClick={() => {
                  setPinPrecise(true);
                  requestPinLocation(true);
                }}
              >
                高精度で取得
              </button>
            </div>
            <div className="mt-2 text-[11px] text-gray-600">
              表示/共有は「都道府県・市区町村」までに丸めます（緯度経度は表示しません）。
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-700">2) 状態を選ぶ</div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
              {[
                { key: 'SAFE', label: '無事', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
                { key: 'INJURED', label: '負傷', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
                { key: 'ISOLATED', label: '孤立', cls: 'border-red-300 bg-red-50 text-red-900' },
                { key: 'EVACUATING', label: '避難中', cls: 'border-blue-300 bg-blue-50 text-blue-900' },
                { key: 'COMPLETED', label: '避難完了', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
              ].map((s) => (
                <button
                  key={s.key}
                  className={classNames(
                    'rounded border px-3 py-2 text-left text-sm font-semibold hover:bg-white',
                    pinStatus === (s.key as any) ? s.cls : 'border-gray-200 bg-white text-gray-900'
                  )}
                  onClick={() => setPinStatus(s.key as any)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-700">3) コメント（任意）</div>
            <textarea
              className="mt-2 w-full rounded border px-3 py-2 text-sm"
              rows={2}
              maxLength={120}
              value={pinComment}
              onChange={(e) => setPinComment(e.target.value)}
              placeholder="短く（個人情報は書かないでください）"
            />
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <button
              className="rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-60"
              disabled={!deviceId || !pinCoords}
              onClick={async () => {
                if (!pinCoords) return alert('まず現在地を取得してください');
                await checkin({
                  status: pinStatus,
                  coords: pinCoords,
                  precision: pinPrecise ? 'PRECISE' : 'COARSE',
                  comment: pinComment,
                  shelterId: id ?? null,
                });
                setPinComment('');
                alert('安否ピンを更新しました');
              }}
            >
              ピンを更新
            </button>
            <div className="text-xs text-gray-600">更新: {myActiveCheckin ? formatUpdatedAt(myActiveCheckin.updatedAt) : '未更新'}</div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold">注意</div>
        <div className="mt-1">表示は参考情報です。現地判断と自治体・公式情報を優先してください。</div>
      </section>
    </div>
  );
}

function CommentThread({
  shelterId,
  deviceId,
  community,
  onChanged,
}: {
  shelterId: string;
  deviceId: string | null;
  community: any;
  onChanged: () => Promise<any>;
  }) {
  const [text, setText] = useState('');
  const cautionThreshold = typeof community?.moderationPolicy?.reportCautionThreshold === 'number' ? community.moderationPolicy.reportCautionThreshold : 3;

  return (
    <div className="mt-6">
      <div className="text-sm font-semibold">コメント</div>

      {community.commentsCollapsed && (
        <details className="mt-2 rounded border bg-red-50 px-3 py-2 text-sm text-red-900">
          <summary className="cursor-pointer list-none font-semibold">通報により非表示（詳細を見る）</summary>
          <div className="mt-2 text-xs">
            多数の通報があり、コメント一覧は一時的に非表示です。必要に応じて管理者が確認します。
          </div>
        </details>
      )}

      {!community.commentsCollapsed && (
        <div className="mt-2 space-y-2">
          {(community.comments ?? []).length === 0 && <div className="text-sm text-gray-600">コメントはまだありません。</div>}
          {(community.comments ?? []).map((c: any) => (
            <div key={c.id} className="rounded border bg-gray-50 px-3 py-2 text-sm">
              <div className="whitespace-pre-wrap">{c.text}</div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                <span>{formatUpdatedAt(c.createdAt)}</span>
                <div className="flex items-center gap-2">
                  {typeof c.reportCount === 'number' && c.reportCount >= cautionThreshold && (
                    <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
                      多数の通報があり注意
                    </span>
                  )}
                  <button
                    className="rounded bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                    onClick={async () => {
                      if (!deviceId) return alert('deviceIdが未設定です');
                      const reason = prompt('通報理由（任意）') ?? '';
                      const res = await fetch('/api/store/shelter/report', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ shelterId, deviceId, commentId: c.id, reason: reason || null }),
                      });
                      if (!res.ok) {
                        const j = await res.json().catch(() => null);
                        alert(j?.error ?? '通報できませんでした');
                        return;
                      }
                      await onChanged();
                    }}
                  >
                    通報
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded border bg-white p-3">
        <div className="text-xs text-gray-600">個人情報は書かないでください。誹謗中傷は禁止です。</div>
        <textarea className="mt-2 w-full rounded border p-2 text-sm" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="混雑状況や注意点（500文字まで）" />
        <button
          className="mt-2 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
          disabled={!deviceId || !text.trim()}
          onClick={async () => {
            if (!deviceId) return;
            const res = await fetch('/api/store/shelter/comment', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ shelterId, deviceId, text: text.trim() }),
            });
            if (!res.ok) {
              const j = await res.json().catch(() => null);
              alert(j?.error ?? '送信できませんでした');
              return;
            }
            setText('');
            await onChanged();
          }}
        >
          送信
        </button>
      </div>
    </div>
  );
}
