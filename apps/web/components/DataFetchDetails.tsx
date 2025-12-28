import React from 'react';
import { toDisplayFetchStatus } from '../lib/ui/fetchStatusLabel';

type Props = {
    status?: string;
    updatedAt?: string | null;
    fetchStatus?: string | null;
    error?: string | null;
    className?: string;
};

function formatUpdatedAt(updatedAt: string | null | undefined): string {
    if (!updatedAt) return '未取得';
    const t = Date.parse(updatedAt);
    if (Number.isNaN(t)) return '未取得';
    return new Date(t).toLocaleString();
}

function sanitizeFetchError(message: string | null | undefined): string {
    return message ? '取得エラー' : 'なし';
}

export function DataFetchDetails({
    status,
    updatedAt,
    fetchStatus,
    error,
    children,
}: {
    status: string;
    updatedAt?: string | null;
    fetchStatus?: string;
    error?: string | null;
    children?: React.ReactNode;
}) {
    const errorLabel = error ? '取得エラー' : 'なし';

    return (
        <details className="group rounded-2xl bg-white shadow overflow-hidden">
            <summary className="flex cursor-pointer items-center justify-between p-5 list-none select-none hover:bg-gray-50 active:bg-gray-100 transition-colors">
                <h2 className="text-lg font-semibold">データの取得</h2>
                <div className="flex items-center gap-2">
                    {!error && (
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-200">
                            正常
                        </span>
                    )}
                    {error && (
                        <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-full border border-red-200">
                            エラーあり
                        </span>
                    )}
                    <svg className="h-5 w-5 text-gray-400 transition-transform group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </summary>

            <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                <div className="grid gap-2 text-sm md:grid-cols-3">
                    <div className="rounded-xl border bg-gray-50 p-3">
                        <div className="text-xs text-gray-600">全体</div>
                        <div className="mt-1 font-semibold">{toDisplayFetchStatus(status)}</div>
                        <div className="mt-1 text-xs text-gray-600">更新: {formatUpdatedAt(updatedAt)}</div>
                    </div>
                    {fetchStatus && (
                        <div className="rounded-xl border bg-gray-50 p-3">
                            <div className="text-xs text-gray-600">対象エリア</div>
                            <div className="mt-1 font-semibold">{toDisplayFetchStatus(fetchStatus)}</div>
                        </div>
                    )}
                    <div className="rounded-xl border bg-gray-50 p-3">
                        <div className="text-xs text-gray-600">エラー</div>
                        <div className="mt-1 text-xs text-gray-700">{errorLabel}</div>
                    </div>
                </div>
                {children}
                <div className="mt-2 text-xs text-gray-600">
                    取得に失敗しても、直近のデータがあれば表示します（ネットワーク状況により遅延/欠落があり得ます）。
                </div>
            </div>
        </details>
    );
}
