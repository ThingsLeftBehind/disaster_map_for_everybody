import Link from 'next/link';
import { Seo } from '../../components/Seo';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import { useDevice } from '../../components/device/DeviceProvider';
import { HazardChips } from '../../components/HazardChips';
import MapView from '../../components/MapView';
import ShareMenu from '../../components/ShareMenu';
import { buildUrl, formatShelterShareText } from '../../lib/client/share';
import { loadLastLocation, type Coords } from '../../lib/client/location';
import { formatPrefMuniLabel, useAreaName } from '../../lib/client/areaName';
import { getShelterFromStorage, removeShelterFromStorage, saveShelterToStorage, type SavedShelter } from '../../lib/client/shelterStorage';

type CommunityWindow = '24h' | '3d' | '7d';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error((payload && typeof payload.error === 'string' && payload.error) || `HTTP ${res.status}`);
    (error as any).payload = payload;
    throw error;
  }
  return payload;
};

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '未取得';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return '未取得';
  return new Date(t).toLocaleString();
}

function formatPrefCityLabel(value: string | null | undefined, address?: string | null): string {
  const addr = (address ?? '').trim();
  if (addr) return addr;

  const text = (value ?? '').trim();
  if (!text) return '住所不明';
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
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/[0-9０-９一二三四五六七八九十]+丁目/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function LoadingSpinner({ label = '読み込み中' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
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
  const [summaryWindow, setSummaryWindow] = useState<CommunityWindow>('24h');

  const { data: siteData } = useSWR(id ? `/api/shelters/${id}` : null, fetcher, { dedupingInterval: 10_000 });
  const site: any = useMemo(() => {
    if (siteData?.site) return siteData.site;
    if (id && typeof id === 'string') {
      const local = getShelterFromStorage(id);
      if (local) return local;
    }
    return null;
  }, [siteData, id]);
  const siteLoading = Boolean(id && !siteData && !site);
  const siteError = Boolean(siteData?.fetchStatus === 'DOWN' || siteData?.lastError);

  const communityUrl = id
    ? `/api/store/shelter?id=${id}${deviceId ? `&deviceId=${encodeURIComponent(deviceId)}` : ''}&window=${summaryWindow}`
    : null;
  const { data: community, error: communityError, mutate: mutateCommunity } = useSWR(communityUrl, fetcher, {
    refreshInterval: communityRefresh,
    keepPreviousData: true,
  });

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
  const totalVotes = typeof community?.totalVotes === 'number'
    ? community.totalVotes
    : Object.values(votesSummary).reduce((acc, value) => acc + (typeof value === 'number' ? value : 0), 0);
  const contributorCount = typeof community?.contributorCount === 'number' ? community.contributorCount : 0;
  const activePostCount = typeof community?.activePostCount === 'number' ? community.activePostCount : 0;
  const activePostLimit = typeof community?.activePostLimit === 'number' ? community.activePostLimit : 5;
  const communityLoadPending = Boolean(communityUrl && !community && !communityError);
  const communityUnavailable = Boolean(communityError || community?.ok === false);
  const topVote = useMemo(() => {
    if (totalVotes <= 0) return null;
    const entries = Object.entries(votesSummary);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] ?? null;
  }, [totalVotes, votesSummary]);
  const detailFields = useMemo(() => normalizeShelterFields(site?.shelter_fields ?? null), [site?.shelter_fields]);
  const eligibilityFields = useMemo(() => normalizeEligibilityFields(site?.shelter_fields ?? null), [site?.shelter_fields]);

  const voteOptions = useMemo(
    () => [
      { value: 'ok', label: '余裕あり', badge: 'bg-emerald-50 text-emerald-900 ring-emerald-200' },
      { value: 'crowded', label: '混雑', badge: 'bg-amber-50 text-amber-900 ring-amber-200' },
      { value: 'very_crowded', label: 'かなり混雑', badge: 'bg-orange-50 text-orange-900 ring-orange-200' },
      { value: 'closed', label: '閉鎖', badge: 'bg-red-50 text-red-900 ring-red-200' },
      { value: 'blocked', label: '危険/通行困難', badge: 'bg-red-50 text-red-900 ring-red-200' },
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

  useEffect(() => {
    if (typeof community?.currentUserVote === 'string') {
      setSelectedVote(community.currentUserVote);
      return;
    }
    if (community) setSelectedVote(null);
  }, [community?.currentUserVote, community]);

  return (
    <div className="space-y-6">
      <Seo title={site?.name ? `${site.name}（避難場所）` : '避難場所'} />

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/list" className="inline-flex min-h-[36px] items-center text-sm text-blue-600 hover:underline">
            ← 一覧へ
          </Link>
          {siteLoading ? (
            <div className="mt-2 rounded-xl border bg-white px-3 py-3 shadow-sm" aria-label="避難場所を読み込み中">
              <div className="text-base font-bold text-gray-900">
                <LoadingSpinner label="避難場所データを読み込んでいます" />
              </div>
              <div className="mt-1 text-sm text-gray-600">住所・地図・混雑状況を確認しています。</div>
            </div>
          ) : (
            <>
              <h1 className="mt-2 text-2xl font-bold">{site?.name ?? '避難場所が見つかりません'}</h1>
              <div className="mt-1 text-sm text-gray-700">{site ? formatPrefCityLabel(site.pref_city, site.address) : 'データ取得後に所在地を表示します'}</div>
            </>
          )}
          {siteError && (
            <div className="mt-2 rounded-xl border bg-amber-50 px-3 py-2 text-sm text-amber-900">
              避難場所データの取得が遅れています。保存済みデータがあれば表示します。
            </div>
          )}
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

              // Offline Storage
              if (!isFavorite && site) { // Saving
                saveShelterToStorage({
                  id: id,
                  name: site.name,
                  address: site.address,
                  pref_city: site.pref_city,
                  lat: site.lat,
                  lon: site.lon,
                  hazards: site.hazards,
                  updatedAt: new Date().toISOString(),
                  is_same_address_as_shelter: Boolean(site.is_same_address_as_shelter),
                  source_updated_at: site.source_updated_at,
                  updated_at: site.updated_at,
                  notes: site.notes,
                } as any);
              } else if (isFavorite) { // Removing
                removeShelterFromStorage(id);
              }
            }}
            className={classNames(
              'min-h-[44px] rounded-xl px-3 py-2 text-sm font-semibold',
              isFavorite ? 'bg-amber-500 text-white ring-amber-600 hover:bg-amber-600' : 'bg-white text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50'
            )}
          >
            {isFavorite ? '★ 保存済み' : '☆ 保存'}
          </button>
          <a
            href={googleMapsRouteUrl({ origin, dest: dest ?? { lat: 0, lon: 0 } })} // dest might be null but link only clickable if dest exists? Or we handle dest check inside.
            target="_blank"
            rel="noreferrer"
            className={classNames(
              "inline-flex min-h-[44px] items-center rounded-xl px-3 py-2 text-sm font-semibold",
              dest ? "bg-gray-900 text-white hover:bg-black" : "hidden" // Hide if no dest
            )}
          >
            Google Mapsで最短ルート
          </a>
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

      {/* Hazard compatibility chips */}
      {site?.hazards && (
        <div className="mt-2">
          <HazardChips hazards={site.hazards} showUnsupported={true} maxVisible={8} size="sm" />
        </div>
      )}

      {!site?.notes && eligibilityFields.length === 0 && detailFields.length === 0 ? null : (
        <section className="rounded-lg bg-white p-5 shadow">
          {site?.notes && (
            <div className="mb-4 rounded border bg-gray-50 px-3 py-2 text-sm text-gray-800">
              <div className="font-semibold">備考</div>
              <div className="mt-1 whitespace-pre-wrap text-sm">{sanitizeNoteText(site.notes)}</div>
            </div>
          )}

          {eligibilityFields.length > 0 && (
            <div className="mb-4 rounded border bg-gray-50 px-3 py-2 text-sm text-gray-800">
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
            <div className="mb-4 rounded border bg-gray-50 px-3 py-2 text-sm text-gray-800">
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


        </section>
      )}

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">地図</h2>
        <div className="mt-2 text-xs text-gray-600">避難場所の位置を表示します。</div>
        <div className="mt-3">
          {siteLoading ? (
            <div className="flex h-[360px] items-center justify-center rounded-xl border bg-gray-50 text-sm font-semibold text-gray-700" aria-label="地図を読み込み中">
              <LoadingSpinner label="地図を準備しています" />
            </div>
          ) : dest ? (
            <MapView
              sites={mapSites as any}
              center={dest}
              initialZoom={14}
              origin={origin}
              fromAreaLabel={shareFromArea}
              onSelect={() => undefined}
            />
          ) : (
            <div className="rounded-xl border bg-gray-50 px-3 py-3 text-sm text-gray-600">座標が確認できないため地図を表示できません。</div>
          )}
        </div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">混雑状況（投票/コメント）</h2>
        <div className="mt-2 text-xs text-gray-600">
          個人情報は書かないでください。多数報告があるコメントは自動的に折りたたまれます。
        </div>
        <div className="mt-3 inline-flex rounded-xl border bg-white p-1 text-sm">
          {([
            { key: '24h', label: '24時間' },
            { key: '3d', label: '3日' },
            { key: '7d', label: '7日' },
          ] as Array<{ key: CommunityWindow; label: string }>).map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={classNames(
                'min-h-[36px] rounded-lg px-3 py-1.5 font-semibold',
                summaryWindow === tab.key ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
              )}
              onClick={() => setSummaryWindow(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {communityLoadPending && (
          <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-4 text-sm text-gray-700" aria-label="混雑状況を読み込み中">
            <div className="font-semibold">
              <LoadingSpinner label="共有された混雑状況を読み込んでいます" />
            </div>
            <div className="mt-1 text-xs text-gray-600">投票・コメントは取得でき次第ここに表示します。</div>
          </div>
        )}
        {communityUnavailable && (
          <div className="mt-3 rounded-xl border bg-amber-50 px-3 py-3 text-sm text-amber-900">
            混雑状況の取得に失敗しました。時間をおいて再読み込みしてください。
          </div>
        )}
        {community && community.ok !== false && (
          <>
            <div className="mt-3 rounded border bg-gray-50 px-3 py-2 text-sm">
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                  <span className="font-semibold text-gray-700">現在:</span>
                  <span className="ml-1 text-lg font-bold">
                    {topVote ? (voteOptions.find(o => o.value === topVote)?.label ?? topVote) : '情報なし'}
                  </span>
                </div>
                <div className="text-gray-600 text-xs">
                  投稿者 {contributorCount}人 / 投票 {totalVotes}件 / 最終更新: {formatUpdatedAt(community.updatedAt)}
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-600">自分の避難所投稿 {activePostCount} / {activePostLimit}</div>
              {totalVotes > 0 && (
                <div className="mt-3 space-y-2">
                  {voteOptions.map((opt) => {
                    const count = votesSummary[opt.value] ?? 0;
                    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    return (
                      <div key={opt.value} className="grid grid-cols-[88px_1fr_44px] items-center gap-2 text-xs">
                        <div className="font-semibold text-gray-700">{opt.label}</div>
                        <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-gray-200">
                          <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-right text-gray-600">{count}件</div>
                      </div>
                    );
                  })}
                </div>
              )}
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
	                      'min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:bg-gray-100',
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
                  maxLength={140}
                  value={voteComment}
                  onChange={(e) => setVoteComment(e.target.value)}
                  placeholder="例: 入口は開いています / 受付に列があります"
                />
                <div className="mt-1 text-xs text-gray-500">{voteComment.length} / 140</div>
              </div>

              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
	                <div className="flex flex-col gap-2 sm:flex-row">
	                  <button
	                    className="min-h-[44px] rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
                    disabled={!deviceId || submitBusy}
                    onClick={async () => {
                      setSubmitError(null);
                      setSubmitNotice(null);
                      if (!deviceId || !id) return;
                      if (!selectedVote) {
                        setSubmitError('投票状況は必須です');
                        return;
                      }
                      const commentText = voteComment.trim();
                      setSubmitBusy(true);
                      try {
                        const voteRes = await fetch('/api/store/shelter/vote', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ shelterId: id, deviceId, value: selectedVote, comment: commentText }),
                        });
                        const voteJson = await voteRes.json().catch(() => null);
                        if (!voteRes.ok || voteJson?.ok === false) {
                          if (voteRes.status === 409 && voteJson?.errorCode === 'ACTIVE_POST_LIMIT_REACHED') {
                            const names = Array.isArray(voteJson?.activePosts)
                              ? voteJson.activePosts
                                  .map((p: any) => (typeof p?.siteName === 'string' ? p.siteName : null))
                                  .filter(Boolean)
                                  .slice(0, 5)
                                  .join(' / ')
                              : '';
                            setSubmitError(names ? `投稿は最大5件です（現在: ${names}）` : '投稿は最大5件です');
                          } else {
                            setSubmitError(voteJson?.error ?? '送信できませんでした');
                          }
                          return;
                        }

                        const entry: VoteHistoryEntry = {
                          id: `${Date.now()}`,
                          status: selectedVote,
                          comment: commentText || 'コメントなし',
                          createdAt: new Date().toISOString(),
                        };
                        setVoteHistory((prev) => {
                          const nextHistory = [entry, ...prev].slice(0, 10);
                          saveVoteHistory(id, nextHistory);
                          return nextHistory;
                        });
                        setVoteComment('');
                        setSubmitNotice(community?.currentUserVote ? '更新しました' : '送信しました');
                        if (voteJson?.community) {
                          await mutateCommunity(voteJson.community, { revalidate: false });
                        }
                        await mutateCommunity();
                      } finally {
                        setSubmitBusy(false);
                      }
                    }}
                  >
                    {community?.currentUserVote ? '投稿を更新する' : '投稿する'}
                  </button>
	                  <button
	                    className="min-h-[44px] rounded-xl bg-white border border-gray-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-gray-50 disabled:opacity-50"
                    disabled={!deviceId || submitBusy}
                    onClick={async () => {
                      if (!confirm('この避難所への自分の投稿（投票・コメント）を削除しますか？')) return;
                      setSubmitError(null);
                      setSubmitNotice(null);
                      setSubmitBusy(true);
                      try {
                        const res = await fetch('/api/store/shelter/vote', {
                          method: 'DELETE',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ shelterId: id, deviceId }),
                        });
                        if (!res.ok) {
                          const j = await res.json().catch(() => null);
                          setSubmitError(j?.error ?? '削除できませんでした');
                          return;
                        }
                        const j = await res.json().catch(() => null);
                        setSubmitNotice('削除しました');
                        setSelectedVote(null);
                        setVoteComment('');
                        if (j?.community) {
                          await mutateCommunity(j.community, { revalidate: false });
                        }
                        await mutateCommunity();
                      } finally {
                        setSubmitBusy(false);
                      }
                    }}
                  >
                    自分の投稿を削除する
                  </button>
                </div>
                <div className="text-xs text-gray-600">同じ端末の投票は最新の1件として集計されます。</div>
              </div>

              {Array.isArray(community.activePosts) && community.activePosts.length > 0 && (
                <div className="mt-3 rounded border bg-white px-3 py-2 text-xs text-gray-700">
                  <div className="font-semibold">自分の有効投稿</div>
                  <div className="mt-1 space-y-1">
                    {community.activePosts.map((post: any) => (
                      <div key={`${post.siteId}:${post.reportedAt}`} className="truncate">
                        {post.siteName ?? '避難場所'} / {voteOptions.find((v) => v.value === post.conditionKind)?.label ?? post.conditionKind}
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
