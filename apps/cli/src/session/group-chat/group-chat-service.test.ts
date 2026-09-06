import { describe, expect, it } from 'vitest';

import {
  GROUP_SEND_NONCE_DIGEST_MISMATCH,
  type AgentRoleId,
  type GroupMember,
  type SessionHistoryInput,
  type SessionId,
  type SessionMeta,
} from '@lody/shared';
import { GroupChatService } from './group-chat-service';

const alice: GroupMember = { id: 'role-a' as AgentRoleId, name: 'Alice', description: '' };
const bob: GroupMember = { id: 'role-b' as AgentRoleId, name: 'Bob', description: '' };

function createService(options?: {
  dispatchHomeTurn?: GroupChatService['deps']['dispatchHomeTurn'];
}) {
  const metas = new Map<SessionId, SessionMeta>();
  const histories = new Map<SessionId, SessionHistoryInput[]>();
  const spokenByHome = new Map<SessionId, string[]>();

  const roomId = 'room-1' as SessionId;
  const homeA = 'home-a' as SessionId;
  const homeB = 'home-b' as SessionId;
  metas.set(roomId, {
    id: roomId,
    machineId: 'machine-1' as SessionMeta['machineId'],
    createdAt: '2026-09-02T00:00:00.000Z',
    userId: 'user-1',
    cliType: 'builtin',
    agentType: 'codex',
    sessionKind: 'room',
    memberRoleIds: [alice.id, bob.id],
    memberHomeSessionIds: { [alice.id]: homeA, [bob.id]: homeB },
    title: 'Room',
    groupEpoch: 0,
  });
  metas.set(homeA, {
    id: homeA,
    machineId: 'machine-1' as SessionMeta['machineId'],
    createdAt: '2026-09-02T00:00:00.000Z',
    userId: 'user-1',
    cliType: 'builtin',
    agentType: 'codex',
    agentRoleId: alice.id,
    title: 'Alice',
  });
  metas.set(homeB, {
    id: homeB,
    machineId: 'machine-1' as SessionMeta['machineId'],
    createdAt: '2026-09-02T00:00:00.000Z',
    userId: 'user-1',
    cliType: 'builtin',
    agentType: 'codex',
    agentRoleId: bob.id,
    title: 'Bob',
  });
  histories.set(roomId, [
    {
      id: 'user-1',
      role: 'user',
      timestamp: '2026-09-02T00:00:01.000Z',
      items: [{ type: 'text', text: 'hello @Alice' }],
      fileDiff: [],
    },
  ]);
  histories.set(homeA, []);
  histories.set(homeB, []);

  const service = new GroupChatService({
    getSessionMeta: (sessionId) => metas.get(sessionId),
    listSessionMetas: () => [...metas.values()],
    openSessionDoc: async (sessionId) =>
      ({
        getHistory: async () => histories.get(sessionId) ?? [],
        updateHistory: async (updater: (history: SessionHistoryInput[]) => SessionHistoryInput[]) => {
          histories.set(sessionId, updater(histories.get(sessionId) ?? []));
        },
      }) as never,
    upsertDocMeta: async (sessionId, patch) => {
      const current = metas.get(sessionId);
      if (current) metas.set(sessionId, { ...current, ...patch, id: sessionId });
    },
    resolveMembers: async (ids) => [alice, bob].filter((member) => ids.includes(member.id)),
    ensureHomeSession: async ({ member, existingHomeId }) =>
      existingHomeId ?? (member.id === alice.id ? homeA : homeB),
    dispatchHomeTurn:
      options?.dispatchHomeTurn ??
      (async ({ homeSessionId }) => {
        const alreadySpoke = (histories.get(roomId) ?? []).some((entry) =>
          (entry.items ?? []).some((item) => item.type === 'room_speech')
        );
        const result = await service.roomSpeak({
          homeSessionId,
          type: 'text',
          content: homeSessionId === homeA && !alreadySpoke ? 'Alice here' : '(pass)',
        });
        spokenByHome.set(homeSessionId, [
          ...(spokenByHome.get(homeSessionId) ?? []),
          result.ok ? (result.pass ? '(pass)' : 'spoken') : 'error',
        ]);
      }),
    interruptSession: () => undefined,
    setRoomPresence: () => undefined,
  });

  return { service, histories, metas, roomId, homeA, homeB };
}

describe('GroupChatService', () => {
  it('accepts the same room nonce once and rejects a digest mismatch', async () => {
    const { service, roomId } = createService();
    const first = await service.acceptRoomSend({
      roomSessionId: roomId,
      prompt: 'hello',
      clientNonce: 'nonce-1',
    });
    expect(first).toEqual({ accepted: true });
    service.markRoomSendAccepted('nonce-1');
    const replay = await service.acceptRoomSend({
      roomSessionId: roomId,
      prompt: 'hello',
      clientNonce: 'nonce-1',
    });
    expect(replay).toEqual({ accepted: true });
    const mismatch = await service.acceptRoomSend({
      roomSessionId: roomId,
      prompt: 'other',
      clientNonce: 'nonce-1',
    });
    expect(mismatch).toEqual({ accepted: false, error: GROUP_SEND_NONCE_DIGEST_MISMATCH });
  });

  it('writes room_speech from the member tool and not a second time from the orchestrator', async () => {
    const { service, histories, roomId } = createService();
    await service.runRoomUserTurn({ roomSessionId: roomId, userTurnId: 'user-1' });
    const speech = (histories.get(roomId) ?? []).flatMap((entry) =>
      (entry.items ?? []).filter((item) => item.type === 'room_speech')
    );
    expect(speech).toHaveLength(1);
    expect(speech[0]).toMatchObject({ speakerName: 'Alice', text: 'Alice here' });
  });

  it('rejects a same-turn send-to-agent follow-up', async () => {
    const results: Array<{ ok: boolean }> = [];
    let service!: GroupChatService;
    const created = createService({
      dispatchHomeTurn: async ({ homeSessionId }) => {
        await service.roomSpeak({
          homeSessionId,
          type: 'text',
          content: 'Alice here',
        });
        results.push(
          await service.sendToAgent({
            fromSessionId: created.homeA,
            fromRoleId: alice.id,
            fromRoleName: 'Alice',
            targetSessionId: created.homeB,
            message: 'ping',
          })
        );
        results.push(
          await service.sendToAgent({
            fromSessionId: created.homeA,
            fromRoleId: alice.id,
            fromRoleName: 'Alice',
            targetSessionId: created.homeB,
            message: 'pong',
          })
        );
      },
    });
    service = created.service;
    await service.runRoomUserTurn({ roomSessionId: created.roomId, userTurnId: 'user-1' });
    expect(results[0]?.ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false });
  });
});
