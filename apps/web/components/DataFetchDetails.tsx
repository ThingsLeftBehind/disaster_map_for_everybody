import React from 'react';
import { toDisplayFetchStatus } from '../lib/ui/fetchStatusLabel';

function formatUpdatedAt(updatedAt: string | null | undefined): string {
    if (!updatedAt) return '未取得';
    const t = Date.parse(updatedAt);
    if (Number.isNaN(t)) return '未取得';
    return new Date(t).toLocaleString();
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
    const displayStatus = toDisplayFetchStatus(status);
    const isHealthy = status === 'OK' && !error;
    const isPending = status === 'PENDING' || status === 'LOADING';

    return (
        <details className="group rounded-2xl bg-white shadow overflow-hidden">
            <summary className="flex cursor-pointer items-center justify-between p-5 list-none select-none hover:bg-gray-50 active:bg-gray-100 transition-colors">
                <h2 className="text-lg font-semibold">データの取得</h2>
                <div className="flex items-center gap-2">
                    {isHealthy && (
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-200">
                            Online
                        </span>
                    )}
                    {!isHealthy && (
                        <span className={`text-xs px-2 py-1 rounded-full border ${isPending ? 'bg-gray-50 text-gray-700 border-gray-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                            {isPending ? 'Checking' : 'Delayed'}
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
                        <div className="text-xs text-gray-600">公式データ</div>
                        <div className="mt-1 font-semibold">{displayStatus}</div>
                        <div className="mt-1 text-xs text-gray-600">更新: {formatUpdatedAt(updatedAt)}</div>
                    </div>
                    {fetchStatus && (
                        <div className="rounded-xl border bg-gray-50 p-3">
                            <div className="text-xs text-gray-600">表示対象</div>
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
                    取得に失敗しても、直近のデータがあれば表示します。避難判断では自治体・気象庁の公式発表も確認してください。
                </div>
            </div>
        </details>
    );
}
