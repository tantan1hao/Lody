import { describe, expect, test } from 'vitest';

import {
  applySavedSessionOrder,
  commitSessionGroupReorder,
  parseSidebarProjectSortableId,
  parseSidebarSessionSortableId,
  sessionOrderTouchesIds,
  sidebarProjectKey,
  sidebarProjectSortableId,
  sidebarSessionSortableId,
  spliceOrderedGroup,
} from '../src/lib/sidebar-session-order';

describe('applySavedSessionOrder', () => {
  test('keeps incoming order when nothing is saved', () => {
    expect(
      applySavedSessionOrder([{ id: 'b' }, { id: 'a' }], [], (item) => item.id).map(
        (item) => item.id
      )
    ).toEqual(['b', 'a']);
  });

  test('places unordered items first, then the saved block', () => {
    expect(
      applySavedSessionOrder(
        [{ id: 'new' }, { id: 'b' }, { id: 'a' }],
        ['a', 'b'],
        (item) => item.id
      ).map((item) => item.id)
    ).toEqual(['new', 'a', 'b']);
  });

  test('ignores saved ids that are not in the list', () => {
    expect(
      applySavedSessionOrder([{ id: 'a' }, { id: 'b' }], ['gone', 'b', 'a'], (item) => item.id).map(
        (item) => item.id
      )
    ).toEqual(['b', 'a']);
  });
});

describe('commitSessionGroupReorder', () => {
  test('writes the moved group when nothing was persisted yet', () => {
    expect(commitSessionGroupReorder([], ['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  test('replaces only the dragged group inside a larger order', () => {
    expect(commitSessionGroupReorder(['x', 'a', 'b', 'y'], ['a', 'b'], 'b', 'a')).toEqual([
      'x',
      'b',
      'a',
      'y',
    ]);
  });

  test('no-ops when the drop target is outside the group', () => {
    expect(commitSessionGroupReorder(['a', 'b'], ['a', 'b'], 'a', 'z')).toEqual(['a', 'b']);
  });
});

describe('spliceOrderedGroup', () => {
  test('appends a group that has no members in the previous order', () => {
    expect(spliceOrderedGroup(['x'], ['a', 'b'])).toEqual(['x', 'a', 'b']);
  });
});

describe('session sortable ids', () => {
  test('round-trips a session id', () => {
    expect(parseSidebarSessionSortableId(sidebarSessionSortableId('s1'))).toBe('s1');
    expect(parseSidebarSessionSortableId('repo:loro-dev/loro')).toBeNull();
  });

  test('detects whether a saved order touches a group', () => {
    expect(sessionOrderTouchesIds(['a'], ['b', 'a'])).toBe(true);
    expect(sessionOrderTouchesIds(['a'], ['b'])).toBe(false);
  });

  test('round-trips a local project key', () => {
    const key = sidebarProjectKey('m1', 'p1');
    expect(key).toBe('m1:p1');
    expect(parseSidebarProjectSortableId(sidebarProjectSortableId(key))).toBe(key);
  });

  test('applies a saved project order after createdAt sort', () => {
    const created = [
      { id: sidebarProjectKey('m1', 'old') },
      { id: sidebarProjectKey('m1', 'mid') },
      { id: sidebarProjectKey('m1', 'new') },
    ];
    expect(
      applySavedSessionOrder(
        created,
        [sidebarProjectKey('m1', 'mid'), sidebarProjectKey('m1', 'old')],
        (item) => item.id
      ).map((item) => item.id)
    ).toEqual([
      sidebarProjectKey('m1', 'new'),
      sidebarProjectKey('m1', 'mid'),
      sidebarProjectKey('m1', 'old'),
    ]);
  });
});
