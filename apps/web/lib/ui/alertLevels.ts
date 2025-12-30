import type { WarningLevel } from '../jma/filters';

export const WARNING_LEVEL_LABEL: Record<WarningLevel, string> = {
  advisory: '注意報',
  warning: '警報',
  special: '特別警報',
};

export const WARNING_LEVEL_BADGE_CLASSES: Record<WarningLevel, string> = {
  advisory: 'bg-amber-100 text-amber-900 border-amber-300',
  warning: 'bg-red-100 text-red-900 border-red-300',
  special: 'bg-purple-100 text-purple-900 border-purple-300',
};

export const WARNING_LEVEL_CHIP_CLASSES: Record<WarningLevel, string> = {
  advisory: 'bg-amber-50 text-amber-900 ring-amber-200',
  warning: 'bg-red-50 text-red-900 ring-red-200',
  special: 'bg-purple-50 text-purple-900 ring-purple-200',
};

export const WARNING_LEVEL_ORDER: WarningLevel[] = ['special', 'warning', 'advisory'];
