export function getLocalYYYYMMDD() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const localTime = new Date(now.getTime() - (offset * 60 * 1000));
    return localTime.toISOString().split('T')[0];
}

export function normalizeUrl(u) {
    return (u || '').split('?')[0].split('#')[0].trim();
}
