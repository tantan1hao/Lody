import { describe, expect, it } from 'vitest';
import {
  planSessionAgentSwitch,
  SessionSwitchAgentSpecSchema,
  sessionSwitchAgentFailure,
  type SessionAgentSwitchPlanInput,
} from '../src/session-agent-switch';

const ready: SessionAgentSwitchPlanInput = {
  sessionExists: true,
  isArchived: false,
  currentAgentConfigId: 'codex-1',
  currentMachineId: 'machine-1',
  targetAgentConfigId: 'claude-1',
  targetExists: true,
  targetMachineId: 'machine-1',
  owningMachineId: 'machine-1',
  hasActiveTurn: false,
  hasBlockingPendingCreate: false,
  hasRewriteBarrier: false,
  hasActiveAutomation: false,
  hasPendingDispatch: false,
};

describe('planSessionAgentSwitch', () => {
  it('allows an idle same-machine switch', () => {
    expect(planSessionAgentSwitch(ready)).toEqual({ ok: true, kind: 'switch' });
  });

  it('is a no-op when the target is already bound', () => {
    expect(
      planSessionAgentSwitch({
        ...ready,
        targetAgentConfigId: 'codex-1',
      })
    ).toEqual({ ok: true, kind: 'noop' });
  });

  it('rejects a busy session before comparing agents as a switch', () => {
    expect(planSessionAgentSwitch({ ...ready, hasActiveTurn: true })).toMatchObject({
      ok: false,
      code: 'SESSION_BUSY',
    });
    expect(planSessionAgentSwitch({ ...ready, hasPendingDispatch: true })).toMatchObject({
      ok: false,
      code: 'SESSION_BUSY',
    });
  });

  it('still no-ops the same agent even while busy', () => {
    expect(
      planSessionAgentSwitch({
        ...ready,
        targetAgentConfigId: 'codex-1',
        hasActiveTurn: true,
      })
    ).toEqual({ ok: true, kind: 'noop' });
  });

  it('rejects a missing session, archive, missing config, and cross-machine target', () => {
    expect(planSessionAgentSwitch({ ...ready, sessionExists: false })).toMatchObject({
      ok: false,
      code: 'SESSION_NOT_FOUND',
    });
    expect(planSessionAgentSwitch({ ...ready, isArchived: true })).toMatchObject({
      ok: false,
      code: 'SESSION_ARCHIVED',
    });
    expect(planSessionAgentSwitch({ ...ready, targetExists: false })).toMatchObject({
      ok: false,
      code: 'AGENT_CONFIG_NOT_FOUND',
    });
    expect(
      planSessionAgentSwitch({
        ...ready,
        targetMachineId: 'machine-2',
      })
    ).toMatchObject({ ok: false, code: 'MACHINE_MISMATCH' });
    expect(
      planSessionAgentSwitch({
        ...ready,
        currentMachineId: 'machine-2',
      })
    ).toMatchObject({ ok: false, code: 'MACHINE_MISMATCH' });
  });
});

describe('session switch agent contract', () => {
  it('parses a switch request and builds a failure envelope', () => {
    expect(
      SessionSwitchAgentSpecSchema.parse({
        sessionId: 'session-1',
        agentConfigId: 'claude-1',
        requestedByUserId: 'user-1',
      })
    ).toEqual({
      sessionId: 'session-1',
      agentConfigId: 'claude-1',
      requestedByUserId: 'user-1',
    });
    expect(sessionSwitchAgentFailure({ sessionId: 'session-1' }, 'SESSION_BUSY', 'busy')).toEqual({
      type: 'session/switch-agent_response',
      sessionId: 'session-1',
      success: false,
      error: { code: 'SESSION_BUSY', message: 'busy' },
    });
  });
});
