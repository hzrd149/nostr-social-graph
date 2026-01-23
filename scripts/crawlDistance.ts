export function parseCrawlDistance(
  rawValue: string | undefined,
  fallback?: number
): number | undefined {
  if (!rawValue || rawValue.trim() === '') {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'all' || normalized === 'infinite' || normalized === 'unlimited') {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}
