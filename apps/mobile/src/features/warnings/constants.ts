// Phenomenon color mapping (Tailwind classes mapped to Hex for Mobile)
// Sourced from apps/web/pages/alerts.tsx

// Yellow 100: #fef9c3, 400: #facc15, 800: #854d0e
// Sky 100: #e0f2fe, 300: #7dd3fc, 800: #075985
// Blue 100: #dbeafe, 400: #60a5fa, 800: #1e40af
// Teal 100: #ccfbf1, 400: #2dd4bf, 800: #115e59
// Green 100: #dcfce7, 400: #4ade80, 800: #166534
// Slate 100: #f1f5f9, 400: #94a3b8, 700: #334155
// Cyan 100: #cffafe, 400: #22d3ee, 800: #155f75
// Indigo 100: #e0e7ff, 400: #818cf8, 800: #3730a3

export type ColorTheme = {
    bg: string;
    border: string;
    text: string;
};

export const PHENOMENON_COLOR_MAP: Record<string, ColorTheme> = {
    '雷': { bg: '#fef9c3', border: '#facc15', text: '#854d0e' },
    '落雷': { bg: '#fef9c3', border: '#facc15', text: '#854d0e' },
    '濃霧': { bg: '#e0f2fe', border: '#7dd3fc', text: '#075985' },
    '大雨': { bg: '#dbeafe', border: '#60a5fa', text: '#1e40af' },
    '洪水': { bg: '#ccfbf1', border: '#2dd4bf', text: '#115e59' },
    '強風': { bg: '#dcfce7', border: '#4ade80', text: '#166534' },
    '暴風': { bg: '#dcfce7', border: '#4ade80', text: '#166534' },
    '大雪': { bg: '#f1f5f9', border: '#94a3b8', text: '#334155' },
    '暴風雪': { bg: '#f1f5f9', border: '#94a3b8', text: '#334155' },
    '波浪': { bg: '#cffafe', border: '#22d3ee', text: '#155f75' },
    '高潮': { bg: '#e0e7ff', border: '#818cf8', text: '#3730a3' },
};

export const DEFAULT_PHENOMENON_COLOR: ColorTheme = {
    bg: '#f3f4f6', // gray-100
    border: '#d1d5db', // gray-300
    text: '#374151', // gray-700
};

export const LEVEL_COLORS = {
    special: { bg: '#fff0ff', border: '#9C27B0', text: '#9C27B0' }, // Purple
    warning: { bg: '#fff0f0', border: '#f44336', text: '#f44336' }, // Red
    advisory: { bg: '#fffff0', border: '#FFC107', text: '#FFC107' }, // Yellow
};
