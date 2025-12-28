import type { GetServerSideProps } from 'next';
import { SeoHead } from '../components/SeoHead';
import { useEffect, useState } from 'react';

export const getServerSideProps: GetServerSideProps = async () => {
  const adminEnabled = Boolean(process.env.ADMIN_API_KEY) || (Boolean(process.env.ADMIN_BASIC_USER) && Boolean(process.env.ADMIN_BASIC_PASS));
  return { props: { adminEnabled } };
};

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

export default function OpsPage({ adminEnabled }: { adminEnabled: boolean }) {
  const [token, setToken] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerDraft, setBannerDraft] = useState<string>('');
  const [moderation, setModeration] = useState<any>(null);
  const [jmaStatus, setJmaStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeader: Record<string, string> = token ? { 'x-admin-key': token } : {};

  useEffect(() => {
    void (async () => {
      try {
        const b = await fetchJson('/api/store/banner');
        setBanner(b?.banner?.text ?? null);
        setBannerDraft(b?.banner?.text ?? '');
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchJson('/api/jma/status');
        setJmaStatus(s);
      } catch {
        // ignore
      }
    })();
  }, []);

  const loadModeration = async () => {
    setError(null);
    try {
      const m = await fetchJson('/api/store/admin/moderation', { headers: { ...authHeader } });
      setModeration(m?.moderation ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <SeoHead title="Ops" />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ops（最小管理）</h1>
      </div>

      {!adminEnabled && (
        <section className="rounded-lg border bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">無効</div>
          <div className="mt-1">サーバ側で `ADMIN_API_KEY` または `ADMIN_BASIC_*` が設定されていないため、管理画面は無効です。</div>
        </section>
      )}

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">管理トークン</h2>
        <div className="mt-2 text-xs text-gray-600">`x-admin-key: &lt;token&gt;` を使用します。端末に保存しません。</div>
        <input
          className="mt-2 w-full rounded border px-3 py-2 text-sm"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ADMIN_API_KEY を入力"
          disabled={!adminEnabled}
        />
        {error && <div className="mt-2 text-sm text-red-700">{error}</div>}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">緊急バナー</h2>
        <div className="mt-2 text-xs text-gray-600">トップ等に表示される緊急メッセージです。</div>
        <textarea className="mt-2 w-full rounded border p-2 text-sm" rows={4} value={bannerDraft} onChange={(e) => setBannerDraft(e.target.value)} disabled={!adminEnabled} />
        <div className="mt-2 flex gap-2">
          <button
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
            disabled={!adminEnabled || !token}
            onClick={async () => {
              setError(null);
              try {
                const r = await fetchJson('/api/store/admin/banner', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', ...authHeader },
                  body: JSON.stringify({ text: bannerDraft.trim() ? bannerDraft : null }),
                });
                setBanner(r?.banner?.text ?? null);
                alert('更新しました');
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            更新
          </button>
          <button
            className="rounded bg-gray-100 px-4 py-2 text-sm text-gray-900 hover:bg-gray-200"
            onClick={() => setBannerDraft(banner ?? '')}
          >
            元に戻す
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-600">現在: {banner ?? '（なし）'}</div>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">モデレーションキュー</h2>
          <button
            className="rounded bg-gray-900 px-3 py-2 text-sm text-white hover:bg-black disabled:bg-gray-300"
            disabled={!adminEnabled || !token}
            onClick={loadModeration}
          >
            更新
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-600">通報が閾値を超えたコメントが表示されます。</div>

        {!moderation && <div className="mt-3 text-sm text-gray-600">未読み込み</div>}
        {moderation && moderation.queue?.length === 0 && <div className="mt-3 text-sm text-gray-600">キューは空です。</div>}

        {moderation && moderation.queue?.length > 0 && (
          <div className="mt-3 space-y-2">
            {moderation.queue.map((q: any) => (
              <div key={q.id} className="rounded border bg-gray-50 px-3 py-2 text-sm">
                <div className="font-semibold">shelter: （ID非表示）</div>
                <div className="mt-1 text-xs text-gray-700">
                  comment: （ID非表示） / reports: {q.reportCount} / at: {q.createdAt}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['HIDE_COMMENT', 'UNHIDE_COMMENT', 'DELETE_FROM_QUEUE'] as const).map((action) => (
                    <button
                      key={action}
                      className="rounded bg-white px-2 py-1 text-xs text-gray-800 hover:bg-gray-100"
                      onClick={async () => {
                        setError(null);
                        try {
                          await fetchJson('/api/store/admin/moderation', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json', ...authHeader },
                            body: JSON.stringify({ action, shelterId: q.shelterId, commentId: q.commentId }),
                          });
                          await loadModeration();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">JMA 取得状況</h2>
        {!jmaStatus && <div className="mt-3 text-sm text-gray-600">未取得</div>}
        {jmaStatus && <div className="mt-3 text-sm text-gray-700">取得済み（詳細はログ/監視で確認）</div>}
      </section>
    </div>
  );
}
