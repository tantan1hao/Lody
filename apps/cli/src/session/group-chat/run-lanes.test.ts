import { describe, expect, it } from 'vitest';

import { GroupRunLaneScheduler } from './run-lanes';

describe('GroupRunLaneScheduler', () => {
  it('lets a user job preempt agent work', async () => {
    const scheduler = new GroupRunLaneScheduler();
    const events: string[] = [];
    let releaseAgent!: () => void;
    const agentHold = new Promise<void>((resolve) => {
      releaseAgent = resolve;
    });

    const agent = scheduler.enqueue('session-1', {
      id: 'agent',
      lane: 'agent',
      source: 'agent',
      run: async (signal) => {
        events.push('agent-start');
        await Promise.race([
          agentHold,
          new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          }),
        ]);
        events.push(signal.aborted ? 'agent-aborted' : 'agent-done');
      },
    });

    const user = scheduler.enqueue('session-1', {
      id: 'user',
      lane: 'user',
      source: 'group',
      run: async () => {
        events.push('user');
      },
    });

    await user;
    releaseAgent();
    await agent;
    expect(events).toEqual(['agent-start', 'user', 'agent-aborted']);
  });

  it('queues agent work behind a running user turn', async () => {
    const scheduler = new GroupRunLaneScheduler();
    const events: string[] = [];
    let releaseUser!: () => void;
    const userHold = new Promise<void>((resolve) => {
      releaseUser = resolve;
    });

    const user = scheduler.enqueue('session-1', {
      id: 'user',
      lane: 'user',
      source: 'turn',
      run: async () => {
        events.push('user-start');
        await userHold;
        events.push('user-done');
      },
    });
    const agent = scheduler.enqueue('session-1', {
      id: 'agent',
      lane: 'agent',
      source: 'agent',
      run: async () => {
        events.push('agent');
      },
    });

    releaseUser();
    await Promise.all([user, agent]);
    expect(events).toEqual(['user-start', 'user-done', 'agent']);
  });
});
