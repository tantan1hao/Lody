import {
  getSessionRoomId,
  planSessionAgentSwitch,
  sessionSwitchAgentFailure,
  type ACPSessionId,
  type AgentConfigId,
  type SessionId,
  type SessionMeta,
  type SessionSwitchAgentResponse,
  type SessionSwitchAgentSpec,
} from '@lody/shared';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import type { Logger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';
import type { SessionExecutionService } from './session-execution-service';
import type { SessionManager } from './session-manager';

export class SessionAgentSwitchService {
  private readonly inFlight = new Map<string, Promise<SessionSwitchAgentResponse>>();

  constructor(
    private readonly deps: {
      workspaceDocument: LoroDocumentManager;
      sessionManager: SessionManager;
      executionService: SessionExecutionService;
      logger: Logger;
      machineId: string;
      hasPendingDispatch(sessionId: SessionId): boolean;
    }
  ) {}

  async switchAgent(spec: SessionSwitchAgentSpec): Promise<SessionSwitchAgentResponse> {
    const existing = this.inFlight.get(spec.sessionId);
    if (existing) return await existing;
    const operation = this.switchAgentInner(spec).finally(() => {
      this.inFlight.delete(spec.sessionId);
    });
    this.inFlight.set(spec.sessionId, operation);
    return await operation;
  }

  private async switchAgentInner(spec: SessionSwitchAgentSpec): Promise<SessionSwitchAgentResponse> {
    const sessionDoc = await this.deps.workspaceDocument.getOrCreateSessionDoc(spec.sessionId);
    const meta = await sessionDoc.getMetaState();
    const execution = this.deps.executionService.getExecutionSnapshot(spec.sessionId);
    const target = meta
      ? await this.deps.workspaceDocument.getAgentConfigById(
          spec.agentConfigId as AgentConfigId,
          meta.machineId
        )
      : null;
    const plan = planSessionAgentSwitch({
      sessionExists: Boolean(meta),
      isArchived: meta?.isArchived === true,
      currentAgentConfigId: meta?.agentConfigId,
      currentMachineId: meta?.machineId,
      targetAgentConfigId: spec.agentConfigId,
      targetExists: Boolean(target),
      targetMachineId: target?.machineId,
      owningMachineId: this.deps.machineId,
      hasActiveTurn: execution.hasActiveTurn,
      hasBlockingPendingCreate: execution.hasBlockingPendingCreate,
      hasRewriteBarrier: execution.hasRewriteBarrier,
      hasActiveAutomation: execution.hasActiveAutomation,
      hasPendingDispatch: this.deps.hasPendingDispatch(spec.sessionId),
    });
    if (!plan.ok) {
      return sessionSwitchAgentFailure(spec, plan.code, plan.message);
    }
    if (!meta || plan.kind === 'noop' || !target) {
      return {
        type: 'session/switch-agent_response',
        sessionId: spec.sessionId,
        success: true,
        previousAgentConfigId: meta?.agentConfigId,
        agentConfigId: spec.agentConfigId,
        replayed: false,
      };
    }

    const releaseBarrier = this.deps.executionService.tryAcquireSessionRewriteBarrier(
      spec.sessionId
    );
    if (!releaseBarrier) {
      return sessionSwitchAgentFailure(
        spec,
        'SESSION_BUSY',
        'Another rewrite is already being applied.'
      );
    }

    try {
      await this.deps.sessionManager.requestSessionTerminate(spec.sessionId, true);
      await this.deps.workspaceDocument.repo.upsertDocMeta(getSessionRoomId(spec.sessionId), {
        agentConfigId: target.id,
        cliType: target.cliType,
        agentType: target.agentType,
        acpSessionId: '' as ACPSessionId,
      } satisfies Partial<SessionMeta>);
      await this.deps.workspaceDocument.persistPendingChanges('session-switch-agent-commit');
      return {
        type: 'session/switch-agent_response',
        sessionId: spec.sessionId,
        success: true,
        previousAgentConfigId: meta.agentConfigId,
        agentConfigId: target.id,
        replayed: true,
      };
    } catch (error) {
      this.deps.logger.error(
        `[session-switch-agent] Failed to switch ${spec.sessionId}: ${formatErrorMessage(error)}`
      );
      return sessionSwitchAgentFailure(
        spec,
        'INTERNAL_ERROR',
        formatErrorMessage(error) || 'Failed to switch agent.'
      );
    } finally {
      releaseBarrier();
    }
  }
}
