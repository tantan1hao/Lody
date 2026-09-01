import { describe, expect, it } from 'vitest';

import {
  isAcpUsageUpdate,
  parseAcpContextWindowUsage,
  parseAntigravityStderrUsage,
  parseSessionUsageContextWindow,
} from './acp-usage-update';

describe('parseAcpContextWindowUsage', () => {
  it('reads the standard ACP used/size pair', () => {
    expect(
      parseAcpContextWindowUsage({ sessionUpdate: 'usage_update', used: 2_048, size: 8_192 })
    ).toEqual({ used: 2_048, size: 8_192 });
  });

  it('reads nested Cursor-style aliases', () => {
    expect(
      parseAcpContextWindowUsage({
        sessionUpdate: 'usage_update',
        usage: { usedTokens: 12_000, contextWindow: 200_000 },
      })
    ).toEqual({ used: 12_000, size: 200_000 });
  });

  it('rejects non-usage updates and invalid numbers', () => {
    expect(isAcpUsageUpdate({ sessionUpdate: 'agent_message_chunk' })).toBe(false);
    expect(
      parseAcpContextWindowUsage({ sessionUpdate: 'usage_update', used: -1, size: 8_192 })
    ).toBeNull();
    expect(
      parseAcpContextWindowUsage({ sessionUpdate: 'usage_update', used: 10, size: 0 })
    ).toBeNull();
  });

  it('reads Gemini-style string token counts on usage_update', () => {
    expect(
      parseAcpContextWindowUsage({
        sessionUpdate: 'usage_update',
        usage: { totalTokenCount: '10526', contextWindow: '1048576' },
      })
    ).toEqual({ used: 10_526, size: 1_048_576 });
  });
});

describe('parseSessionUsageContextWindow', () => {
  it('reconstructs Codex totalTokens and keeps the reported window', () => {
    expect(
      parseSessionUsageContextWindow(
        {
          inputTokens: 2800,
          outputTokens: 600,
          reasoningOutputTokens: 100,
          contextWindow: 272_000,
        },
        'gpt-5.6-sol'
      )
    ).toEqual({ used: 3_500, size: 272_000, modelId: 'gpt-5.6-sol' });
  });

  it('omits a meter when the adapter did not report a window', () => {
    expect(
      parseSessionUsageContextWindow({
        inputTokens: 800,
        outputTokens: 200,
      })
    ).toBeNull();
  });
});

describe('parseAntigravityStderrUsage', () => {
  it('reads the last internal WS usageUpdate and uses the current Gemini window', () => {
    expect(
      parseAntigravityStderrUsage(
        'I0902 00:32:49.218914 local_connection.py:521] RAW WS MSG: {"usageUpdate":{"agents":[{"trajectoryId":"a577f172-cbb8-4871-943b-6ded924da00f", "usage":{"promptTokenCount":"10374", "cachedContentTokenCount":"0", "candidatesTokenCount":"46", "thoughtsTokenCount":"106", "totalTokenCount":"10526"}}], "total":{"promptTokenCount":"10374", "cachedContentTokenCount":"0", "candidatesTokenCount":"46", "thoughtsTokenCount":"106", "totalTokenCount":"10526"}}, "seqNum":"5"}',
        { agentType: 'antigravity-acp', modelId: 'gemini-3.1-pro-low' }
      )
    ).toEqual({ used: 10_526, size: 1_048_576, modelId: 'gemini-3.1-pro-low' });
  });

  it('ignores unrelated stderr', () => {
    expect(parseAntigravityStderrUsage('permissions: skipping check for step 22')).toBeNull();
  });
});
