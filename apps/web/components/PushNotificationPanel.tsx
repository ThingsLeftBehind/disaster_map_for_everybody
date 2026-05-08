import { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useDevice } from './device/DeviceProvider';

type PushStatus = {
  ok: boolean;
  enabled?: boolean;
  count?: number;
};

const PUSH_STEP_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, code: string, timeoutMs = PUSH_STEP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

export function PushNotificationPanel() {
  const { deviceId } = useDevice();
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown');
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  const canUsePush = supported && Boolean(deviceId);

  const loadStatus = async () => {
    if (!deviceId) return;
    const res = await withTimeout(fetch(`/api/push/status?deviceId=${encodeURIComponent(deviceId)}`), 'status_timeout', 8_000);
    const json: PushStatus | null = await res.json().catch(() => null);
    if (!res.ok || json?.ok === false) throw new Error('status_failed');
    setEnabled(Boolean(json?.enabled));
    setCount(typeof json?.count === 'number' ? json.count : 0);
  };

  useEffect(() => {
    const nextSupported = isPushSupported();
    setSupported(nextSupported);
    if (nextSupported) setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (!deviceId || !supported) return;
    void loadStatus().catch(() => {
      setMessage({ kind: 'error', text: '通知の状態を取得できませんでした' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, supported]);

  const statusLabel = useMemo(() => {
    if (!supported) return 'このブラウザでは通知に対応していません';
    if (permission === 'denied') return 'ブラウザで通知が拒否されています';
    if (enabled) return '通知は有効です';
    return '通知は未設定です';
  }, [enabled, permission, supported]);

  const enablePush = async () => {
    if (!deviceId) {
      setMessage({ kind: 'error', text: '端末の準備が完了していません' });
      return;
    }
    if (!supported) {
      setMessage({ kind: 'error', text: 'このブラウザでは通知に対応していません' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const permissionResult = await withTimeout(Notification.requestPermission(), 'permission_timeout', 30_000);
      setPermission(permissionResult);
      if (permissionResult !== 'granted') {
        setMessage({ kind: 'error', text: permissionResult === 'denied' ? 'ブラウザで通知が拒否されています' : '通知が許可されませんでした' });
        return;
      }

      const keyRes = await withTimeout(fetch('/api/push/vapid-public-key'), 'vapid_timeout');
      const keyJson = await keyRes.json().catch(() => null);
      if (!keyRes.ok || keyJson?.ok === false || typeof keyJson?.publicKey !== 'string') throw new Error('vapid_missing');

      const registration = await withTimeout(navigator.serviceWorker.register('/sw.js'), 'service_worker_failed');
      await withTimeout(navigator.serviceWorker.ready, 'service_worker_failed');
      const existing = await withTimeout(registration.pushManager.getSubscription(), 'subscribe_failed');
      const subscription =
        existing ??
        (await withTimeout(
          registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey).buffer as ArrayBuffer,
          }),
          'subscribe_failed'
        ));

      const res = await withTimeout(
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceId, subscription: subscription.toJSON() }),
        }),
        'server_save_failed'
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) throw new Error('server_save_failed');
      setEnabled(true);
      setCount((current) => Math.max(current, 1));
      await loadStatus().catch(() => undefined);
      setMessage({ kind: 'success', text: '通知を有効にしました' });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      const text =
        code === 'vapid_missing' || code === 'vapid_timeout'
          ? '通知の設定が未完了です'
          : code === 'service_worker_failed'
            ? '通知の準備に失敗しました'
            : code === 'server_save_failed'
              ? '通知設定を保存できませんでした'
              : code === 'subscribe_failed'
                ? '通知を有効にできませんでした'
                : code === 'permission_timeout'
                  ? '通知の許可操作が完了しませんでした'
                  : '通知を有効にできませんでした';
      setMessage({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  };

  const disablePush = async () => {
    if (!deviceId || !supported) return;
    setBusy(true);
    setMessage(null);
    try {
      const registration = await withTimeout(navigator.serviceWorker.ready, 'service_worker_failed');
      const subscription = await withTimeout(registration.pushManager.getSubscription(), 'unsubscribe_failed');
      const endpoint = subscription?.endpoint ?? null;
      if (subscription) await subscription.unsubscribe().catch(() => false);
      const res = await withTimeout(
        fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceId, endpoint }),
        }),
        'unsubscribe_failed'
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) throw new Error('unsubscribe_failed');
      await loadStatus();
      setEnabled(false);
      setMessage({ kind: 'success', text: '通知を停止しました' });
    } catch {
      setMessage({ kind: 'error', text: '通知を停止できませんでした' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-4 shadow sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">通知の準備</h2>
          <p className="mt-1 text-sm text-gray-600">登録した場所の警報・注意報を通知できるようにします。</p>
          <p className="mt-1 text-xs text-gray-500">iPhoneではホーム画面に追加後、通知を利用できる場合があります。</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {!enabled ? (
            <button
              type="button"
              disabled={!canUsePush || permission === 'denied' || busy}
              onClick={() => void enablePush()}
              className="min-h-[44px] rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
            >
              {busy ? '処理中...' : '通知を有効にする'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void disablePush()}
              className="min-h-[44px] rounded-xl bg-white px-4 py-2 text-sm font-bold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-60"
            >
              {busy ? '処理中...' : '通知を停止する'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span
          className={classNames(
            'rounded-full px-2.5 py-1 text-xs font-bold ring-1',
            enabled ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-gray-100 text-gray-700 ring-gray-200'
          )}
        >
          {statusLabel}
        </span>
        {enabled && count > 1 && <span className="text-xs text-gray-500">{count}件の購読</span>}
      </div>

      {message && (
        <div
          className={classNames(
            'mt-3 rounded-xl px-3 py-2 text-sm',
            message.kind === 'success'
              ? 'bg-emerald-50 text-emerald-900'
              : message.kind === 'error'
                ? 'bg-red-50 text-red-900'
                : 'bg-gray-50 text-gray-700'
          )}
        >
          {message.text}
        </div>
      )}
    </section>
  );
}
