import type { GroupRunLane, GroupRunSource } from '@lody/shared';
import { compareGroupRunLane } from '@lody/shared';

export type GroupLaneJob<T = void> = {
  id: string;
  lane: GroupRunLane;
  source: GroupRunSource;
  epoch?: number;
  /** Interrupt agent/background work, but never a user turn. */
  preemptNonUser?: boolean;
  run: (signal: AbortSignal) => Promise<T>;
};

type QueueState<T> = {
  running?: { job: GroupLaneJob<T>; controller: AbortController; promise: Promise<T> };
  queued: GroupLaneJob<T>[];
};

/**
 * One exclusive run per session. User lane preempts agent and background.
 */
export class GroupRunLaneScheduler {
  private readonly states = new Map<string, QueueState<unknown>>();

  enqueue<T>(sessionId: string, job: GroupLaneJob<T>): Promise<T> {
    const state = this.state(sessionId);
    const running = state.running;
    if (running) {
      const shouldPreempt =
        compareGroupRunLane(job.lane, running.job.lane) < 0 ||
        (job.lane === 'user' && running.job.lane === 'user') ||
        (job.preemptNonUser === true && running.job.lane !== 'user');
      if (shouldPreempt) {
        running.controller.abort();
      } else {
        return new Promise<T>((resolve, reject) => {
          state.queued.push({
            ...job,
            run: async (signal) => {
              try {
                const value = await job.run(signal);
                resolve(value);
                return value;
              } catch (error) {
                reject(error);
                throw error;
              }
            },
          });
        });
      }
    }
    return this.start(sessionId, job);
  }

  interrupt(sessionId: string, reason?: string): void {
    const state = this.states.get(sessionId);
    state?.running?.controller.abort(reason);
  }

  isRunning(sessionId: string): boolean {
    return this.states.get(sessionId)?.running !== undefined;
  }

  private start<T>(sessionId: string, job: GroupLaneJob<T>): Promise<T> {
    const state = this.state(sessionId);
    const controller = new AbortController();
    const promise = job.run(controller.signal).finally(() => {
      if (state.running?.job.id === job.id) {
        state.running = undefined;
        const next = state.queued.shift();
        if (next) {
          void this.start(sessionId, next);
        }
      }
    });
    state.running = { job: job as GroupLaneJob<unknown>, controller, promise };
    return promise;
  }

  private state(sessionId: string): QueueState<unknown> {
    const existing = this.states.get(sessionId);
    if (existing) return existing;
    const created: QueueState<unknown> = { queued: [] };
    this.states.set(sessionId, created);
    return created;
  }
}
