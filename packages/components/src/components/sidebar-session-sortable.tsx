import { type ReactNode, useCallback } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

import { sessionOrderAtom } from '@/atoms/sidebar-state';
import { useIsMobile } from '@/hooks/use-mobile';
import { moveSidebarSessionOrder } from '@/lib/sidebar-session-order';
import { cn } from '@/lib/utils';

export function useSidebarSessionReorder(enabled: boolean) {
  const isMobile = useIsMobile();
  const [sessionOrder, setSessionOrder] = useAtom(sessionOrderAtom);
  const canReorder = enabled && !isMobile;
  const moveSessions = useCallback(
    (visibleIds: readonly string[], activeId: string, overId: string) => {
      setSessionOrder(
        moveSidebarSessionOrder({
          savedOrder: sessionOrder,
          visibleIds,
          activeId,
          overId,
        })
      );
    },
    [sessionOrder, setSessionOrder]
  );
  return { sessionOrder, canReorder, moveSessions };
}

export function SortableSessionList({
  items,
  enabled,
  onMove,
  children,
}: {
  items: readonly string[];
  enabled: boolean;
  onMove: (activeId: string, overId: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!enabled) return;
      const overId = event.over?.id;
      if (overId == null) return;
      const activeId = String(event.active.id);
      const nextOverId = String(overId);
      if (activeId === nextOverId) return;
      onMove(activeId, nextOverId);
    },
    [enabled, onMove]
  );

  if (!enabled || items.length < 2) {
    return <>{children}</>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={[...items]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function SortableSessionSlot({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return <>{children}</>;
  }
  return <ActiveSortableSessionSlot id={id}>{children}</ActiveSortableSessionSlot>;
}

function ActiveSortableSessionSlot({ id, children }: { id: string; children: ReactNode }) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const constrainedTransform = transform
    ? {
        ...transform,
        x: 0,
        scaleX: 1,
        scaleY: 1,
      }
    : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(constrainedTransform),
        transition,
      }}
      className={cn('group/session-sort relative', isDragging && 'z-20 opacity-60')}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        data-sidebar-session-drag-handle={id}
        className={cn(
          'absolute left-0 top-1/2 z-20 inline-flex h-6 w-4 -translate-y-1/2 items-center justify-center rounded-sm',
          'text-sidebar-foreground-muted/80 transition-[opacity,background-color,color] duration-100',
          'opacity-0 pointer-events-none',
          'group-hover/session-sort:opacity-100 group-hover/session-sort:pointer-events-auto',
          'hover:bg-sidebar-hover hover:text-sidebar-hover-foreground',
          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/40',
          'cursor-grab active:cursor-grabbing'
        )}
        aria-label={t('sessions.reorder', 'Reorder session')}
        draggable={false}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}
