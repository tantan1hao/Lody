/** Claude's default context lane when the picker does not mark 1M. */
export const CLAUDE_DEFAULT_CONTEXT_WINDOW = 200_000;

/** Claude extended-context lane advertised as `1m` / `[1m]`. */
export const CLAUDE_EXTENDED_CONTEXT_WINDOW = 1_000_000;

/** Gemini 3 Flash/Pro family window when Antigravity omits an explicit size. */
export const GEMINI_DEFAULT_CONTEXT_WINDOW = 1_048_576;

export function isAntigravityAgentType(agentType: string | null | undefined): boolean {
  return agentType === 'antigravity-acp' || agentType === 'antigravity';
}

export function hasExplicitExtendedContextMarker(
  ...texts: Array<string | null | undefined>
): boolean {
  return texts.some((text) => text != null && (/\b1m\b/i.test(text) || /\[1m\]/i.test(text)));
}

export function resolveModelContextWindow(input: {
  agentType?: string | null;
  modelId?: string | null;
  modelLabel?: string | null;
}): number | null {
  const agentType = input.agentType?.trim().toLowerCase() ?? '';
  const modelId = input.modelId?.trim() ?? '';
  const modelLabel = input.modelLabel?.trim() ?? '';

  if (hasExplicitExtendedContextMarker(modelId, modelLabel)) {
    return CLAUDE_EXTENDED_CONTEXT_WINDOW;
  }

  if (isAntigravityAgentType(agentType) || /gemini/i.test(modelId) || /gemini/i.test(modelLabel)) {
    return GEMINI_DEFAULT_CONTEXT_WINDOW;
  }

  if (
    agentType === 'claude' ||
    /claude/i.test(modelId) ||
    /^(sonnet|opus|haiku)$/i.test(modelId)
  ) {
    return CLAUDE_DEFAULT_CONTEXT_WINDOW;
  }

  return null;
}
