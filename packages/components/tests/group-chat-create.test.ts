import { describe, expect, it } from 'vitest';

import { findRoomByMemberSet, isRoomSession, normalizeMemberRoleIds } from '@lody/shared';
import { formatRoomSubtitle } from '../src/components/sessions/session-list-rows';

describe('group room create helpers', () => {
  it('switches to an existing room with the same Role set', () => {
    const rooms = [
      { id: 'room-1', sessionKind: 'room' as const, memberRoleIds: normalizeMemberRoleIds(['b', 'a']) },
    ];
    expect(findRoomByMemberSet(rooms, ['a', 'b'])?.id).toBe('room-1');
    expect(isRoomSession(rooms[0])).toBe(true);
    expect(formatRoomSubtitle(['a', 'b'], new Map([['a', 'Alice'], ['b', 'Bob']]))).toBe(
      'Alice, Bob'
    );
  });
});
