/**
 * Design tokens for consistent UI across the app.
 */
export const theme = {
    colors: {
        // Primary palette
        primary: '#3b82f6',
        primaryDark: '#1d4ed8',
        primaryLight: '#dbeafe',

        // Backgrounds
        background: '#f8fafc',
        surface: '#ffffff',
        surfaceAlt: '#f1f5f9',

        // Text
        textPrimary: '#1e293b',
        textSecondary: '#64748b',
        textMuted: '#94a3b8',
        textInverse: '#ffffff',

        // Navigation
        navBackground: '#1e293b',
        navActive: '#3b82f6',
        navInactive: '#94a3b8',

        // Status colors
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',

        // Alert severity
        urgentBg: '#fef2f2',
        urgentBorder: '#dc2626',
        urgentText: '#991b1b',
        advisoryBg: '#fef3c7',
        advisoryBorder: '#f59e0b',
        advisoryText: '#92400e',

        // Borders
        border: '#e2e8f0',
        borderLight: '#f1f5f9',
    },

    spacing: {
        xs: 4,
        sm: 8,
        md: 12,
        lg: 16,
        xl: 20,
        xxl: 24,
    },

    borderRadius: {
        sm: 6,
        md: 8,
        lg: 12,
        xl: 16,
        full: 9999,
    },

    typography: {
        h1: {
            fontSize: 24,
            fontWeight: '700' as const,
        },
        h2: {
            fontSize: 18,
            fontWeight: '600' as const,
        },
        h3: {
            fontSize: 16,
            fontWeight: '600' as const,
        },
        body: {
            fontSize: 14,
            fontWeight: '400' as const,
        },
        bodySmall: {
            fontSize: 12,
            fontWeight: '400' as const,
        },
        caption: {
            fontSize: 11,
            fontWeight: '400' as const,
        },
        label: {
            fontSize: 12,
            fontWeight: '600' as const,
        },
    },

    shadow: {
        sm: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
        },
        md: {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 2,
        },
    },
};

export type Theme = typeof theme;
