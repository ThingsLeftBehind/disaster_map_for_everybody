export const STORE_LOCK_TTL_MS = 15_000;

export const STORE_LIMITS = {
  maxSavedAreas: 5,
  maxFavorites: 5,
  maxRecentShelters: 50,
  maxCommentsPerShelter: 200,
  maxVotesHistoryPerShelter: 500,
  voteWindowMs: 10 * 60_000,
  commentWindowMs: 2 * 60_000,
  reportWindowMs: 60_000,
} as const;

export const MODERATION_DEFAULTS = {
  reportCautionThreshold: 3,
  reportHideThreshold: 6,
} as const;
