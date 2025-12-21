import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import { useDevice } from '../../components/device/DeviceProvider';
import MapView from '../../components/MapView';
import ShareMenu from '../../components/ShareMenu';
import { buildUrl, formatShelterShareText } from '../../lib/client/share';
import { loadLastLocation, type Coords } from '../../lib/client/location';
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

function sanitizeNoteText(value: string): string {
  return value.replace(/[0-9０-９一二三四五六七八九十]+丁目/g, '');
}

function sanitizeCommentText(value: string): string {
  return value.replace(/[0-9０-９一二三四五六七八九十]+丁目/g, '');
}

function parseShelterFields(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

function normalizeShelterFields(raw: unknown): Array<{ label: string; value: string }> {
  const obj = parseShelterFields(raw);
  if (!obj) return [];

  const allowKey = (key: string) =>
    /(収容|受入|受け入れ|対象者|バリア|トイレ|車いす|車椅子|ペット|宿泊|開設|要配慮|避難|駐車|授乳|オストメイト)/.test(key);
  const denyKey = (key: string) => /(code|id|緯度|経度|lat|lon|住所)/i.test(key);

  return Object.entries(obj)
    .filter(([key]) => allowKey(key) && !denyKey(key))
    .map(([key, value]) => {
      const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
      return { label: key, value: sanitizeNoteText(text) };
    })
    .filter((row) => row.value.trim())
    .slice(0, 12);
}

function normalizeEligibilityFields(raw: unknown): Array<{ label: string; value: string }> {
  const obj = parseShelterFields(raw);
  if (!obj) return [];

  const allowKey = (key: string) =>
    /(受入|受け入れ|対象者|対象|宿泊|利用条件|利用上|開設|要配慮|避難対象|避難区分|収容|条件|制限)/.test(key);
  const denyKey = (key: string) => /(code|id|緯度|経度|lat|lon|住所)/i.test(key);

  return Object.entries(obj)
    .filter(([key]) => allowKey(key) && !denyKey(key))
    .map(([key, value]) => {
      const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
      return { label: key, value: sanitizeNoteText(text) };
    })
    .filter((row) => row.value.trim())
    .slice(0, 12);
}

type VoteHistoryEntry = { id: string; status: string; comment: string; createdAt: string };

const HISTORY_KEY_PREFIX = 'jp_evac_shelter_history_v1';

function loadVoteHistory(shelterId: string): VoteHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${HISTORY_KEY_PREFIX}:${shelterId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({
        id: typeof (v as any).id === 'string' ? (v as any).id : String(Date.now()),
        status: typeof (v as any).status === 'string' ? (v as any).status : 'UNKNOWN',
        comment: typeof (v as any).comment === 'string' ? (v as any).comment : '',
        createdAt: typeof (v as any).createdAt === 'string' ? (v as any).createdAt : new Date().toISOString(),
      }))
      .slice(0, 10);
  } catch {
    return [];
  }
}

function saveVoteHistory(shelterId: string, entries: VoteHistoryEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${HISTORY_KEY_PREFIX}:${shelterId}`, JSON.stringify(entries.slice(0, 10)));
  } catch {
    // ignore
  }
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

  const { device, deviceId, updateDevice, coarseArea } = useDevice();
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

  const mapSites = useMemo(() => {
    if (!site || !dest) return [];
    return [
      {
        id: String(site.id ?? id ?? 'shelter'),
        name: String(site.name ?? '避難場所'),
        pref_city: site.pref_city ?? null,
        address: site.address ?? null,
        lat: dest.lat,
        lon: dest.lon,
        hazards: site.hazards ?? {},
        is_same_address_as_shelter: site.is_same_address_as_shelter ?? null,
        notes: site.notes ?? null,
        source_updated_at: site.source_updated_at ?? null,
        updated_at: site.updated_at ?? null,
      },
    ];
  }, [dest, id, site]);

  const votesSummary: Record<string, number> = community?.votesSummary ?? {};
  const topVote = useMemo(() => {
    const entries = Object.entries(votesSummary);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }, [votesSummary]);
  const detailFields = useMemo(() => normalizeShelterFields(site?.shelter_fields ?? null), [site?.shelter_fields]);
  const eligibilityFields = useMemo(() => normalizeEligibilityFields(site?.shelter_fields ?? null), [site?.shelter_fields]);

  const voteOptions = useMemo(
    () => [
      { value: 'EVACUATING', label: '避難中', badge: 'bg-blue-50 text-blue-900 ring-blue-200' },
      { value: 'SMOOTH', label: 'スムーズ', badge: 'bg-emerald-50 text-emerald-900 ring-emerald-200' },
      { value: 'NORMAL', label: '普通', badge: 'bg-gray-50 text-gray-900 ring-gray-200' },
      { value: 'CROWDED', label: '混雑', badge: 'bg-amber-50 text-amber-900 ring-amber-200' },
      { value: 'CLOSED', label: '閉鎖', badge: 'bg-red-50 text-red-900 ring-red-200' },
    ],
    []
  );


  const [selectedVote, setSelectedVote] = useState<string | null>(null);
  const [voteComment, setVoteComment] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [voteHistory, setVoteHistory] = useState<VoteHistoryEntry[]>([]);

  useEffect(() => {
    if (!id) return;
    setVoteHistory(loadVoteHistory(id));
  }, [id]);

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
            <div className="mt-1 whitespace-pre-wrap text-sm">{sanitizeNoteText(site.notes)}</div>
          </div>
        )}

        {eligibilityFields.length > 0 && (
          <div className="mt-4 rounded border bg-gray-50 px-3 py-2 text-sm text-gray-800">
            <div className="font-semibold">受入対象者/利用条件</div>
            <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
              {eligibilityFields.map((row) => (
                <div key={row.label} className="rounded bg-white px-2 py-2">
                  <div className="text-[11px] text-gray-600">{row.label}</div>
                  <div className="mt-1 text-sm text-gray-900">{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {detailFields.length > 0 && (
          <div className="mt-4 rounded border bg-gray-50 px-3 py-2 text-sm text-gray-800">
            <div className="font-semibold">施設情報（詳細）</div>
            <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
              {detailFields.map((row) => (
                <div key={row.label} className="rounded bg-white px-2 py-2">
                  <div className="text-[11px] text-gray-600">{row.label}</div>
                  <div className="mt-1 text-sm text-gray-900">{row.value}</div>
                </div>
              ))}
            </div>
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
        <h2 className="text-lg font-semibold">地図</h2>
        <div className="mt-2 text-xs text-gray-600">避難場所の位置を表示します。</div>
        <div className="mt-3">
          {dest ? (
            <MapView
              sites={mapSites as any}
              center={dest}
              initialZoom={14}
              origin={origin}
              fromAreaLabel={shareFromArea}
              onSelect={() => undefined}
            />
          ) : (
            <div className="text-sm text-gray-600">座標不明のため地図を表示できません。</div>
          )}
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
                {voteOptions.map((opt) => (
                  <button
                    key={opt.value}
                    className={classNames(
                      'rounded border px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:bg-gray-100',
                      selectedVote === opt.value ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-gray-300 bg-white text-gray-900'
                    )}
                    disabled={!deviceId}
                    onClick={() => {
                      if (!deviceId) return;
                      setSelectedVote(opt.value);
                      setSubmitError(null);
                      setSubmitNotice(null);
                    }}
                  >
                    {opt.label}
                    <div className="mt-1 text-xs text-gray-600">{votesSummary[opt.value] ?? 0}</div>
                  </button>
                ))}
              </div>

              <div className="mt-3">
                <div className="text-xs font-semibold text-gray-700">コメント（任意）</div>
                <textarea
                  className="mt-2 w-full rounded border px-3 py-2 text-sm"
                  rows={2}
                  maxLength={500}
                  value={voteComment}
                  onChange={(e) => setVoteComment(e.target.value)}
                  placeholder="空欄の場合は「コメントなし」として送信されます"
                />
              </div>

              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <button
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
                  disabled={!deviceId || submitBusy}
                  onClick={async () => {
                    setSubmitError(null);
                    setSubmitNotice(null);
                    if (!deviceId || !id) return;
                    if (!selectedVote) {
                      setSubmitError('投票状況は必須です');
                      return;
                    }
                    const commentText = voteComment.trim() || 'コメントなし';
                    setSubmitBusy(true);
                    try {
                      const voteRes = await fetch('/api/store/shelter/vote', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ shelterId: id, deviceId, value: selectedVote }),
                      });
                      const voteJson = await voteRes.json().catch(() => null);
                      const voteCode = typeof voteJson?.errorCode === 'string' ? voteJson.errorCode : null;
                      if (!voteRes.ok && voteCode !== 'DUPLICATE' && voteCode !== 'RATE_LIMITED') {
                        setSubmitError(voteJson?.error ?? '送信できませんでした');
                        return;
                      }

                      const commentRes = await fetch('/api/store/shelter/comment', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ shelterId: id, deviceId, text: commentText }),
                      });
                      const commentJson = await commentRes.json().catch(() => null);
                      const commentCode = typeof commentJson?.errorCode === 'string' ? commentJson.errorCode : null;
                      if (!commentRes.ok && commentCode !== 'DUPLICATE' && commentCode !== 'RATE_LIMITED') {
                        setSubmitError(commentJson?.error ?? '送信できませんでした');
                        return;
                      }

                      const entry: VoteHistoryEntry = {
                        id: `${Date.now()}`,
                        status: selectedVote,
                        comment: commentText,
                        createdAt: new Date().toISOString(),
                      };
                      setVoteHistory((prev) => {
                        const nextHistory = [entry, ...prev].slice(0, 10);
                        saveVoteHistory(id, nextHistory);
                        return nextHistory;
                      });
                      setVoteComment('');
                      setSelectedVote(null);
                      setSubmitNotice('送信しました');
                      await mutateCommunity();
                    } finally {
                      setSubmitBusy(false);
                    }
                  }}
                >
                  送信
                </button>
                <div className="text-xs text-gray-600">同じ避難所への連続投票は時間制限があります。</div>
              </div>

              {submitError && <div className="mt-2 text-sm text-red-700">{submitError}</div>}
              {submitNotice && <div className="mt-2 text-sm text-emerald-700">{submitNotice}</div>}

              {voteHistory.length > 0 && (
                <div className="mt-4">
                  <div className="text-sm font-semibold">送信履歴</div>
                  <div className="mt-2 space-y-2">
                    {voteHistory.map((entry) => {
                      const meta = voteOptions.find((o) => o.value === entry.status);
                      return (
                        <div key={entry.id} className="rounded border bg-gray-50 px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className={classNames('rounded-full px-2 py-1 text-xs font-semibold ring-1', meta?.badge ?? 'bg-gray-50 text-gray-700 ring-gray-200')}>
                              {meta?.label ?? entry.status}
                            </span>
                            <span className="text-xs text-gray-600">{formatUpdatedAt(entry.createdAt)}</span>
                          </div>
                          <div className="mt-1 text-sm text-gray-800">{sanitizeCommentText(entry.comment)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <CommentThread shelterId={id!} deviceId={deviceId} community={community} onChanged={mutateCommunity} />
          </>
        )}
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
              <div className="whitespace-pre-wrap">{sanitizeCommentText(String(c.text ?? ''))}</div>
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
    </div>
  );
}
