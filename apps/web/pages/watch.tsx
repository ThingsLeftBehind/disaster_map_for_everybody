import Link from 'next/link';
import useSWR from 'swr';
import { FormEvent, useMemo, useState } from 'react';
import classNames from 'classnames';
import { Seo } from '../components/Seo';
import { useDevice } from '../components/device/DeviceProvider';

type PlaceType = 'home' | 'school' | 'work' | 'family' | 'other';

type SavedPlaceRegion = {
  id: string;
  placeType: PlaceType;
  placeTypeLabel: string;
  label: string;
  addressMemo: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  lat: number;
  lon: number;
  radiusKm: number;
  notifyEnabled: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse = {
  ok: boolean;
  regions?: SavedPlaceRegion[];
  region?: SavedPlaceRegion;
  error?: string;
  errorCode?: string;
};

const PLACE_TYPE_OPTIONS: Array<{ value: PlaceType; label: string }> = [
  { value: 'home', label: '自宅' },
  { value: 'school', label: '学校' },
  { value: 'work', label: '職場' },
  { value: 'family', label: '実家' },
  { value: 'other', label: 'その他' },
];

const DEFAULT_LABEL: Record<PlaceType, string> = {
  home: '自宅',
  school: '学校',
  work: '職場',
  family: '実家',
  other: 'その他',
};

const RADIUS_OPTIONS = [1, 3, 5, 10, 20];

const fetcher = async (url: string): Promise<ApiResponse> => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    const message = typeof json?.error === 'string' ? json.error : '読み込みに失敗しました';
    const error = new Error(message);
    (error as any).payload = json;
    throw error;
  }
  return json;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '未更新';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return '未更新';
  return new Date(t).toLocaleString();
}

function asCoordinateText(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value.toFixed(6);
}

function toNumberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function safeMessage(error: unknown, fallback: string): string {
  const payload = (error as any)?.payload;
  if (payload?.errorCode === 'limit_exceeded') return '登録できる場所は最大10件までです。';
  if (typeof payload?.error === 'string' && payload.error !== 'internal_error') return payload.error;
  return fallback;
}

export default function WatchPage() {
  const { deviceId } = useDevice();
  const apiUrl = deviceId ? `/api/watch-regions?deviceId=${encodeURIComponent(deviceId)}` : null;
  const { data, error, isLoading, mutate } = useSWR(apiUrl, fetcher, { dedupingInterval: 10_000 });
  const regions = useMemo(() => data?.regions ?? [], [data?.regions]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [placeType, setPlaceType] = useState<PlaceType>('home');
  const [label, setLabel] = useState('自宅');
  const [addressMemo, setAddressMemo] = useState('');
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [radiusKm, setRadiusKm] = useState(5);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  const editing = useMemo(() => regions.find((region) => region.id === editingId) ?? null, [editingId, regions]);
  const activeCount = regions.length;

  const resetForm = (nextType: PlaceType = 'home') => {
    setEditingId(null);
    setPlaceType(nextType);
    setLabel(DEFAULT_LABEL[nextType]);
    setAddressMemo('');
    setLatText('');
    setLonText('');
    setRadiusKm(5);
  };

  const startEdit = (region: SavedPlaceRegion) => {
    setEditingId(region.id);
    setPlaceType(region.placeType);
    setLabel(region.label || DEFAULT_LABEL[region.placeType]);
    setAddressMemo(region.addressMemo ?? region.address ?? '');
    setLatText(asCoordinateText(region.latitude ?? region.lat));
    setLonText(asCoordinateText(region.longitude ?? region.lon));
    setRadiusKm(RADIUS_OPTIONS.includes(Math.round(region.radiusKm)) ? Math.round(region.radiusKm) : 5);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePlaceTypeChange = (nextType: PlaceType) => {
    setPlaceType(nextType);
    if (!label.trim() || label === DEFAULT_LABEL[placeType]) {
      setLabel(DEFAULT_LABEL[nextType]);
    }
  };

  const useCurrentLocation = () => {
    setFeedback(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFeedback({ kind: 'error', text: '位置情報を取得できませんでした' });
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatText(asCoordinateText(pos.coords.latitude));
        setLonText(asCoordinateText(pos.coords.longitude));
        setLocating(false);
        setFeedback({ kind: 'info', text: '現在地を入力しました' });
      },
      () => {
        setLocating(false);
        setFeedback({ kind: 'error', text: '位置情報を取得できませんでした' });
      },
      {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 5 * 60_000,
      }
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    if (!deviceId) {
      setFeedback({ kind: 'error', text: '保存できませんでした' });
      return;
    }

    const latitude = toNumberOrNull(latText);
    const longitude = toNumberOrNull(lonText);
    if (latitude === null || latitude < -90 || latitude > 90 || longitude === null || longitude < -180 || longitude > 180) {
      setFeedback({ kind: 'error', text: '緯度・経度を確認してください' });
      return;
    }

    if (!editing && activeCount >= 10) {
      setFeedback({ kind: 'error', text: '登録できる場所は最大10件までです。' });
      return;
    }

    setSaving(true);
    try {
      const endpoint = editing ? `/api/watch-regions/${encodeURIComponent(editing.id)}` : '/api/watch-regions';
      const res = await fetch(endpoint, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          placeType,
          label,
          addressMemo,
          latitude,
          longitude,
          radiusKm,
        }),
      });
      const json: ApiResponse | null = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) {
        const err = new Error(json?.error ?? 'save_failed');
        (err as any).payload = json;
        throw err;
      }

      await mutate();
      setFeedback({ kind: 'success', text: editing ? '更新しました' : '登録しました' });
      resetForm(placeType);
    } catch (err) {
      setFeedback({ kind: 'error', text: safeMessage(err, '保存できませんでした') });
    } finally {
      setSaving(false);
    }
  };

  const deleteRegion = async (region: SavedPlaceRegion) => {
    if (!deviceId) {
      setFeedback({ kind: 'error', text: '削除できませんでした' });
      return;
    }
    if (!window.confirm(`${region.label}を削除しますか？`)) return;

    setDeletingId(region.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/watch-regions/${encodeURIComponent(region.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const json: ApiResponse | null = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) throw new Error(json?.error ?? 'delete_failed');
      if (editingId === region.id) resetForm(placeType);
      await mutate();
      setFeedback({ kind: 'success', text: '削除しました' });
    } catch {
      setFeedback({ kind: 'error', text: '削除できませんでした' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <Seo title="登録済みの場所" description="自宅・学校・職場など、よく確認する場所を端末ごとに登録できます。" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/main" className="text-sm font-semibold text-blue-700 hover:underline">
            メインへ戻る
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">登録済みの場所</h1>
          <div className="mt-1 text-sm text-gray-600">自宅・学校・職場などを端末に登録します。今後の通知設定にも利用します。</div>
        </div>
        <div className="rounded-xl bg-gray-900 px-3 py-2 text-center text-sm font-bold text-white">{activeCount} / 10</div>
      </div>

      <section className="rounded-2xl bg-white p-4 shadow sm:p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold">{editing ? '場所を編集' : '場所を追加'}</h2>
          {editing && (
            <button
              type="button"
              className="min-h-[44px] rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50"
              onClick={() => {
                resetForm(placeType);
                setFeedback(null);
              }}
            >
              新規登録に戻る
            </button>
          )}
        </div>

        <form className="mt-4 space-y-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-gray-800">
              種別
              <select
                className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base"
                value={placeType}
                onChange={(e) => handlePlaceTypeChange(e.target.value as PlaceType)}
              >
                {PLACE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-gray-800">
              表示名
              <input
                className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 px-3 py-2 text-base"
                value={label}
                maxLength={40}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={DEFAULT_LABEL[placeType]}
              />
            </label>
          </div>

          <label className="block text-sm font-semibold text-gray-800">
            住所メモ
            <input
              className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 px-3 py-2 text-base"
              value={addressMemo}
              maxLength={120}
              onChange={(e) => setAddressMemo(e.target.value)}
              placeholder="住所や目印をメモできます"
            />
            <span className="mt-1 block text-xs font-normal text-gray-500">外部の住所検索は使わず、座標は現在地または手入力で登録します。</span>
          </label>

          <div className="rounded-2xl bg-gray-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-bold text-gray-900">座標</div>
                <div className="text-xs text-gray-600">現在地から登録、または緯度・経度を手入力します。</div>
              </div>
              <button
                type="button"
                disabled={locating}
                onClick={useCurrentLocation}
                className="min-h-[44px] rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {locating ? '取得中...' : '現在地から登録'}
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-800">
                緯度
                <input
                  inputMode="decimal"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 px-3 py-2 text-base"
                  value={latText}
                  onChange={(e) => setLatText(e.target.value)}
                  placeholder="35.681236"
                />
              </label>
              <label className="text-sm font-semibold text-gray-800">
                経度
                <input
                  inputMode="decimal"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 px-3 py-2 text-base"
                  value={lonText}
                  onChange={(e) => setLonText(e.target.value)}
                  placeholder="139.767125"
                />
              </label>
            </div>
          </div>

          <label className="block text-sm font-semibold text-gray-800">
            半径
            <select
              className="mt-1 min-h-[44px] w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
            >
              {RADIUS_OPTIONS.map((radius) => (
                <option key={radius} value={radius}>
                  {radius} km
                </option>
              ))}
            </select>
          </label>

          {feedback && (
            <div
              className={classNames(
                'rounded-xl border px-3 py-2 text-sm',
                feedback.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : feedback.kind === 'error'
                    ? 'border-red-200 bg-red-50 text-red-900'
                    : 'border-gray-200 bg-gray-50 text-gray-800'
              )}
            >
              {feedback.text}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !deviceId}
            className="min-h-[48px] w-full rounded-xl bg-gray-900 px-4 py-3 text-base font-extrabold text-white shadow hover:bg-black disabled:opacity-60"
          >
            {saving ? '保存中...' : editing ? '更新する' : '保存する'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">登録済みの場所</h2>
          <button
            type="button"
            className="min-h-[40px] rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50"
            onClick={() => void mutate()}
          >
            再読み込み
          </button>
        </div>

        {!deviceId && <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">端末IDを準備中です。</div>}
        {isLoading && <div className="mt-3 text-sm text-gray-600">読み込み中...</div>}
        {error && <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">登録済みの場所を取得できませんでした。</div>}
        {!isLoading && !error && regions.length === 0 && (
          <div className="mt-3 rounded-xl border bg-gray-50 px-3 py-4 text-center text-sm text-gray-600">まだ登録されていません。</div>
        )}

        {regions.length > 0 && (
          <div className="mt-3 space-y-3">
            {regions.map((region) => (
              <article key={region.id} className="rounded-2xl border bg-gray-50 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-blue-800 ring-1 ring-blue-100">{region.placeTypeLabel}</span>
                      <h3 className="text-base font-bold text-gray-900">{region.label}</h3>
                    </div>
                    {region.addressMemo && <div className="mt-2 text-sm text-gray-700">{region.addressMemo}</div>}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                      <span>半径 {region.radiusKm}km</span>
                      <span>更新 {formatDate(region.updatedAt)}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {asCoordinateText(region.latitude)}, {asCoordinateText(region.longitude)}
                    </div>
                  </div>
                  <div className="flex gap-2 sm:shrink-0">
                    <button
                      type="button"
                      className="min-h-[44px] flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-100 sm:flex-none"
                      onClick={() => startEdit(region)}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === region.id}
                      className="min-h-[44px] flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-60 sm:flex-none"
                      onClick={() => void deleteRegion(region)}
                    >
                      {deletingId === region.id ? '削除中...' : '削除する'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
