import type { MessageContent, SessionHistory, SessionHistoryParsed, SessionId } from '@lody/shared';
import type { ChatStreamItem } from './view';
import { normalizeMessageContent } from './message-content-guards';

export type BuildChatStreamItemsCache = ReadonlyMap<string, CachedChatStreamMessageItem>;

export type BuildChatStreamItemsResult = {
  items: ChatStreamItem[];
  lastAssistantMessageId: string | null;
  lastCompletedAssistantMessageId: string | null;
  cache: BuildChatStreamItemsCache;
};

type CachedChatStreamMessageItem = {
  readonly item: ChatStreamItem & { type: 'message' };
  readonly rawEntry: SessionHistory;
  readonly rawAcpTurnId: unknown;
  readonly rawItems: unknown;
  readonly rawStatus: unknown;
  readonly rawModelInfo: unknown;
  readonly rawFileDiff: unknown;
  readonly rawPlan: unknown;
  /** Preceding user-turn config attached for assistant header display. */
  readonly rawTurnInputConfig: unknown;
};

const EMPTY_CHAT_STREAM_ITEM: ChatStreamItem = { type: 'empty' };

const parseHistoryItemsForRender = (rawItems: unknown): MessageContent[] => {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item) => normalizeMessageContent(item))
    .filter((item): item is MessageContent => item !== null);
};

/**
 * An assistant entry with no items and no plan renders to `null` (see `ChatItem`
 * in view.tsx). Interrupted / aborted turns leave exactly these behind.
 */
const isEmptyAssistantMessage = (message: SessionHistoryParsed): boolean =>
  message.role === 'assistant' &&
  !message.items.length &&
  !(message.plan && message.plan.length > 0);

function canReuseCachedMessageItem(
  cached: CachedChatStreamMessageItem | undefined,
  entry: SessionHistory,
  sessionId: SessionId,
  /** Resolved config we would attach to this message (user's own or inherited). */
  expectedInputConfig: SessionHistoryParsed['inputConfig']
): cached is CachedChatStreamMessageItem {
  return (
    cached !== undefined &&
    cached.item.sessionId === sessionId &&
    cached.rawEntry === entry &&
    cached.rawAcpTurnId === entry.acpTurnId &&
    cached.rawItems === entry.items &&
    cached.item.message.id === entry.id &&
    cached.item.message.role === entry.role &&
    cached.rawStatus === entry.status &&
    cached.item.message.read === (entry.read ?? false) &&
    cached.item.message.timestamp === entry.timestamp &&
    cached.item.message.endedAt === entry.endedAt &&
    cached.item.message.userId === entry.userId &&
    cached.rawModelInfo === entry.modelInfo &&
    cached.rawFileDiff === entry.fileDiff &&
    cached.item.message.finished === entry.finished &&
    cached.rawPlan === entry.plan &&
    cached.rawTurnInputConfig === expectedInputConfig
  );
}

function createCachedMessageItem(
  entry: SessionHistory,
  sessionId: SessionId,
  message: SessionHistoryParsed
): CachedChatStreamMessageItem {
  return {
    item: { type: 'message', sessionId, message },
    rawEntry: entry,
    rawAcpTurnId: entry.acpTurnId,
    rawItems: entry.items,
    rawStatus: entry.status,
    rawModelInfo: entry.modelInfo,
    rawFileDiff: entry.fileDiff,
    rawPlan: entry.plan,
    rawTurnInputConfig: message.inputConfig,
  };
}

/**
 * Assistants whose `userTurnId` points at a user entry that appears later were
 * inserted concurrently (CLI reply vs client-authored user turn) and can sit
 * permanently above that prompt. Hold them on first sight and emit them
 * immediately after the matching user. Already-following assistants and those
 * without `userTurnId` stay in place.
 */
function collectDeferredAssistants(history: readonly SessionHistory[]): {
  deferredIds: Set<string>;
  deferredByUserTurnId: Map<string, SessionHistory[]>;
} {
  const firstUserIndexById = new Map<string, number>();
  for (let index = 0; index < history.length; index++) {
    const entry = history[index];
    if (entry?.role === 'user' && !firstUserIndexById.has(entry.id)) {
      firstUserIndexById.set(entry.id, index);
    }
  }

  const deferredIds = new Set<string>();
  const deferredByUserTurnId = new Map<string, SessionHistory[]>();
  for (let index = 0; index < history.length; index++) {
    const entry = history[index];
    if (entry?.role !== 'assistant' || !entry.userTurnId) continue;
    const userIndex = firstUserIndexById.get(entry.userTurnId);
    if (userIndex === undefined || userIndex <= index) continue;
    const existing = deferredByUserTurnId.get(entry.userTurnId);
    if (existing) {
      existing.push(entry);
    } else {
      deferredByUserTurnId.set(entry.userTurnId, [entry]);
    }
    deferredIds.add(entry.id);
  }
  return { deferredIds, deferredByUserTurnId };
}

/**
 * Build the Virtua VList item list from raw session history.
 *
 * Three defensive normalizations keep the virtual list robust against histories
 * left in an unusual shape by interrupted / bad-network turns. Such shapes
 * corrupt Virtua's index-keyed size cache and make its absolutely-positioned
 * rows overlap ("explode") deterministically — a stable, per-conversation bug:
 *
 *  1. Drop empty assistant entries (no items, no plan). They render to `null`,
 *     i.e. a virtual row with no DOM for Virtua's ResizeObserver to measure, so
 *     Virtua keeps a stale/estimated size and every offset after it drifts.
 *  2. De-duplicate by `id`. The VList keys rows by `history.id`; a duplicate id
 *     produces duplicate React keys and desyncs Virtua's element↔index map. Ids
 *     are random UUIDs so collisions are improbable, but this is cheap insurance
 *     so a single corrupt doc cannot permanently break the layout.
 *  3. If an assistant's `userTurnId` points at a user entry that appears later,
 *     emit that assistant immediately after the user. Dual-author history can
 *     persist that inversion; render repair must not reorder already-correct
 *     pairs or assistants that have no `userTurnId`.
 *
 * `lastAssistantMessageId` is computed over the normalized list so context-window
 * usage / quick actions attach to the last *rendered* assistant message.
 */
export function buildChatStreamItems(
  history: readonly SessionHistory[],
  sessionId: SessionId,
  previousCache?: BuildChatStreamItemsCache
): BuildChatStreamItemsResult {
  const items: ChatStreamItem[] = [];
  const seenIds = new Set<string>();
  const cache = new Map<string, CachedChatStreamMessageItem>();
  let lastAssistantMessageId: string | null = null;
  let lastCompletedAssistantMessageId: string | null = null;
  /** Config from the latest user turn — attached to the following assistant
   *  so the model meta row can show the full turn run-config on demand. */
  let lastUserInputConfig: SessionHistoryParsed['inputConfig'] | undefined;
  const { deferredIds, deferredByUserTurnId } = collectDeferredAssistants(history);

  const emitEntry = (entry: SessionHistory): void => {
    if (entry.role === 'user' && entry.inputConfig) {
      lastUserInputConfig = entry.inputConfig;
    }

    const expectedInputConfig =
      entry.role === 'user'
        ? entry.inputConfig
        : entry.role === 'assistant'
          ? (entry.inputConfig ?? lastUserInputConfig)
          : entry.inputConfig;

    const cached = previousCache?.get(entry.id);
    if (canReuseCachedMessageItem(cached, entry, sessionId, expectedInputConfig)) {
      if (seenIds.has(entry.id)) return;
      seenIds.add(entry.id);
      if (entry.role === 'assistant') {
        lastAssistantMessageId = entry.id;
        if (entry.finished === true) {
          lastCompletedAssistantMessageId = entry.id;
        }
      }
      cache.set(entry.id, cached);
      items.push(cached.item);
      return;
    }

    const message: SessionHistoryParsed = {
      id: entry.id,
      items: parseHistoryItemsForRender(entry.items),
      role: entry.role,
      status: entry.status,
      read: entry.read ?? false,
      timestamp: entry.timestamp,
      endedAt: entry.endedAt,
      userId: entry.userId,
      acpTurnId: entry.acpTurnId,
      modelInfo: entry.modelInfo,
      fileDiff: entry.fileDiff,
      finished: entry.finished,
      plan: entry.plan,
      // User turns keep their own config; assistant turns inherit the
      // preceding user's so the header can list mode / effort / plan / fast.
      inputConfig: expectedInputConfig,
    };

    if (isEmptyAssistantMessage(message)) return;
    if (seenIds.has(message.id)) return;
    seenIds.add(message.id);

    const cachedMessageItem = createCachedMessageItem(entry, sessionId, message);
    cache.set(message.id, cachedMessageItem);
    if (message.role === 'assistant') {
      lastAssistantMessageId = message.id;
      if (message.finished === true) {
        lastCompletedAssistantMessageId = message.id;
      }
    }
    items.push(cachedMessageItem.item);
  };

  for (const entry of history) {
    if (deferredIds.has(entry.id)) continue;
    const alreadySeen = seenIds.has(entry.id);
    emitEntry(entry);
    if (entry.role === 'user' && !alreadySeen) {
      const deferred = deferredByUserTurnId.get(entry.id);
      if (deferred) {
        for (const assistant of deferred) {
          emitEntry(assistant);
        }
      }
    }
  }

  if (!items.length) {
    return {
      items: [EMPTY_CHAT_STREAM_ITEM],
      lastAssistantMessageId: null,
      lastCompletedAssistantMessageId: null,
      cache,
    };
  }
  return { items, lastAssistantMessageId, lastCompletedAssistantMessageId, cache };
}
