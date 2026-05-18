import type { ApiKeyTier } from "../types/index.js";

export function getQueuePriority(tier: ApiKeyTier): number {
  return tier === "enterprise" ? 2 : tier === "business" ? 1 : 0;
}
