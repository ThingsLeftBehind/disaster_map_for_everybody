import { buildLineShareUrl, buildThreadsShareUrl, buildXShareUrl } from '../lib/client/share';

export default function ShareMenu({
  shareUrl,
  getShareText,
}: {
  shareUrl: string | null;
  getShareText: () => string;
}) {
  if (!shareUrl) return null;

  const open = (url: string) => {
    if (typeof window === 'undefined') return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const copy = async () => {
    const text = getShareText();
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('clipboard not available');
      await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
      alert('コピーしました');
    } catch {
      alert('コピーに失敗しました');
    }
  };

  const shareNative = async () => {
    try {
      if (typeof navigator === 'undefined') return;
      const nav = navigator as Navigator & { share?: (data: { text?: string; url?: string }) => Promise<void> };
      if (!nav.share) {
        await copy();
        return;
      }
      await nav.share({ text: getShareText(), url: shareUrl });
    } catch {
      // ignore
    }
  };

  return (
    <details className="relative" onClick={(e) => e.stopPropagation()}>
      <summary className="cursor-pointer list-none rounded bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-200">
        共有
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-52 rounded-xl border bg-white p-2 shadow">
        <button
          className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50"
          onClick={() => open(buildLineShareUrl(shareUrl, getShareText()))}
        >
          LINE
        </button>
        <button
          className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50"
          onClick={() => open(buildXShareUrl(shareUrl, getShareText()))}
        >
          X（Twitter）
        </button>
        <button
          className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50"
          onClick={() => open(buildThreadsShareUrl(shareUrl, getShareText()))}
        >
          Threads
        </button>
        <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={shareNative}>
          Instagram（端末共有）
        </button>
        <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={copy}>
          コピー
        </button>
      </div>
    </details>
  );
}
