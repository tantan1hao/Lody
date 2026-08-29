import { z } from 'zod';
import { AgentConfigIdSchema, SessionIdSchema } from './message-schemas';

export const SessionSwitchAgentErrorCodeSchema = z.enum([
  'SESSION_NOT_FOUND',
  'SESSION_ARCHIVED',
  'SESSION_BUSY',
  'AGENT_CONFIG_NOT_FOUND',
  'MACHINE_MISMATCH',
  'MACHINE_ACCESS_DENIED',
  'HISTORY_WRITE_FAILED',
  'INTERNAL_ERROR',
]);

export const SessionSwitchAgentSpecSchema = z
  .object({
    sessionId: SessionIdSchema,
    agentConfigId: AgentConfigIdSchema,
    requestedByUserId: z.string().trim().min(1),
  })
  .strict();

export const SessionSwitchAgentResponseSchema = z
  .object({
    type: z.literal('session/switch-agent_response'),
    sessionId: SessionIdSchema,
    success: z.boolean(),
    previousAgentConfigId: AgentConfigIdSchema.optional(),
    agentConfigId: AgentConfigIdSchema.optional(),
    replayed: z.boolean().optional(),
    error: z
      .object({
        code: SessionSwitchAgentErrorCodeSchema,
        message: z.string().trim().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SessionSwitchAgentErrorCode = z.infer<typeof SessionSwitchAgentErrorCodeSchema>;
export type SessionSwitchAgentSpec = z.infer<typeof SessionSwitchAgentSpecSchema>;
export type SessionSwitchAgentResponse = z.infer<typeof SessionSwitchAgentResponseSchema>;

export function sessionSwitchAgentFailure(
  spec: Pick<SessionSwitchAgentSpec, 'sessionId'>,
  code: SessionSwitchAgentErrorCode,
  message: string
): SessionSwitchAgentResponse {
  return {
    type: 'session/switch-agent_response',
    sessionId: spec.sessionId,
    success: false,
    error: { code, message },
  };
}

export type SessionAgentSwitchBusyFlags = {
  hasActiveTurn: boolean;
  hasBlockingPendingCreate: boolean;
  hasRewriteBarrier: boolean;
  hasActiveAutomation: boolean;
  hasPendingDispatch: boolean;
};

export type SessionAgentSwitchPlanInput = SessionAgentSwitchBusyFlags & {
  sessionExists: boolean;
  isArchived: boolean;
  currentAgentConfigId?: string;
  currentMachineId?: string;
  targetAgentConfigId: string;
  targetExists: boolean;
  targetMachineId?: string;
  owningMachineId: string;
};

export type SessionAgentSwitchPlan =
  | { ok: true; kind: 'noop' }
  | { ok: true; kind: 'switch' }
  | { ok: false; code: SessionSwitchAgentErrorCode; message: string };

function isBusy(flags: SessionAgentSwitchBusyFlags): boolean {
  return (
    flags.hasActiveTurn ||
    flags.hasBlockingPendingCreate ||
    flags.hasRewriteBarrier ||
    flags.hasActiveAutomation ||
    flags.hasPendingDispatch
  );
}

/**
 * Decides whether a same-session agent switch may proceed. The CLI service
 * applies this plan and then tears down the current ACP process so the next
 * turn starts fresh and replays Lody history.
 */
export function planSessionAgentSwitch(input: SessionAgentSwitchPlanInput): SessionAgentSwitchPlan {
  if (!input.sessionExists) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Session was not found.' };
  }
  if (input.isArchived) {
    return { ok: false, code: 'SESSION_ARCHIVED', message: 'Archived sessions cannot switch agent.' };
  }
  if (!input.currentMachineId || input.currentMachineId !== input.owningMachineId) {
    return {
      ok: false,
      code: 'MACHINE_MISMATCH',
      message: 'The session is not bound to this machine.',
    };
  }
  if (!input.targetExists) {
    return {
      ok: false,
      code: 'AGENT_CONFIG_NOT_FOUND',
      message: 'The target agent config was not found on this machine.',
    };
  }
  if (!input.targetMachineId || input.targetMachineId !== input.currentMachineId) {
    return {
      ok: false,
      code: 'MACHINE_MISMATCH',
      message: 'The target agent is not on the same machine as this session.',
    };
  }
  if (input.currentAgentConfigId === input.targetAgentConfigId) {
    return { ok: true, kind: 'noop' };
  }
  if (isBusy(input)) {
    return {
      ok: false,
      code: 'SESSION_BUSY',
      message: 'Wait until the current turn finishes before switching agent.',
    };
  }
  return { ok: true, kind: 'switch' };
}
