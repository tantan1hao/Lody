import { describe, expect, it } from 'vitest';

import {
  filterSidebarSearchableItems,
  projectNameMatchesSidebarQuery,
  sidebarQueryIsActive,
} from '../src/lib/sidebar-session-search';

const items = [
  {
    id: '1',
    title: 'Fix preheat timeout',
    subtitle: 'market-bot',
    sectionLabel: 'Local Projects · market-bot',
    machineName: 'MacBook Pro',
    kind: 'local',
    externalHistoryProvider: { cliType: 'builtin', agentType: 'codex' },
  },
  {
    id: '2',
    title: 'Wire Antigravity ACP',
    subtitle: 'market-bot',
    branchName: 'feat/anti',
    machineName: 'Mac mini',
    kind: 'local',
    externalHistoryProvider: { cliType: 'registry', agentType: 'antigravity-acp' },
  },
  {
    id: '3',
    title: 'Browser notifications',
    repoFullName: 'loro-dev/lody',
    branchName: 'fix/notify',
    kind: 'github',
  },
];

describe('sidebar session search', () => {
  it('treats blank queries as inactive and keeps the original order', () => {
    expect(sidebarQueryIsActive('')).toBe(false);
    expect(sidebarQueryIsActive('   ')).toBe(false);
    expect(filterSidebarSearchableItems(items, '   ').map((item) => item.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('filters by title without re-ranking recency', () => {
    expect(filterSidebarSearchableItems(items, 'fix').map((item) => item.id)).toEqual(['1', '3']);
  });

  it('finds imported sessions by project or agent label', () => {
    expect(filterSidebarSearchableItems(items, 'market').map((item) => item.id)).toEqual([
      '1',
      '2',
    ]);
    expect(filterSidebarSearchableItems(items, 'codex').map((item) => item.id)).toEqual(['1']);
    expect(filterSidebarSearchableItems(items, 'anti').map((item) => item.id)).toEqual(['2']);
  });

  it('finds sessions by machine name', () => {
    expect(filterSidebarSearchableItems(items, 'mini').map((item) => item.id)).toEqual(['2']);
  });

  it('requires every term to match', () => {
    expect(filterSidebarSearchableItems(items, 'market notify').map((item) => item.id)).toEqual([]);
    expect(filterSidebarSearchableItems(items, 'lody notify').map((item) => item.id)).toEqual([
      '3',
    ]);
  });

  it('matches a project name with no sessions', () => {
    expect(projectNameMatchesSidebarQuery('market-bot', 'market')).toBe(true);
    expect(projectNameMatchesSidebarQuery('market-bot', 'lody')).toBe(false);
  });

  it('does not call trim on a history-provider object', () => {
    expect(() => filterSidebarSearchableItems(items, 'codex')).not.toThrow();
    expect(filterSidebarSearchableItems(items, 'codex').map((item) => item.id)).toEqual(['1']);
  });
});
