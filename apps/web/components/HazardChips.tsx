import { hazardKeys, hazardLabels } from '@jp-evac/shared';
import classNames from 'classnames';

type HazardKey = (typeof hazardKeys)[number];

/**
 * Reusable component for displaying hazard compatibility chips
 * Supported hazards are shown in green, unsupported in white/outline
 */
export function HazardChips({
    hazards,
    showUnsupported = false,
    maxVisible = 6,
    size = 'sm',
}: {
    hazards: Record<string, boolean> | null | undefined;
    showUnsupported?: boolean;
    maxVisible?: number;
    size?: 'sm' | 'xs';
}) {
    if (!hazards) return null;

    // Fixed order iteration (all hazardKeys)
    const visibleKeys = hazardKeys.slice(0, maxVisible);
    const hasMore = hazardKeys.length > maxVisible;

    if (visibleKeys.length === 0 && !showUnsupported) return null;

    const baseClasses =
        size === 'xs'
            ? 'rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap'
            : 'rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap';

    return (
        <div className="flex flex-wrap gap-1">
            {visibleKeys.map((key) => {
                const isSupported = Boolean(hazards[key]);
                return (
                    <span
                        key={key}
                        className={classNames(
                            baseClasses,
                            isSupported
                                ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                                : 'bg-white text-gray-400 ring-1 ring-gray-200' // Neutral/white style for incompatible
                        )}
                    >
                        {hazardLabels[key]}
                    </span>
                );
            })}
            {hasMore && (
                <span className={classNames(baseClasses, 'bg-gray-50 text-gray-500')}>
                    +{hazardKeys.length - maxVisible}
                </span>
            )}
        </div>
    );
}

/**
 * Compact version of HazardChips for cards
 */
export function HazardChipsCompact({
    hazards,
    maxVisible = 4,
}: {
    hazards: Record<string, boolean> | null | undefined;
    maxVisible?: number;
}) {
    // List cards want 8 chips always
    return <HazardChips hazards={hazards} maxVisible={8} size="xs" showUnsupported={true} />;
}
