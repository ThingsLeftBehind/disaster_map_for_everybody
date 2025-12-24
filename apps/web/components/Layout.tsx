import Link from 'next/link';
import useSWR from 'swr';
import { useDevice } from './device/DeviceProvider';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { shapeAlertWarnings } from '../lib/jma/alerts';
import { useRouter } from 'next/router';
import { useAreaName } from '../lib/client/areaName';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '未取得';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return '未取得';
  return new Date(t).toLocaleString();
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string;
  tone: 'ok' | 'warn' | 'down' | 'neutral';
}) {
  const colors =
    tone === 'ok'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-900 ring-amber-200'
        : tone === 'down'
          ? 'bg-red-50 text-red-800 ring-red-200'
          : 'bg-gray-50 text-gray-800 ring-gray-200';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ${colors}`}>
      <span className="font-bold tracking-wide">{label}</span>
      {value ? <span>{value}</span> : null}
    </span>
  );
}

function NavIcon({
  name,
  active,
}: {
  name: 'shelter' | 'alerts' | 'quakes' | 'hazard';
  active: boolean;
}) {
  const cls = `h-5 w-5 ${active ? 'text-current' : 'text-gray-500'}`;
  switch (name) {
    case 'shelter':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.5 20v-6.5h5V20" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'alerts':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 9v5" strokeLinecap="round" />
          <path d="M12 17h.01" strokeLinecap="round" />
          <path
            d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'quakes':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 12h4l2-6 4 12 2-6h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'hazard':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3c4 5 7 8 7 12a7 7 0 0 1-14 0c0-4 3-7 7-12Z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 14c-1.5 1-2.5 2-2.5 3.2A2.5 2.5 0 0 0 12 20a2.5 2.5 0 0 0 2.5-2.8C14.5 16 13.5 15 12 14Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

function HelpPopover({ online, jmaUpdatedAt }: { online: boolean; jmaUpdatedAt: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-800 hover:bg-gray-200"
        aria-label="ヘルプ"
      >
        ?
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          className="fixed right-2 top-16 z-[9999] w-[280px] max-w-[calc(100vw-16px)] max-h-[70vh] overflow-auto rounded-xl border bg-white p-3 text-xs text-gray-800 shadow-lg sm:absolute sm:right-0 sm:top-auto sm:mt-2"
        >
          <div className="font-semibold">状態の見かた</div>
          <ul className="mt-2 space-y-1 text-gray-700">
            <li>
              <span className="font-semibold text-emerald-700">OK</span>: 直近の取得に成功
            </li>
            <li>
              <span className="font-semibold text-amber-800">DEGRADED</span>: 最新でない可能性（通信/取得失敗など）
            </li>
            <li>
              <span className="font-semibold text-red-700">DOWN</span>: まだ一度も取得できていない
            </li>
            <li className="pt-1 text-gray-600">
              {online
                ? 'オンラインでも遅延・欠落があり得ます。公式情報も確認してください。'
                : 'オフラインのためキャッシュ表示です。最新でない可能性があります。'}
            </li>
          </ul>
          <div className="mt-2 rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-700">
            Last updated: {formatUpdatedAt(jmaUpdatedAt)}
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex h-10 w-full items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold ring-1 ring-inset transition sm:h-12 sm:min-w-[110px] sm:gap-2 sm:px-4 sm:text-sm ${active ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-900 ring-gray-200 hover:bg-gray-50'
        }`}
    >
      <span className={`${active ? 'text-white' : ''}`}>{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { device, selectedJmaAreaCode, currentJmaAreaCode, coarseArea, online } = useDevice();
  const { label: coarseAreaLabel } = useAreaName({ prefCode: coarseArea?.prefCode ?? null, muniCode: coarseArea?.muniCode ?? null });
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;

  const { data: bannerData } = useSWR('/api/store/banner', fetcher, { dedupingInterval: 10_000 });
  const bannerText: string | null = bannerData?.banner?.text ?? null;

  const selectedWarningsUrl = selectedJmaAreaCode ? `/api/jma/warnings?area=${selectedJmaAreaCode}` : null;
  const { data: selectedWarnings } = useSWR(selectedWarningsUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const selectedArea =
    device?.settings?.selectedAreaId && device?.savedAreas
      ? device.savedAreas.find((a) => a.id === device.settings.selectedAreaId) ?? null
      : null;
  const selectedShape = useMemo(
    () =>
      shapeAlertWarnings({
        warnings: selectedWarnings,
        area: {
          prefCode: selectedArea?.prefCode ?? null,
          muniCode: selectedArea?.muniCode ?? null,
          label: selectedArea?.muniName ?? selectedArea?.label ?? null,
        },
      }),
    [selectedArea?.label, selectedArea?.muniCode, selectedArea?.muniName, selectedArea?.prefCode, selectedWarnings]
  );
  const selectedCount = selectedShape.counts.total;
  const selectedCounts = selectedShape.counts;

  const currentWarningsUrl =
    currentJmaAreaCode && currentJmaAreaCode !== selectedJmaAreaCode ? `/api/jma/warnings?area=${currentJmaAreaCode}` : null;
  const { data: currentWarnings } = useSWR(currentWarningsUrl, fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const currentShape = useMemo(
    () =>
      shapeAlertWarnings({
        warnings: currentWarnings,
        area: {
          prefCode: coarseArea?.prefCode ?? null,
          muniCode: coarseArea?.muniCode ?? null,
          label: coarseAreaLabel ?? null,
        },
      }),
    [coarseArea?.prefCode, coarseArea?.muniCode, coarseAreaLabel, currentWarnings]
  );
  const currentCount = currentShape.counts.total;
  const currentCounts = currentShape.counts;

  const warningCount = selectedCount > 0 ? selectedCount : currentCount;
  const warningSource = selectedCount > 0 ? 'selected' : currentCount > 0 ? 'current' : null;
  const bannerCounts = warningSource === 'selected' ? selectedCounts : warningSource === 'current' ? currentCounts : null;
  const bannerUrgentCount = bannerCounts?.urgent ?? 0;
  const bannerAdvisoryCount = bannerCounts?.advisory ?? 0;

  const { data: jmaStatus } = useSWR('/api/jma/status', fetcher, { refreshInterval: refreshMs, dedupingInterval: 10_000 });
  const rawJmaFetchStatus: 'OK' | 'DEGRADED' = jmaStatus?.fetchStatus === 'OK' ? 'OK' : 'DEGRADED';
  const jmaUpdatedAt: string | null = typeof jmaStatus?.updatedAt === 'string' ? jmaStatus.updatedAt : null;
  const hasJmaStatus = Boolean(jmaStatus && typeof jmaStatus === 'object');

  const [jmaClientHealth, setJmaClientHealth] = useState<{
    firstSeenAtMs: number;
    consecutiveFailures: number;
    lastFailureAtMs: number;
  }>({ firstSeenAtMs: 0, consecutiveFailures: 0, lastFailureAtMs: 0 });

  useEffect(() => {
    if (!hasJmaStatus) return;
    const nowMs = Date.now();
    setJmaClientHealth((prev) => {
      const firstSeenAtMs = prev.firstSeenAtMs || nowMs;
      if (!online) {
        if (firstSeenAtMs === prev.firstSeenAtMs) return prev;
        return { ...prev, firstSeenAtMs };
      }

      if (rawJmaFetchStatus !== 'OK') {
        return {
          firstSeenAtMs,
          consecutiveFailures: Math.min(prev.consecutiveFailures + 1, 99),
          lastFailureAtMs: nowMs,
        };
      }

      if (prev.consecutiveFailures === 0 && firstSeenAtMs === prev.firstSeenAtMs) return prev;
      return {
        ...prev,
        firstSeenAtMs,
        consecutiveFailures: 0,
      };
    });
  }, [hasJmaStatus, online, rawJmaFetchStatus]);

  const jmaStatusLabel: 'OK' | 'DEGRADED' | 'DOWN' = useMemo(() => {
    const nowMs = Date.now();
    const recentWindowMs = refreshMs * 3;
    const downGraceMs = refreshMs * 3;

    const recentFailure = jmaClientHealth.lastFailureAtMs > 0 && nowMs - jmaClientHealth.lastFailureAtMs <= recentWindowMs;
    const downByStreak = jmaClientHealth.consecutiveFailures >= 3;
    const downByNeverSuccess =
      !jmaUpdatedAt && jmaClientHealth.firstSeenAtMs > 0 && nowMs - jmaClientHealth.firstSeenAtMs > downGraceMs;

    if (downByStreak || downByNeverSuccess) return 'DOWN';
    if (rawJmaFetchStatus === 'OK' && !recentFailure) return 'OK';
    return 'DEGRADED';
  }, [jmaClientHealth.consecutiveFailures, jmaClientHealth.firstSeenAtMs, jmaClientHealth.lastFailureAtMs, jmaUpdatedAt, rawJmaFetchStatus, refreshMs]);

  const jmaTone: 'ok' | 'warn' | 'down' = jmaStatusLabel === 'OK' ? 'ok' : jmaStatusLabel === 'DEGRADED' ? 'warn' : 'down';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <Link href="/main" className="group truncate transition-opacity hover:opacity-80">
                <div className="truncate text-2xl font-bold tracking-tight text-gray-900">
                  避難ナビ（HinaNavi）
                </div>
                <div className="truncate text-sm font-medium text-gray-600">災害から身を守る避難を</div>
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/main"
                className={`inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-semibold ring-1 ring-inset transition ${router.pathname === '/main' || router.pathname === '/'
                  ? 'bg-blue-600 text-white ring-blue-600'
                  : 'bg-white text-gray-900 ring-gray-200 hover:bg-gray-50'
                  }`}
              >
                メイン
              </Link>
              <Chip label="JMA" value={jmaStatusLabel} tone={jmaTone} />
              <Chip label={online ? 'Online' : 'Offline'} tone={online ? 'ok' : 'down'} />

              <HelpPopover online={online} jmaUpdatedAt={jmaUpdatedAt} />
            </div>
          </div>

          <nav className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            <NavItem
              href="/list"
              label="避難場所"
              icon={<NavIcon name="shelter" active={router.pathname.startsWith('/list') || router.pathname.startsWith('/shelters')} />}
              active={router.pathname.startsWith('/list') || router.pathname.startsWith('/shelters')}
            />
            <NavItem
              href="/alerts"
              label="警報"
              icon={<NavIcon name="alerts" active={router.pathname.startsWith('/alerts')} />}
              active={router.pathname.startsWith('/alerts')}
            />
            <NavItem
              href="/quakes"
              label="地震"
              icon={<NavIcon name="quakes" active={router.pathname.startsWith('/quakes')} />}
              active={router.pathname.startsWith('/quakes')}
            />
            <NavItem
              href="/hazard"
              label="ハザード"
              icon={<NavIcon name="hazard" active={router.pathname.startsWith('/hazard')} />}
              active={router.pathname.startsWith('/hazard')}
            />
          </nav>
        </div>

        {bannerText && (
          <div className="border-t bg-amber-50">
            <div className="mx-auto max-w-6xl px-4 py-2 text-sm text-amber-900">{bannerText}</div>
          </div>
        )}

        {(selectedWarningsUrl || currentWarningsUrl) && warningCount > 0 && (
          <div className="border-t bg-red-50">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-semibold text-red-900">
                警報 {bannerUrgentCount}種類 / 注意報 {bannerAdvisoryCount}種類 — 公式情報を確認してください。
                {warningSource === 'current' && (
                  <span className="ml-2 text-xs font-normal text-red-800">現在地: {coarseAreaLabel ?? 'エリア未確定'}</span>
                )}
              </div>
              <Link href="/alerts" className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700">
                警報ページへ
              </Link>
            </div>
          </div>
        )}

        {selectedWarningsUrl && selectedCount === 0 && selectedWarnings && (
          <div className="border-t bg-gray-50">
            <div className="mx-auto max-w-6xl px-4 py-2 text-xs text-gray-600">
              警報情報: 最終取得 {formatUpdatedAt(selectedWarnings.updatedAt)}
              {selectedWarnings.updatedAt ? '' : '（まだ取得できていません）'}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <footer className="mt-10 border-t bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-sm text-gray-700 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div>データは遅延・誤差があり得ます。必ず自治体・公式発表を優先してください。</div>
            <Link href="/sources" className="text-blue-600 hover:underline">
              出典・注意事項
            </Link>
          </div>
          <div className="text-xs text-gray-500">DBは参照のみ / 端末データはローカル保存</div>
        </div>
      </footer>
    </div>
  );
}
