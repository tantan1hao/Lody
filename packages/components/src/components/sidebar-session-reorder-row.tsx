import { createContext, useContext, type ReactNode } from 'react';
import {
  closestCenter,
  type CollisionDetection,
  type DraggableAttributes,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  sidebarProjectSortableId,
  sidebarSessionSortableId,
} from '@/lib/sidebar-session-order';

const SessionRowReorderVisualContext = createContext(false);

/** Decorative grip. The whole row is the sortable activator. */
export function SessionRowReorderHandle({ visible: visibleOverride }: { visible?: boolean } = {}) {
  const fromContext = useContext(SessionRowReorderVisualContext);
  const visible = visibleOverride ?? fromContext;
  if (!visible) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-5 w-4 shrink-0 items-center justify-center',
        'text-sidebar-foreground-muted/70',
        'opacity-0 pointer-events-none',
        'group-hover:opacity-100 group-hover/row:opacity-100'
      )}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  );
}

export function clientPointFromSessionDragEnd(
  event: DragEndEvent
): { x: number; y: number } | null {
  const source = event.activatorEvent;
  if (
    !source ||
    !('clientX' in source) ||
    !('clientY' in source) ||
    typeof source.clientX !== 'number' ||
    typeof source.clientY !== 'number'
  ) {
    return null;
  }
  return { x: source.clientX + event.delta.x, y: source.clientY + event.delta.y };
}

/** Session drags ignore repo-group droppables; repo drags ignore session rows. */
export const sidebarSessionCollision: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  const droppableContainers = args.droppableContainers.filter((container) => {
    const type = container.data.current?.type;
    if (activeType === 'session') return type === 'session';
    if (activeType === 'project') return type === 'project';
    return type !== 'session' && type !== 'project';
  });
  return closestCenter({ ...args, droppableContainers });
};

const LocalProjectReorderContext = createContext<{
  disabled: boolean;
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  label: string;
} | null>(null);

export function useLocalProjectReorderActivator() {
  return useContext(LocalProjectReorderContext);
}

/** Whole project block moves; only the header should attach the listeners. */
export function SortableLocalProjectBlock({
  projectKey,
  disabled,
  groupRootIds,
  label,
  children,
}: {
  projectKey: string;
  disabled: boolean;
  groupRootIds: readonly string[];
  label: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sidebarProjectSortableId(projectKey),
    disabled,
    data: { type: 'project', projectKey, groupRootIds },
  });
  const constrainedTransform = transform ? { ...transform, x: 0, scaleX: 1, scaleY: 1 } : null;

  return (
    <LocalProjectReorderContext.Provider
      value={{ disabled, attributes, listeners, label }}
    >
      <div
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(constrainedTransform),
          transition,
        }}
        className={cn(isDragging && 'opacity-60')}
      >
        {children}
      </div>
    </LocalProjectReorderContext.Provider>
  );
}

export function SortableSessionTreeRow({
  sessionId,
  disabled,
  groupRootIds,
  children,
  reorderLabel,
}: {
  sessionId: string;
  disabled: boolean;
  groupRootIds: readonly string[];
  children: ReactNode;
  reorderLabel: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sidebarSessionSortableId(sessionId),
    disabled,
    data: { type: 'session', sessionId, groupRootIds },
  });
  const constrainedTransform = transform ? { ...transform, x: 0, scaleX: 1, scaleY: 1 } : null;

  return (
    <SessionRowReorderVisualContext.Provider value={!disabled}>
      <div
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(constrainedTransform),
          transition,
        }}
        className={cn('w-full', isDragging && 'opacity-60', !disabled && 'cursor-grab')}
        aria-label={disabled ? undefined : reorderLabel}
        {...(disabled ? {} : { ...attributes, ...listeners })}
      >
        {children}
      </div>
    </SessionRowReorderVisualContext.Provider>
  );
}
