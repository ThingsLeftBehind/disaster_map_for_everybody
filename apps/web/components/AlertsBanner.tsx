import useSWR from 'swr';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import { useMemo } from 'react';
import { shapeAlertWarnings } from '../lib/jma/alerts';
import { classifyWarningLevel, type WarningLevel } from '../lib/jma/filters';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type AlertsBannerProps = {
    areaCode: string | null;
    areaLabel: string | null;
    refreshMs?: number;
};

const LEVEL_LABELS: Record<WarningLevel, string> = {
    advisory: '注意報',
    warning: '警報',
    special: '特別警報',
};

const LEVEL_STYLES: Record<WarningLevel, string> = {
    advisory: 'bg-amber-100 text-amber-900',
    warning: 'bg-red-100 text-red-900',
    special: 'bg-purple-100 text-purple-900',
};

export function AlertsBanner({ areaCode, areaLabel, refreshMs = 60000 }: AlertsBannerProps) {
    const router = useRouter();
    const warningsUrl = areaCode ? `/api/jma/warnings?area=${areaCode}` : null;
    const { data: warnings } = useSWR(warningsUrl, fetcher, {
        refreshInterval: refreshMs,
        dedupingInterval: 10_000,
    });

    const counts = useMemo(() => {
        if (!warnings?.items || !Array.isArray(warnings.items)) {
            return { advisory: 0, warning: 0, special: 0 };
        }
        const result = { advisory: 0, warning: 0, special: 0 };
        // Filter active items and count per level
        const seen = new Set<string>();
        for (const item of warnings.items) {
            const kind = item.kind ?? '';
            const status = item.status ?? '';
            // Skip inactive/released items
            if (/解除|なし|ありません|明日|明後日|見込み|予報/.test(status)) continue;
            // Dedupe by kind
            if (seen.has(kind)) continue;
            seen.add(kind);
            const level = classifyWarningLevel(kind);
            result[level] += 1;
        }
        return result;
    }, [warnings?.items]);

    const hasAlerts = counts.advisory > 0 || counts.warning > 0 || counts.special > 0;

    if (!hasAlerts) return null;

    return (
        <div className="mb-4 rounded-xl border-2 border-black bg-white p-3 shadow">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {counts.special > 0 && (
                            <span className={classNames('rounded-full px-3 py-1 text-xs font-bold', LEVEL_STYLES.special)}>
                                {LEVEL_LABELS.special} {counts.special}件
                            </span>
                        )}
                        {counts.warning > 0 && (
                            <span className={classNames('rounded-full px-3 py-1 text-xs font-bold', LEVEL_STYLES.warning)}>
                                {LEVEL_LABELS.warning} {counts.warning}件
                            </span>
                        )}
                        {counts.advisory > 0 && (
                            <span className={classNames('rounded-full px-3 py-1 text-xs font-bold', LEVEL_STYLES.advisory)}>
                                {LEVEL_LABELS.advisory} {counts.advisory}件
                            </span>
                        )}
                    </div>
                    {areaLabel && (
                        <div className="text-xs text-gray-700">
                            対象: {areaLabel}
                        </div>
                    )}
                </div>
                <button
                    className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
                    onClick={() => router.push('/alerts')}
                >
                    警報ページへ
                </button>
            </div>
        </div>
    );
}
