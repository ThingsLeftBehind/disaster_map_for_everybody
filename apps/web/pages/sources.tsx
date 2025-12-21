import Head from 'next/head';
import useSWR from 'swr';
import { useDevice } from '../components/device/DeviceProvider';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  if (!updatedAt) return 'No successful fetch yet';
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return 'No successful fetch yet';
  return new Date(t).toLocaleString();
}

export default function SourcesPage() {
  const { device } = useDevice();
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const { data: jmaStatus } = useSWR('/api/jma/status', fetcher, { refreshInterval: refreshMs });
  const lastErrorLabel = jmaStatus?.lastError ? '取得エラー' : 'なし';

  return (
    <div className="space-y-6">
      <Head>
        <title>出典・注意事項 | 全国避難場所ファインダー</title>
      </Head>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">出典・注意事項</h1>
      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">出典</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-800">
          <li>
            気象庁 (JMA) — 地震/警報・注意報（本アプリ内の表示はキャッシュ優先）{' '}
            <a className="text-blue-600 hover:underline" href="https://www.jma.go.jp/" target="_blank" rel="noreferrer">
              https://www.jma.go.jp/
            </a>
          </li>
          <li>
            国土地理院 (GSI) — ハザードタイル/逆ジオコーダ{' '}
            <a className="text-blue-600 hover:underline" href="https://www.gsi.go.jp/" target="_blank" rel="noreferrer">
              https://www.gsi.go.jp/
            </a>
          </li>
          <li>避難場所データ — 公的オープンデータ（DB読み取り専用）</li>
        </ul>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">注意事項（重要）</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-800">
          <li>データは遅延・欠落・誤差があり得ます。必ず自治体/公式情報を優先してください。</li>
          <li>避難所の開設状況・受入可否は自治体の発表が最優先です。本アプリは参考情報です。</li>
          <li>ハザードレイヤーをONにする場合、端末負荷・通信量が増えます。低帯域/省電力では無効化されます。</li>
        </ul>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">更新状況（参考）</h2>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">JMA fetchStatus</div>
            <div className="mt-1 font-semibold">{jmaStatus?.fetchStatus ?? 'DEGRADED'}</div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">JMA updatedAt</div>
            <div className="mt-1 text-xs text-gray-700">{formatUpdatedAt(jmaStatus?.updatedAt)}</div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">JMA lastError</div>
            <div className="mt-1 text-xs text-gray-700">{lastErrorLabel}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
