/**
 * Normalizes municipality code to 5 digits (JIS) if it is 6 digits (LGCode).
 * Use this before querying DB or comparing with DB values.
 */
export function normalizeMuniCode(code: string | null | undefined): string | null {
    if (!code) return null;
    const s = String(code).trim();
    // JIS code is 5 digits.
    // If 6 digits (LGCode), the last digit is check digit. Remove it.
    if (/^\d{6}$/.test(s)) {
        return s.slice(0, 5);
    }
    if (/^\d{5}$/.test(s)) {
        return s;
    }
    // If it doesn't look like 5 or 6 digits, return as is (or null)
    // but better to return null if invalid format to avoid bad queries
    return null;
}

/**
 * Returns both 6-digit (if available) and 5-digit variants for robust searching.
 */
export function getMuniCodeVariants(code: string | null | undefined): { code5: string | null; code6: string | null } {
    if (!code) return { code5: null, code6: null };
    const s = String(code).trim();

    if (/^\d{6}$/.test(s)) {
        // If input is 6 digit, we can assume it has a valid 5 digit prefix
        return { code6: s, code5: s.slice(0, 5) };
    }
    if (/^\d{5}$/.test(s)) {
        // Input is 5 digit. We don't guess 6 digit.
        return { code6: null, code5: s };
    }
    return { code6: null, code5: null };
}

/**
 * Converts a municipality code (5/6-digit) or a class20 code (7-digit) to JMA class20.
 */
export function toJmaClass20(code: string | null | undefined): string | null {
    if (!code) return null;
    const digits = String(code).replace(/\D/g, '');
    if (!digits) return null;
    if (/^\d{7}$/.test(digits)) return digits;
    const base5 = normalizeMuniCode(digits);
    if (!base5) return null;
    return `${base5}00`;
}
