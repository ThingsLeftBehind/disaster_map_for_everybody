import { useState, useRef, useEffect } from 'react';
import { buildLineShareUrl, buildThreadsShareUrl, buildXShareUrl } from '../lib/client/share';
import classNames from 'classnames';

type ShareMenuProps = {
    shareUrl: string | null;
    getShareText: () => string;
};

export default function ShareMenu({ shareUrl, getShareText }: ShareMenuProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node) && !containerRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, [open]);

    // Simple viewport awareness: if it overflows right, shift left. 
    // (Usually right-aligned absolute positioning works well for right-side menus)
    // We'll use right-0 by default.

    const handleCopy = async () => {
        if (!shareUrl) return;
        try {
            await navigator.clipboard.writeText(`${getShareText()}\n${shareUrl}`);
            alert('コピーしました');
            setOpen(false);
        } catch {
            alert('コピーできませんでした');
        }
    };

    const shareText = getShareText();

    return (
        <div className="relative inline-block" ref={containerRef}>
            <button
                onClick={() => setOpen(!open)}
                className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
            >
                共有
            </button>
            {open && shareUrl && (
                <div
                    ref={menuRef}
                    className="absolute right-0 top-full mt-1 w-48 z-50 rounded-lg border bg-white p-2 shadow-lg"
                    style={{ minWidth: 'max-content' }}
                >
                    <div className="flex flex-col gap-1">
                        <a
                            href={buildLineShareUrl(shareUrl, shareText)}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded px-3 py-2 text-sm hover:bg-green-50 text-gray-800"
                            onClick={() => setOpen(false)}
                        >
                            LINEで送る
                        </a>
                        <a
                            href={buildXShareUrl(shareUrl, shareText)}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded px-3 py-2 text-sm hover:bg-slate-50 text-gray-800"
                            onClick={() => setOpen(false)}
                        >
                            X (Twitter)でポスト
                        </a>
                        <a
                            href={buildThreadsShareUrl(shareUrl, shareText)}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded px-3 py-2 text-sm hover:bg-slate-50 text-gray-800"
                            onClick={() => setOpen(false)}
                        >
                            Threadsでシェア
                        </a>
                        <button
                            onClick={handleCopy}
                            className="block w-full text-left rounded px-3 py-2 text-sm hover:bg-gray-50 text-gray-800"
                        >
                            コピー
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
