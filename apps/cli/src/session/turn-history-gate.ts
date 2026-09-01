import type { SessionHistoryInput, SessionId } from '@lody/shared';
import type { Logger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';

/**
 * TurnHistoryGate — ordering barrier for RPC fast-path turn output.
 *
 * ## Problem
 *
 * `session/dispatch-turn` (the chat fast path) pushes the full turn payload over
 * Machine RPC so the CLI can start the agent before the session-doc history CRDT
 * syncs. The user's history entry is written by the web client into ITS replica;
 * the CLI never writes that entry itself. If the CLI persists turn output (the
 * assistant entry and streamed ACP content) while the user entry has not synced
 * here yet, the two list insertions are CONCURRENT at the same anchor, and the
 * Loro merge tiebreak can permanently order the agent's reply BEFORE the user's
 * message on every device.
 *
 * ## Contract
 *
 * - Agent execution starts immediately (the fast path's latency win is kept).
 * - Turn-scoped history LIST writes (assistant entry creation, ACP update
 *   flushes, finalization, failure notices) wait until the user turn entry is
 *   visible in the CLI-local history doc, so they are causally ordered after it.
 * - `timeoutMs` is a diagnostic, not a write-release: the gate stays closed and
 *   `onBeforeOpen` does not run. The "client cannot see our output if sync is
 *   stalled" assumption is false for mobile — the user entry is already local
 *   there, so a late CLI insert can permanently invert the transcript. Holding
 *   list writes is better than a permanently inverted transcript. Dispose still
 *   opens without `onBeforeOpen` (teardown).
 * - Metadata/status writes are NOT gated: they are map-keyed (no list-order
 *   race) and some sit on the prompt-start critical path.
 *
 * Turns whose payload arrived via the history CRDT or the message queue never
 * need a gate — their user entry is already local by construction.
 */

export type TurnHistoryGateOpenReason = 'user-turn-synced' | 'disposed';

export type TurnHistoryGateArgs = {
  logger: Logger;
  sessionId: SessionId;
  userTurnId: string;
  /** Read the CLI-local session history (mirror state; cheap). */
  readHistory: () => Promise<SessionHistoryInput[]>;
  /** Subscribe to local doc changes (remote imports included); returns unsubscribe. */
  subscribeHistory: (listener: () => void) => (() => void) | undefined;
  /**
   * Runs exactly once, right before waiters are released (skipped on dispose).
   * Used to create the turn's assistant entry so every gated writer resumes
   * against an existing, correctly-ordered entry. Errors are logged and do not
   * keep the gate closed — downstream flushes self-create the entry by id.
   */
  onBeforeOpen?: (reason: TurnHistoryGateOpenReason) => Promise<void>;
  timeoutMs?: number;
};

/**
 * Diagnostic deadline for a stalled user-turn sync. The timer only logs; it
 * never opens the gate. List writes stay held until `user-turn-synced` or
 * dispose, because a concurrent insert after this deadline can permanently
 * invert the transcript on devices that already have the user entry.
 */
export const DEFAULT_TURN_HISTORY_GATE_TIMEOUT_MS = 20_000;

export class TurnHistoryGate {
  private open = false;
  private readonly opened: Promise<void>;
  private releaseWaiters: () => void = () => {};
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private checking = false;
  private recheckRequested = false;
  private readonly createdAtMs = Date.now();

  private constructor(private readonly args: TurnHistoryGateArgs | null) {
    if (!args) {
      this.open = true;
      this.opened = Promise.resolve();
      return;
    }
    this.opened = new Promise<void>((resolve) => {
      this.releaseWaiters = resolve;
    });
    const timeoutMs = args.timeoutMs ?? DEFAULT_TURN_HISTORY_GATE_TIMEOUT_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.warnHeldAfterTimeout();
    }, timeoutMs);
    this.timer.unref?.();
    this.unsubscribe = args.subscribeHistory(() => this.scheduleCheck());
    if (!this.unsubscribe) {
      args.logger.debug(
        `[${args.sessionId}] Turn history gate has no doc subscription; list writes stay held until the user turn is local`
      );
    }
    this.scheduleCheck();
  }

  /** Gate that is already open (turn payload came from local history / queue). */
  static alreadyOpen(): TurnHistoryGate {
    return new TurnHistoryGate(null);
  }

  /** Gate that opens once the user turn entry is present locally (or on dispose). */
  static waitForUserTurn(args: TurnHistoryGateArgs): TurnHistoryGate {
    return new TurnHistoryGate(args);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Resolves when turn-scoped history writes may proceed. Never rejects. */
  waitUntilOpen(): Promise<void> {
    return this.opened;
  }

  /**
   * Release waiters without running `onBeforeOpen` (turn teardown / session
   * eviction). Late flushes self-create the assistant entry when needed.
   */
  dispose(): void {
    void this.openGate('disposed');
  }

  /** Serialized, coalescing presence check — one read at a time per gate. */
  private scheduleCheck(): void {
    const args = this.args;
    if (this.open || !args) {
      return;
    }
    if (this.checking) {
      this.recheckRequested = true;
      return;
    }
    this.checking = true;
    void (async () => {
      try {
        do {
          this.recheckRequested = false;
          if (this.open) {
            return;
          }
          const history = await args.readHistory();
          const present = history.some(
            (entry) => entry.role === 'user' && entry.id === args.userTurnId
          );
          if (present) {
            await this.openGate('user-turn-synced');
            return;
          }
        } while (this.recheckRequested);
      } catch (error) {
        args.logger.debug(
          `[${args.sessionId}] Turn history gate check failed: ${formatErrorMessage(error)}`
        );
      } finally {
        this.checking = false;
      }
    })();
  }

  private warnHeldAfterTimeout(): void {
    const args = this.args;
    if (this.open || !args) {
      return;
    }
    const waitedMs = Date.now() - this.createdAtMs;
    args.logger.warn(
      `[${args.sessionId}] User turn ${args.userTurnId} did not sync within ${waitedMs}ms; holding turn history list writes until the user entry is local (to avoid permanently ordering the reply before the user message)`
    );
  }

  private async openGate(reason: TurnHistoryGateOpenReason): Promise<void> {
    if (this.open) {
      return;
    }
    this.open = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    const args = this.args;
    if (args) {
      const waitedMs = Date.now() - this.createdAtMs;
      args.logger.debug(
        `[${args.sessionId}] Turn history gate opened (${reason}) after ${waitedMs}ms`
      );
      if (reason !== 'disposed' && args.onBeforeOpen) {
        try {
          await args.onBeforeOpen(reason);
        } catch (error) {
          args.logger.error(
            `[${args.sessionId}] Turn history gate onBeforeOpen failed: ${formatErrorMessage(error)}`
          );
        }
      }
    }
    this.releaseWaiters();
  }
}
