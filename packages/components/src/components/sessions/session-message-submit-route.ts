export type SessionMessageSubmitRoute =
  | { type: 'direct_dispatch' }
  | { type: 'guide' }
  | {
      type: 'queue';
      reason:
        | 'forced'
        | 'prompt_busy'
        | 'unfinished_assistant_turn'
        | 'transport_down'
        | 'room_send_in_flight';
    };

export type SessionMessageSubmitRouteInput = {
  forceDirect: boolean;
  forceQueue: boolean;
  isPromptBusy: boolean;
  hasUnfinishedAssistantTurn: boolean;
  queuedMessageBehavior: 'queue' | 'guide';
  /** Authoritative ACP `acknowledgedSteer`. Guide is a no-op without it. */
  canSteer?: boolean;
  isRoom?: boolean;
  transportDown?: boolean;
  roomUserSendInFlight?: boolean;
};

/**
 * Resolve one authoritative send route from live and durable conversation state.
 *
 * Presence is authoritative for whether a prompt is working right now. The
 * unfinished assistant turn is a conservative ordering barrier for the short
 * cross-room window where history has arrived but presence has not: queuing is
 * safe for both a genuinely active turn and a stale transcript, while direct
 * dispatch can violate the session's single-turn contract.
 */
export function resolveSessionMessageSubmitRoute({
  forceDirect,
  forceQueue,
  isPromptBusy,
  hasUnfinishedAssistantTurn,
  queuedMessageBehavior,
  canSteer = true,
  isRoom = false,
  transportDown = false,
  roomUserSendInFlight = false,
}: SessionMessageSubmitRouteInput): SessionMessageSubmitRoute {
  if (forceDirect) {
    return { type: 'direct_dispatch' };
  }
  if (isRoom && transportDown) {
    return { type: 'queue', reason: 'transport_down' };
  }
  if (isRoom && roomUserSendInFlight) {
    return { type: 'queue', reason: 'room_send_in_flight' };
  }
  if (
    !forceQueue &&
    !isRoom &&
    isPromptBusy &&
    queuedMessageBehavior === 'guide' &&
    canSteer &&
    hasUnfinishedAssistantTurn
  ) {
    return { type: 'guide' };
  }
  if (forceQueue) {
    return { type: 'queue', reason: 'forced' };
  }
  if (isPromptBusy) {
    return { type: 'queue', reason: 'prompt_busy' };
  }
  if (hasUnfinishedAssistantTurn) {
    return { type: 'queue', reason: 'unfinished_assistant_turn' };
  }
  return { type: 'direct_dispatch' };
}
