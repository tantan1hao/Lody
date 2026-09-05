'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Quote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommentReferencePayload } from '@lody/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';
import { readConversationQuoteSelection } from './conversation-selection';

export type ConversationSelectionToolbarProps = {
  addCommentReference: (reference: CommentReferencePayload) => boolean;
  /** Conversation stream viewport. Composer and file viewers sit outside it. */
  container?: HTMLElement | null;
};

type ToolbarState = {
  payload: CommentReferencePayload;
  top: number;
  left: number;
};

function positionFromRect(rect: DOMRect): { top: number; left: number } {
  const gap = 8;
  const estimatedHeight = 32;
  let top = rect.top - estimatedHeight - gap;
  if (top < gap) {
    top = rect.bottom + gap;
  }
  return {
    top,
    left: rect.left + rect.width / 2,
  };
}

/**
 * Floating “Add as comment” action for native text selection in a session stream.
 * Never steals focus on pointerdown — that would collapse the selection first.
 * Portaled to document.body so overflow ancestors cannot clip it.
 */
export function ConversationSelectionToolbar({
  addCommentReference,
  container,
}: ConversationSelectionToolbarProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<ToolbarState | null>(null);

  const syncFromSelection = useCallback(() => {
    const quote = readConversationQuoteSelection(
      typeof window === 'undefined' ? null : window.getSelection(),
      container ?? null
    );
    if (!quote) {
      setState(null);
      return;
    }
    const position = positionFromRect(quote.rect);
    setState({
      payload: quote.payload,
      top: position.top,
      left: position.left,
    });
  }, [container]);

  useEffect(() => {
    const onSelectionChange = () => {
      syncFromSelection();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mouseup', onSelectionChange);
    document.addEventListener('keyup', onSelectionChange);
    container?.addEventListener('scroll', onSelectionChange);
    window.addEventListener('resize', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mouseup', onSelectionChange);
      document.removeEventListener('keyup', onSelectionChange);
      container?.removeEventListener('scroll', onSelectionChange);
      window.removeEventListener('resize', onSelectionChange);
    };
  }, [container, syncFromSelection]);

  const handleAdd = useCallback(() => {
    if (!state) return;
    const added = addCommentReference(state.payload);
    if (added) {
      window.getSelection()?.removeAllRanges();
      setState(null);
    }
  }, [addCommentReference, state]);

  if (!state || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      data-conversation-selection-toolbar=""
      className="pointer-events-auto fixed z-[80]"
      style={{
        top: state.top,
        left: state.left,
        transform: 'translateX(-50%)',
      }}
    >
      <button
        type="button"
        // pointerdown would otherwise move focus and collapse the selection
        // before click, which is the usual way this action silently no-ops.
        onPointerDown={(event) => event.preventDefault()}
        onClick={handleAdd}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-lg border border-border bg-popover px-2 text-xs font-medium',
          'text-foreground shadow-md hover:bg-muted'
        )}
      >
        <Quote className="h-3.5 w-3.5 shrink-0" />
        {t('sessions.quoteSelection.addAsComment', 'Add as comment')}
      </button>
    </div>,
    document.body
  );
}

/** Turn-footer / user-row icon that uses the same add-as-comment chip path. */
export function AddAsCommentButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t('sessions.quoteSelection.addAsComment', 'Add as comment');
  return (
    <TooltipProvider>
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7 text-muted-foreground hover:bg-hover hover:text-foreground',
              className
            )}
            onClick={onClick}
            aria-label={label}
          >
            <Quote className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
