import {
  GEMINI_DEFAULT_CONTEXT_WINDOW,
  isAntigravityAgentType,
  resolveModelContextWindow,
} from '@lody/shared';

export type ParsedAcpContextWindowUsage = {
  size: number;
  used: number;
  modelId?: string;
};

const USED_KEYS = [
  'used',
  'usedTokens',
  'tokensUsed',
  'inputTokens',
  'totalTokenCount',
  'promptTokenCount',
] as const;
const SIZE_KEYS = ['size', 'maxTokens', 'contextWindow', 'windowSize', 'totalTokens'] as const;

export { GEMINI_DEFAULT_CONTEXT_WINDOW, isAntigravityAgentType };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstFiniteNumber(value: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const parsed = asFiniteNumber(value[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function readUsedSize(value: unknown, fallbackSize?: number): ParsedAcpContextWindowUsage | null {
  if (!isRecord(value)) return null;
  const used = firstFiniteNumber(value, USED_KEYS);
  const size = firstFiniteNumber(value, SIZE_KEYS) ?? fallbackSize ?? null;
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

/**
 * Codex (and other Lody usage extensions) report token counts + optional
 * `contextWindow` instead of ACP `usage_update`. Cached input is already
 * counted inside `inputTokens`, matching Codex `totalTokens`.
 */
export function parseSessionUsageContextWindow(
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningOutputTokens?: number;
    contextWindow?: number;
  },
  modelId?: string
): ParsedAcpContextWindowUsage | null {
  const size = usage.contextWindow;
  if (size == null || !Number.isFinite(size) || size <= 0) return null;
  const used = usage.inputTokens + usage.outputTokens + (usage.reasoningOutputTokens ?? 0);
  if (!Number.isFinite(used) || used < 0) return null;
  return modelId ? { size, used, modelId } : { size, used };
}

function extractBalancedJsonObject(text: string, start: number): unknown | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Antigravity's ACP adapter logs internal WS `usageUpdate` on stderr and does not emit ACP `usage_update`. */
export function parseAntigravityStderrUsage(
  chunk: string,
  model?: { agentType?: string | null; modelId?: string | null; modelLabel?: string | null }
): ParsedAcpContextWindowUsage | null {
  const marker = '"usageUpdate"';
  const markerAt = chunk.lastIndexOf(marker);
  if (markerAt < 0) return null;
  const start = chunk.lastIndexOf('{', markerAt);
  if (start < 0) return null;
  const payload = extractBalancedJsonObject(chunk, start);
  if (!isRecord(payload) || !isRecord(payload.usageUpdate)) return null;
  const total = payload.usageUpdate.total;
  const firstAgent = Array.isArray(payload.usageUpdate.agents)
    ? payload.usageUpdate.agents[0]
    : null;
  const agentUsage = isRecord(firstAgent) ? firstAgent.usage : null;
  const size =
    resolveModelContextWindow({
      agentType: model?.agentType ?? 'antigravity-acp',
      modelId: model?.modelId,
      modelLabel: model?.modelLabel,
    }) ?? GEMINI_DEFAULT_CONTEXT_WINDOW;
  const parsed = readUsedSize(total, size) ?? readUsedSize(agentUsage, size);
  if (!parsed) return null;
  return model?.modelId ? { ...parsed, modelId: model.modelId } : parsed;
}
