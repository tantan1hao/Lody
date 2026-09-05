import type { SessionTextCommentReferencePayload } from '@lody/shared';

const COMPOSER_SELECTOR = '[data-keyboard-nav="composer"], textarea, input, [contenteditable="true"]';
const QUOTABLE_SELECTOR = '[data-native-selection-allow]';
const CONVERSATION_SELECTOR = '[data-session-conversation]';
const TURN_ID_ATTR = 'data-session-turn-id';
const TURN_ROLE_ATTR = 'data-session-turn-role';
const TURN_AUTHOR_ATTR = 'data-session-turn-author';

export type ConversationQuoteSelection = {
  payload: SessionTextCommentReferencePayload;
  rect: DOMRect;
};

function elementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function isWhitespaceOnly(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Read a conversation quote from the live DOM selection.
 * Empty, composer, and out-of-stream selections return null.
 */
export function readConversationQuoteSelection(
  selection: Selection | null,
  container: ParentNode | null
): ConversationQuoteSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = selection.toString();
  if (isWhitespaceOnly(text)) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startEl = elementFromNode(range.startContainer);
  if (!startEl || startEl.closest(COMPOSER_SELECTOR)) {
    return null;
  }

  const conversation = startEl.closest(CONVERSATION_SELECTOR);
  const scope = conversation ?? container;
  if (!scope) {
    return null;
  }
  if (!scope.contains(range.commonAncestorContainer)) {
    return null;
  }

  const quotable = startEl.closest(QUOTABLE_SELECTOR);
  if (!quotable || !scope.contains(quotable)) {
    return null;
  }

  const turnRoot = startEl.closest(`[${TURN_ID_ATTR}]`) ?? quotable.closest(`[${TURN_ID_ATTR}]`);
  const turnId = turnRoot?.getAttribute(TURN_ID_ATTR) ?? undefined;
  const roleAttr = turnRoot?.getAttribute(TURN_ROLE_ATTR);
  const role = roleAttr === 'user' || roleAttr === 'assistant' ? roleAttr : undefined;
  const authorName = turnRoot?.getAttribute(TURN_AUTHOR_ATTR) || undefined;

  return {
    payload: {
      source: 'session_text',
      commentBody: text,
      ...(authorName ? { authorName } : {}),
      ...(turnId ? { turnId } : {}),
      ...(role ? { role } : {}),
    },
    rect: visibleRangeRect(range),
  };
}

function visibleRangeRect(range: Range): DOMRect {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }
  return range.getClientRects().item(0) ?? rect;
}

/**
 * Prefer the live selection when it belongs to this turn; otherwise quote the
 * visible fallback text (footer / row action, no selection required).
 */
export function resolveConversationQuotePayload(args: {
  selection: Selection | null;
  fallbackText: string;
  turnId: string;
  role: 'user' | 'assistant';
  authorName?: string;
  container?: ParentNode | null;
}): SessionTextCommentReferencePayload | null {
  const quote = readConversationQuoteSelection(args.selection, args.container ?? null);
  if (quote && (!quote.payload.turnId || quote.payload.turnId === args.turnId)) {
    return quote.payload;
  }
  if (isWhitespaceOnly(args.fallbackText)) {
    return null;
  }
  return {
    source: 'session_text',
    commentBody: args.fallbackText,
    turnId: args.turnId,
    role: args.role,
    ...(args.authorName ? { authorName: args.authorName } : {}),
  };
}
