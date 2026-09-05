/**
 * Per-workspace sidebar session order.
 *
 * Repos already persist a drag order in localStorage. Sessions keep pinned-first
 * + recency until the user reorders a visible group; that group's current root
 * ids are then written into this list. Sessions not yet in the list stay at the
 * top of their pin slice (incoming recency) so a new chat still appears first.
 */

export function applySavedSessionOrder<T>(
  items: readonly T[],
  savedOrder: readonly string[],
  getId: (item: T) => string
): T[] {
  if (savedOrder.length === 0 || items.length <= 1) return [...items];
  const indexById = new Map(savedOrder.map((id, index) => [id, index]));
  const unordered: T[] = [];
  const ordered: Array<{ item: T; index: number }> = [];
  for (const item of items) {
    const index = indexById.get(getId(item));
    if (index === undefined) unordered.push(item);
    else ordered.push({ item, index });
  }
  ordered.sort((a, b) => a.index - b.index);
  return [...unordered, ...ordered.map((entry) => entry.item)];
}

export function sessionOrderTouchesIds(
  savedOrder: readonly string[],
  ids: readonly string[]
): boolean {
  if (savedOrder.length === 0 || ids.length === 0) return false;
  const saved = new Set(savedOrder);
  return ids.some((id) => saved.has(id));
}

function arrayMove<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return next;
  next.splice(toIndex, 0, item);
  return next;
}

/**
 * Replace the relative order of `nextGroup` members inside `prevOrder`.
 * Members of `nextGroup` that were not persisted yet are inserted with the group.
 */
export function spliceOrderedGroup(
  prevOrder: readonly string[],
  nextGroup: readonly string[]
): string[] {
  if (nextGroup.length === 0) return [...prevOrder];
  const groupSet = new Set(nextGroup);
  const result: string[] = [];
  let inserted = false;
  for (const id of prevOrder) {
    if (groupSet.has(id)) {
      if (!inserted) {
        result.push(...nextGroup);
        inserted = true;
      }
      continue;
    }
    result.push(id);
  }
  if (!inserted) result.push(...nextGroup);
  return result;
}

export function commitSessionGroupReorder(
  prevOrder: readonly string[],
  groupRootIds: readonly string[],
  activeId: string,
  overId: string
): string[] {
  if (activeId === overId) return [...prevOrder];
  const fromIndex = groupRootIds.indexOf(activeId);
  const toIndex = groupRootIds.indexOf(overId);
  if (fromIndex < 0 || toIndex < 0) return [...prevOrder];
  return spliceOrderedGroup(prevOrder, arrayMove(groupRootIds, fromIndex, toIndex));
}

export const SIDEBAR_SESSION_SORTABLE_PREFIX = 'session:';

export function sidebarSessionSortableId(sessionId: string): string {
  return `${SIDEBAR_SESSION_SORTABLE_PREFIX}${sessionId}`;
}

export function parseSidebarSessionSortableId(id: string): string | null {
  return id.startsWith(SIDEBAR_SESSION_SORTABLE_PREFIX)
    ? id.slice(SIDEBAR_SESSION_SORTABLE_PREFIX.length)
    : null;
}

export function sidebarProjectKey(machineId: string, projectId: string): string {
  return `${machineId}:${projectId}`;
}

export const SIDEBAR_PROJECT_SORTABLE_PREFIX = 'project:';

export function sidebarProjectSortableId(projectKey: string): string {
  return `${SIDEBAR_PROJECT_SORTABLE_PREFIX}${projectKey}`;
}

export function parseSidebarProjectSortableId(id: string): string | null {
  return id.startsWith(SIDEBAR_PROJECT_SORTABLE_PREFIX)
    ? id.slice(SIDEBAR_PROJECT_SORTABLE_PREFIX.length)
    : null;
}
