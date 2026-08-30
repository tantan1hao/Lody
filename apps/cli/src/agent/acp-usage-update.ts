export type ParsedAcpContextWindowUsage = {
  size: number;
  used: number;
};

const USED_KEYS = ['used', 'usedTokens', 'tokensUsed', 'inputTokens'] as const;
const SIZE_KEYS = ['size', 'maxTokens', 'contextWindow', 'windowSize', 'totalTokens'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstFiniteNumber(value: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function readUsedSize(value: unknown): ParsedAcpContextWindowUsage | null {
  if (!isRecord(value)) return null;
  const used = firstFiniteNumber(value, USED_KEYS);
  const size = firstFiniteNumber(value, SIZE_KEYS);
  if (used === null || size === null || size <= 0 || used < 0) return null;
  return { size, used };
}

export function isAcpUsageUpdate(update: unknown): boolean {
  return isRecord(update) && update.sessionUpdate === 'usage_update';
}

/** Reads ACP `usage_update`, including common Cursor/nested aliases. */
export function parseAcpContextWindowUsage(update: unknown): ParsedAcpContextWindowUsage | null {
  if (!isAcpUsageUpdate(update) || !isRecord(update)) return null;
  return readUsedSize(update) ?? readUsedSize(update.usage) ?? readUsedSize(update._meta);
}
