export function shouldHardDeleteCustomListing(input: {
  isOwner: boolean;
  isPrivate: boolean;
  otherSuccessfulUserIds: string[];
}): boolean {
  if (!input.isOwner) return false;
  if (input.isPrivate) return true;
  return input.otherSuccessfulUserIds.length === 0;
}

export function nextListingOwnerId(
  others: Array<{ userId: string; requestedAt?: Date | string | null }>,
): string | null {
  const ranked = others
    .filter((row) => row.userId)
    .sort((a, b) => {
      const ta = a.requestedAt ? new Date(a.requestedAt).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.requestedAt ? new Date(b.requestedAt).getTime() : Number.POSITIVE_INFINITY;
      const aOk = Number.isFinite(ta);
      const bOk = Number.isFinite(tb);
      if (aOk !== bOk) return aOk ? -1 : 1;
      if (aOk && bOk && ta !== tb) return ta - tb;
      return a.userId.localeCompare(b.userId);
    });
  return ranked[0]?.userId ?? null;
}
