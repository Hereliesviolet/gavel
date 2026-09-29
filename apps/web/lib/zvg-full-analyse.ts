export const FULL_KI_DAILY_LIMIT = 10;
export const FULL_KI_BURST = { max: 5, windowSeconds: 60, failClosed: true as const };

export function fullKiQuotaReached(used: number, limit = FULL_KI_DAILY_LIMIT): boolean {
  return used >= limit;
}
