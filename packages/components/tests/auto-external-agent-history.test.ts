import { describe, expect, test } from 'vitest';
import type { AgentConfigMeta, LocalProjectHistoryCatalogResult } from '@lody/shared';
import {
  autoExternalAgentHistoryTargetKey,
  collectHistoryProvidersForMachine,
  selectAutoImportSessionIds,
  selectDueAutoHistoryTargets,
  shouldRunAutoHistorySync,
  type AutoExternalAgentHistoryTarget,
} from '../src/lib/auto-external-agent-history';

function catalog(
  sessions: LocalProjectHistoryCatalogResult['sessions']
): LocalProjectHistoryCatalogResult {
  return { listed: sessions.length, lastListedAt: 1, sessions };
}

function target(id: string): AutoExternalAgentHistoryTarget {
  return {
    targetKey: id,
    projectKey: `m1:${id}`,
    machineId: 'm1' as AutoExternalAgentHistoryTarget['machineId'],
    localProjectId: id as AutoExternalAgentHistoryTarget['localProjectId'],
    provider: { cliType: 'registry', agentType: 'claude' },
  };
}

describe('selectAutoImportSessionIds', () => {
  test('imports newest available sessions and skips imported or conflicted ones', () => {
    expect(
      selectAutoImportSessionIds(
        catalog([
          { acpSessionId: 'old', title: 'Old', updatedAt: '2026-01-01T00:00:00.000Z', status: 'available' },
          { acpSessionId: 'new', title: 'New', updatedAt: '2026-09-05T00:00:00.000Z', status: 'available' },
          { acpSessionId: 'done', title: 'Done', updatedAt: '2026-09-06T00:00:00.000Z', status: 'imported' },
          {
            acpSessionId: 'conflict',
            title: 'Conflict',
            updatedAt: '2026-09-07T00:00:00.000Z',
            status: 'sync_conflict',
          },
        ]),
        1
      )
    ).toEqual(['new']);
  });

  test('returns nothing when there is no catalog', () => {
    expect(selectAutoImportSessionIds(null)).toEqual([]);
  });
});

describe('shouldRunAutoHistorySync', () => {
  test('runs when never synced and the setting is on', () => {
    expect(shouldRunAutoHistorySync({ enabled: true, lastRunAt: null, now: 100, cooldownMs: 50 })).toBe(
      true
    );
  });

  test('waits out the cooldown', () => {
    expect(
      shouldRunAutoHistorySync({ enabled: true, lastRunAt: 80, now: 100, cooldownMs: 50 })
    ).toBe(false);
    expect(
      shouldRunAutoHistorySync({ enabled: true, lastRunAt: 40, now: 100, cooldownMs: 50 })
    ).toBe(true);
  });

  test('stays off when the setting is disabled', () => {
    expect(shouldRunAutoHistorySync({ enabled: false, lastRunAt: null, now: 100 })).toBe(false);
  });
});

describe('selectDueAutoHistoryTargets', () => {
  test('returns the oldest due targets first, capped per wake', () => {
    expect(
      selectDueAutoHistoryTargets([target('a'), target('b'), target('c')], { a: 90 }, 100, {
        cooldownMs: 20,
        limit: 2,
      }).map((item) => item.targetKey)
    ).toEqual(['b', 'c']);
  });
});

describe('collectHistoryProvidersForMachine', () => {
  test('dedupes agent configs on one machine', () => {
    const configs = [
      { machineId: 'm1', cliType: 'registry', agentType: 'claude' },
      { machineId: 'm1', cliType: 'registry', agentType: 'claude' },
      { machineId: 'm1', cliType: 'registry', agentType: 'codex' },
      { machineId: 'm2', cliType: 'registry', agentType: 'claude' },
    ] as AgentConfigMeta[];
    expect(
      collectHistoryProvidersForMachine(configs, 'm1' as AgentConfigMeta['machineId']).map(
        (provider) => autoExternalAgentHistoryTargetKey('ws', 'm1:p', provider)
      )
    ).toEqual(['ws:registry:claude:m1:p', 'ws:registry:codex:m1:p']);
  });
});
