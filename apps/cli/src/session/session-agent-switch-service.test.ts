import { describe, expect, it, vi } from 'vitest';
import {
  type AgentConfigId,
  type AgentConfigMeta,
  type MachineId,
  type SessionId,
  type SessionMeta,
} from '@lody/shared';
import { SessionAgentSwitchService } from './session-agent-switch-service';

const sessionId = 'session-1' as SessionId;
const machineId = 'machine-1' as MachineId;

function createHarness(
  options: {
    missingMeta?: boolean;
    archived?: boolean;
    busy?: boolean;
    pendingDispatch?: boolean;
    missingTarget?: boolean;
    targetMachineId?: string;
    terminateError?: Error;
    persistError?: Error;
  } = {}
) {
  const events: string[] = [];
  const meta = options.missingMeta
    ? null
    : ({
        id: sessionId,
        machineId,
        createdAt: '2026-08-03T00:00:00.000Z',
        userId: 'user-1',
        isArchived: options.archived === true,
        cliType: 'builtin',
        agentType: 'codex',
        agentConfigId: 'codex-1' as AgentConfigId,
        acpSessionId: 'acp-old',
      } as SessionMeta);
  const target = options.missingTarget
    ? null
    : ({
        id: 'claude-1' as AgentConfigId,
        machineId: (options.targetMachineId ?? machineId) as MachineId,
        name: 'Claude',
        description: undefined,
        cliType: 'builtin',
        agentType: 'claude',
        env: {},
      } satisfies AgentConfigMeta);

  let barrierHeld = false;
  const service = new SessionAgentSwitchService({
    workspaceDocument: {
      getOrCreateSessionDoc: vi.fn(async () => ({
        getMetaState: vi.fn(async () => meta),
      })),
      getAgentConfigById: vi.fn(async () => target),
      repo: {
        upsertDocMeta: vi.fn(async () => {
          events.push('meta');
        }),
      },
      persistPendingChanges: vi.fn(async () => {
        events.push('persist');
        if (options.persistError) throw options.persistError;
      }),
    } as never,
    sessionManager: {
      requestSessionTerminate: vi.fn(async () => {
        events.push('terminate');
        if (options.terminateError) throw options.terminateError;
        return 'terminated';
      }),
    } as never,
    executionService: {
      getExecutionSnapshot: vi.fn(() => ({
        hasActiveTurn: options.busy === true,
        hasBlockingPendingCreate: false,
        hasReusableSession: true,
        hasRewriteBarrier: barrierHeld,
        hasActiveAutomation: false,
      })),
      tryAcquireSessionRewriteBarrier: vi.fn(() => {
        barrierHeld = true;
        events.push('barrier-acquire');
        return () => {
          barrierHeld = false;
          events.push('barrier-release');
        };
      }),
    } as never,
    logger: { error: vi.fn(), debug: vi.fn() } as never,
    machineId,
    hasPendingDispatch: () => options.pendingDispatch === true,
  });

  return { events, service };
}

const spec = {
  sessionId,
  agentConfigId: 'claude-1' as AgentConfigId,
  requestedByUserId: 'user-1',
};

describe('SessionAgentSwitchService', () => {
  it('terminates the current ACP process and rebinds the session to the new agent', async () => {
    const harness = createHarness();
    await expect(harness.service.switchAgent(spec)).resolves.toEqual({
      type: 'session/switch-agent_response',
      sessionId,
      success: true,
      previousAgentConfigId: 'codex-1',
      agentConfigId: 'claude-1',
      replayed: true,
    });
    expect(harness.events).toEqual(['barrier-acquire', 'terminate', 'meta', 'persist', 'barrier-release']);
  });

  it('no-ops without tearing down the ACP process when the agent is unchanged', async () => {
    const harness = createHarness();
    await expect(
      harness.service.switchAgent({
        ...spec,
        agentConfigId: 'codex-1' as AgentConfigId,
      })
    ).resolves.toMatchObject({ success: true, replayed: false });
    expect(harness.events).toEqual([]);
  });

  it('rejects a busy session without terminating', async () => {
    const harness = createHarness({ busy: true });
    await expect(harness.service.switchAgent(spec)).resolves.toMatchObject({
      success: false,
      error: { code: 'SESSION_BUSY' },
    });
    expect(harness.events).toEqual([]);
  });

  it('rejects a missing target and a cross-machine target', async () => {
    await expect(createHarness({ missingTarget: true }).service.switchAgent(spec)).resolves.toMatchObject({
      success: false,
      error: { code: 'AGENT_CONFIG_NOT_FOUND' },
    });
    await expect(
      createHarness({ targetMachineId: 'machine-2' }).service.switchAgent(spec)
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'MACHINE_MISMATCH' },
    });
  });

  it('releases the rewrite barrier when terminate fails', async () => {
    const harness = createHarness({ terminateError: new Error('still running') });
    await expect(harness.service.switchAgent(spec)).resolves.toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(harness.events).toEqual(['barrier-acquire', 'terminate', 'barrier-release']);
  });
});
