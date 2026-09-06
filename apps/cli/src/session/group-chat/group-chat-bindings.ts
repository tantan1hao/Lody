import {
  getSessionRoomId,
  getWorkspaceFlockDocId,
  isGroupTurnPromptText,
  isRoomSession,
  isSessionDocRoomId,
  listWorkspaceAgentRoles,
  getSessionIdFromRoomId,
  readWorkspaceFlockRowsFromFlock,
  SessionStatusFactory,
  type AgentRole,
  type AgentRoleId,
  type GroupMember,
  type SessionId,
  type SessionMeta,
  type WorkspaceId,
} from '@lody/shared';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import { listAliveRoomIds } from '@/lib/loro/repo-existence';
import { createGroupChatServiceFromManager } from './group-chat-service';
import { setActiveGroupChatService } from './group-chat-runtime';

export async function loadGroupMembersFromFlock(
  manager: LoroDocumentManager,
  workspaceId: WorkspaceId,
  ids: readonly string[]
): Promise<GroupMember[]> {
  const docId = getWorkspaceFlockDocId(workspaceId);
  await manager.syncFlockDocOrThrow(docId, {
    timeoutMs: 10_000,
    reason: 'group-chat-role-read',
  });
  const handle = await manager.repo.openFlockDoc(docId);
  const roles = listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(handle.flock));
  const byId = new Map(roles.map((role) => [role.id, role]));
  return ids.flatMap((id) => {
    const role = byId.get(id as AgentRoleId);
    if (!role) return [];
    return [
      {
        id: role.id,
        name: role.name,
        description: role.promptPrefix?.trim() || '',
      },
    ];
  });
}

export function findHomeSessionForRole(
  metas: readonly SessionMeta[],
  roleId: AgentRoleId
): SessionMeta | undefined {
  return metas
    .filter(
      (meta) =>
        meta.sessionKind !== 'room' &&
        !meta.parentSessionId &&
        !meta.isArchived &&
        meta.agentRoleId === roleId
    )
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))[0];
}

export function shouldTreatAsDirectUserTurn(prompt: string | undefined): boolean {
  return typeof prompt === 'string' && prompt.length > 0 && !isGroupTurnPromptText(prompt);
}

export function bindGroupChatService(args: {
  manager: LoroDocumentManager;
  workspaceId: WorkspaceId;
  interruptSession: (sessionId: SessionId) => Promise<void> | void;
  setRoomPresence: (sessionId: SessionId, running: boolean) => void;
  dispatchHomeTurn: Parameters<
    typeof createGroupChatServiceFromManager
  >[0]['dispatchHomeTurn'];
  listKnownMetas?: () => SessionMeta[];
  loadRoles?: () => Promise<AgentRole[]>;
}) {
  const service = createGroupChatServiceFromManager({
    manager: args.manager,
    resolveMembers: async (ids) => {
      if (args.loadRoles) {
        const roles = await args.loadRoles();
        const byId = new Map(roles.map((role) => [role.id, role]));
        return ids.flatMap((id) => {
          const role = byId.get(id as AgentRoleId);
          if (!role) return [];
          return [
            {
              id: role.id,
              name: role.name,
              description: role.promptPrefix?.trim() || '',
            },
          ];
        });
      }
      return loadGroupMembersFromFlock(args.manager, args.workspaceId, ids);
    },
    ensureHomeSession: async ({ member, existingHomeId }) => {
      if (existingHomeId) return existingHomeId;
      const known = args.listKnownMetas?.() ?? [];
      const found = findHomeSessionForRole(known, member.id);
      if (found) return found.id;
      const scanned = await findHomeSessionFromRepo(args.manager, member.id);
      if (scanned) return scanned.id;
      return createHomeSessionFromRole(args.manager, args.workspaceId, member, args.loadRoles);
    },
    dispatchHomeTurn: args.dispatchHomeTurn,
    interruptSession: args.interruptSession,
    setRoomPresence: args.setRoomPresence,
  });
  setActiveGroupChatService(service);
  return service;
}

export function roleMark(role: Pick<AgentRole, 'emoji'> | undefined): string | undefined {
  return role?.emoji?.trim() || undefined;
}

async function loadRolesForWorkspace(
  manager: LoroDocumentManager,
  workspaceId: WorkspaceId,
  loadRoles?: () => Promise<AgentRole[]>
): Promise<AgentRole[]> {
  if (loadRoles) return loadRoles();
  const docId = getWorkspaceFlockDocId(workspaceId);
  await manager.syncFlockDocOrThrow(docId, {
    timeoutMs: 10_000,
    reason: 'group-chat-role-create',
  });
  const handle = await manager.repo.openFlockDoc(docId);
  return listWorkspaceAgentRoles(readWorkspaceFlockRowsFromFlock(handle.flock));
}

async function findHomeSessionFromRepo(
  manager: LoroDocumentManager,
  roleId: AgentRoleId
): Promise<SessionMeta | undefined> {
  const roomIds = await listAliveRoomIds(manager, isSessionDocRoomId);
  const matches: SessionMeta[] = [];
  for (const roomId of roomIds) {
    const record = await manager.repo.getDocMeta(roomId);
    const meta = record?.meta as SessionMeta | undefined;
    if (
      meta &&
      !isRoomSession(meta) &&
      !meta.parentSessionId &&
      !meta.isArchived &&
      meta.agentRoleId === roleId
    ) {
      matches.push({ ...meta, id: meta.id ?? getSessionIdFromRoomId(roomId) ?? meta.id });
    }
  }
  return findHomeSessionForRole(matches, roleId);
}

async function createHomeSessionFromRole(
  manager: LoroDocumentManager,
  workspaceId: WorkspaceId,
  member: GroupMember,
  loadRoles?: () => Promise<AgentRole[]>
): Promise<SessionId> {
  const roles = await loadRolesForWorkspace(manager, workspaceId, loadRoles);
  const role = roles.find((item) => item.id === member.id);
  if (!role) {
    throw new Error(`Agent Role ${member.name} is no longer available.`);
  }
  const config = await manager.getAgentConfigById(role.agentConfigId, role.machineId);
  if (!config) {
    throw new Error(
      `Agent Role ${member.name} is unavailable: its agent config is missing on the bound machine.`
    );
  }
  const sessionId = await manager.createSession(
    role.machineId,
    config.cliType,
    config.agentType,
    role.name
  );
  await manager.repo.upsertDocMeta(getSessionRoomId(sessionId), {
    agentConfigId: role.agentConfigId,
    agentRoleId: role.id,
    agentRoleRevision: role.revision,
    title: role.name,
    titleSource: 'user',
    status: SessionStatusFactory.idle(),
  });
  return sessionId;
}
