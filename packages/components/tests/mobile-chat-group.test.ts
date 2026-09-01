import { describe, expect, it } from 'vitest';
import {
  groupChats,
  NO_MACHINE_BUCKET_ID,
  NO_PROJECT_BUCKET_ID,
  PINNED_BUCKET_ID,
} from '../src/components/mobile/mobile-chat-list';
import type { MobileConversationItem } from '../src/components/mobile/mobile-project-screen';
import { resolveMobileChatViewMode } from '../src/atoms/mobile-home-state';

const NOW = Date.UTC(2026, 3, 22, 10, 0, 0);

function chat(
  overrides: Partial<MobileConversationItem> & { id: string }
): MobileConversationItem {
  return {
    kind: 'chat',
    title: overrides.id,
    latestMessageAt: NOW,
    ...overrides,
  };
}

describe('resolveMobileChatViewMode', () => {
  it('keeps project, machine, and date', () => {
    expect(resolveMobileChatViewMode('project')).toBe('project');
    expect(resolveMobileChatViewMode('machine')).toBe('machine');
    expect(resolveMobileChatViewMode('date')).toBe('date');
  });

  it('coerces removed and unknown stored values to project', () => {
    expect(resolveMobileChatViewMode('none')).toBe('project');
    expect(resolveMobileChatViewMode('type')).toBe('project');
    expect(resolveMobileChatViewMode(undefined)).toBe('project');
  });
});

describe('groupChats machine', () => {
  it('buckets unpinned rows by machineId and keeps pinned first', () => {
    const grouped = groupChats(
      [
        chat({ id: 'pinned', machineId: 'mac-a', isPinned: true, latestMessageAt: NOW - 9 }),
        chat({ id: 'a-new', machineId: 'mac-a', latestMessageAt: NOW }),
        chat({ id: 'b-mid', machineId: 'mac-b', latestMessageAt: NOW - 2 }),
        chat({ id: 'a-old', machineId: 'mac-a', latestMessageAt: NOW - 5 }),
        chat({ id: 'orphan', latestMessageAt: NOW - 1 }),
      ],
      'machine',
      NOW
    );

    expect(grouped.map((bucket) => bucket.id)).toEqual([
      PINNED_BUCKET_ID,
      'mac-a',
      'mac-b',
      NO_MACHINE_BUCKET_ID,
    ]);
    expect(grouped[1]?.items.map((item) => item.id)).toEqual(['a-new', 'a-old']);
    expect(grouped[2]?.items.map((item) => item.id)).toEqual(['b-mid']);
    expect(grouped[3]?.items.map((item) => item.id)).toEqual(['orphan']);
  });

  it('does not reuse the project catch-all id for missing machines', () => {
    const grouped = groupChats([chat({ id: 'plain' })], 'machine', NOW);
    expect(grouped.map((bucket) => bucket.id)).toEqual([NO_MACHINE_BUCKET_ID]);
    expect(grouped[0]?.id).not.toBe(NO_PROJECT_BUCKET_ID);
  });
});
