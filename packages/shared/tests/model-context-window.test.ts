import { describe, expect, it } from 'vitest';

import {
  CLAUDE_DEFAULT_CONTEXT_WINDOW,
  CLAUDE_EXTENDED_CONTEXT_WINDOW,
  GEMINI_DEFAULT_CONTEXT_WINDOW,
  resolveModelContextWindow,
} from '../src/model-context-window';

describe('resolveModelContextWindow', () => {
  it('reads Claude 1M markers from the picker id or label', () => {
    expect(
      resolveModelContextWindow({
        agentType: 'claude',
        modelId: 'claude-fable-5[1m]',
        modelLabel: 'Fable',
      })
    ).toBe(CLAUDE_EXTENDED_CONTEXT_WINDOW);
    expect(
      resolveModelContextWindow({
        agentType: 'claude',
        modelId: 'sonnet',
        modelLabel: 'Sonnet 4.6 (1M context)',
      })
    ).toBe(CLAUDE_EXTENDED_CONTEXT_WINDOW);
  });

  it('uses the Claude default lane when the picker does not mark 1M', () => {
    expect(resolveModelContextWindow({ agentType: 'claude', modelId: 'sonnet' })).toBe(
      CLAUDE_DEFAULT_CONTEXT_WINDOW
    );
    expect(resolveModelContextWindow({ agentType: 'claude', modelId: 'opus' })).toBe(
      CLAUDE_DEFAULT_CONTEXT_WINDOW
    );
  });

  it('uses the Gemini window for Antigravity and Gemini ids', () => {
    expect(
      resolveModelContextWindow({
        agentType: 'antigravity-acp',
        modelId: 'gemini-3.7-flash-high',
      })
    ).toBe(GEMINI_DEFAULT_CONTEXT_WINDOW);
    expect(
      resolveModelContextWindow({
        agentType: 'antigravity-acp',
        modelId: 'gemini-3.1-pro-low',
      })
    ).toBe(GEMINI_DEFAULT_CONTEXT_WINDOW);
  });

  it('does not invent a Codex window', () => {
    expect(resolveModelContextWindow({ agentType: 'codex', modelId: 'gpt-5.4' })).toBeNull();
  });
});
