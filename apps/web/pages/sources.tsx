import { Seo } from '../components/Seo';
import useSWR from 'swr';
import { useDevice } from '../components/device/DeviceProvider';
import { DataFetchDetails } from '../components/DataFetchDetails';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function SourcesPage() {
  const { device } = useDevice();
  const refreshMs = device?.settings?.powerSaving ? 180_000 : 60_000;
  const { data: jmaStatus } = useSWR('/api/jma/status', fetcher, { refreshInterval: refreshMs });

  return (
    <div className="space-y-6">
      <Seo
        title="注意・免責事項"
        description="注意・免責事項とデータ出典をまとめたページ。警報・注意報、地震、ハザードマップ、避難場所データの参照元や更新頻度、利用上の注意点を確認できます。"
      />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">出典・免責事項</h1>
      </div>

      {/* 免責事項 (Disclaimer) */}
      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">免責事項</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-800">
          <li>
            <strong>本アプリは参考情報です。</strong>
            避難判断・行動の最終決定は、必ず自治体・気象庁等の公式情報を優先してください。
          </li>
          <li>
            <strong>遅延・欠落の可能性があります。</strong>
            ネットワーク状況やサーバー負荷により遅延が発生する場合があります。リアルタイム性を保証するものではありません。
          </li>
          <li>
            <strong>避難所の開設状況は自治体発表が最優先です。</strong>
            本アプリに表示される避難場所情報は、実際の開設状況と異なる場合があります。
          </li>
          <li>
            <strong>ハザードマップは最終確認を公式で行ってください。</strong>
            本アプリのハザードレイヤーは参考表示です。必ず自治体や国土地理院の公式ハザードマップで最終確認してください。
          </li>
          <li>
            <strong>利用環境により表示が変わります。</strong>
            端末やブラウザの設定によって、地図・通知の表示や更新間隔が異なる場合があります。
          </li>
        </ul>
      </section>

      {/* 出典 (Sources) */}
      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">出典</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border bg-gray-50 p-3 text-sm text-gray-800">
            <div className="font-semibold">気象庁 (JMA)</div>
            <div className="mt-1 text-xs text-gray-700">警報・注意報、地震情報、津波情報等</div>
            <a className="mt-1 inline-block text-xs text-blue-600 hover:underline" href="https://www.jma.go.jp/" target="_blank" rel="noreferrer">
              https://www.jma.go.jp/
            </a>
          </div>
          <div className="rounded-xl border bg-gray-50 p-3 text-sm text-gray-800">
            <div className="font-semibold">国土地理院 (GSI)</div>
            <div className="mt-1 text-xs text-gray-700">ハザードタイル（洪水・土砂・津波・液状化）、逆ジオコーダ</div>
            <a className="mt-1 inline-block text-xs text-blue-600 hover:underline" href="https://disaportal.gsi.go.jp/" target="_blank" rel="noreferrer">
              https://disaportal.gsi.go.jp/
            </a>
          </div>
          <div className="rounded-xl border bg-gray-50 p-3 text-sm text-gray-800">
            <div className="font-semibold">OpenStreetMap</div>
            <div className="mt-1 text-xs text-gray-700">ベースマップタイル</div>
            <a className="mt-1 inline-block text-xs text-blue-600 hover:underline" href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">
              https://www.openstreetmap.org/
            </a>
            <div className="mt-1 text-[11px] text-gray-500">© OpenStreetMap contributors</div>
          </div>
          <div className="rounded-xl border bg-gray-50 p-3 text-sm text-gray-800">
            <div className="font-semibold">避難場所データ</div>
            <div className="mt-1 text-xs text-gray-700">公的オープンデータ（国土数値情報、自治体公開データ等）</div>
          </div>
        </div>
      </section>

      {/* 注意事項 (Notes) */}
      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-semibold">注意事項</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-800">
          <li>
            <strong>発表単位について:</strong>{' '}
            気象庁の警報・注意報は「予報区（一次細分区域）」など、市区町村とは異なる区域単位で発表されます。表示される区域と実際の市区町村境界は一致しない場合があります。
          </li>
          {/* Tokyo split text removed */}
          <li>
            <strong>ハザードデータのカバー範囲:</strong>{' '}
            液状化データ等は全国一律ではなく、空白部分はデータなし/範囲外を示す場合があります。
          </li>
          <li>
            <strong>更新頻度:</strong>{' '}
            各ページに表示される「最新取得時刻」が取得タイミングを示します。自動更新間隔は通常1分、省電力モード時は3分です。通信状況により遅れる場合があります。
          </li>
          <li>
            <strong>リアルタイム地震モニタ:</strong>{' '}
            地震ページ内のリアルタイム地震モニタは外部リンクのみの提供です（埋め込み・再配布はしていません）。環境によってはアクセスできない場合があります。
          </li>
          <li>
            <strong>免責事項の確認:</strong>{' '}
            本ページの内容は随時更新される可能性があります。定期的に確認してください。
          </li>
        </ul>
      </section>

      {/* 更新状況（参考） */}
      <DataFetchDetails
        status={jmaStatus?.fetchStatus ?? 'DEGRADED'}
        updatedAt={jmaStatus?.updatedAt}
        error={jmaStatus?.lastError}
      />
    </div>
  );
}
