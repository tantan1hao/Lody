import { describe, expect, it } from 'vitest';

import { isAcpUsageUpdate, parseAcpContextWindowUsage } from './acp-usage-update';

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
});
