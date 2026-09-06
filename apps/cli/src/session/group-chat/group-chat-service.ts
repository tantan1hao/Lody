import { randomUUID } from 'node:crypto';
import {
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MEMBER_REDRIVE_LIMIT,
  GROUP_SEND_TO_AGENT_MAX_CHARS,
  GROUP_SEND_NONCE_DIGEST_MISMATCH,
  GroupSendAcceptanceLedger,
  LODY_ROOM_SPEAK_TOOL_NAME,
  buildGroupTurnPrompt,
  getServerNow,
  getSessionRoomId,
  groupSendInputDigest,
  isPassContent,
  isRoomSession,
  normalizeMemberRoleIds,
  type AgentRoleId,
  type GroupMember,
  type GroupMessage,
  type MessageContent,
  type SessionHistoryInput,
  type SessionId,
  type SessionImagePayload,
  type SessionMeta,
} from '@lody/shared';
import type { SessionDocument } from '@/lib/loro/doc';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import { GroupChatOrchestrator } from './group-chat-orchestrator';
import { GroupRunLaneScheduler } from './run-lanes';

export type ActiveMemberTurn = {
  roomSessionId: SessionId;
  memberRoleId: AgentRoleId;
  epoch: number;
  spoken: string[];
  speakCount: number;
  awaitingUser: boolean;
  redriveCount: number;
  sentToAgentThisTurn: boolean;
};

export type GroupChatServiceDeps = {
  getSessionMeta: (sessionId: SessionId) => SessionMeta | undefined;
  listSessionMetas: () => SessionMeta[];
  openSessionDoc: (sessionId: SessionId) => Promise<SessionDocument>;
  upsertDocMeta: (
    sessionId: SessionId,
    patch: Partial<SessionMeta>
  ) => Promise<void>;
  resolveMembers: (ids: readonly string[]) => Promise<GroupMember[]>;
  ensureHomeSession: (args: {
    roomSessionId: SessionId;
    member: GroupMember;
    existingHomeId?: SessionId;
  }) => Promise<SessionId>;
  dispatchHomeTurn: (args: {
    homeSessionId: SessionId;
    prompt: string;
    systemPrompt: string;
    roomSessionId: SessionId;
    roomTitle: string;
    signal: AbortSignal;
  }) => Promise<void>;
  interruptSession: (sessionId: SessionId, reason: string) => Promise<void> | void;
  setRoomPresence: (sessionId: SessionId, running: boolean) => Promise<void> | void;
};

export class GroupChatService {
  readonly ledger = new GroupSendAcceptanceLedger();
  readonly lanes = new GroupRunLaneScheduler();
  readonly activeByHomeSession = new Map<SessionId, ActiveMemberTurn>();
  private readonly spokenThisTurn = new Map<string, string[]>();

  constructor(readonly deps: GroupChatServiceDeps) {}

  getActiveMemberTurn(homeSessionId: SessionId): ActiveMemberTurn | undefined {
    return this.activeByHomeSession.get(homeSessionId);
  }

  findRoomForHomeSession(homeSessionId: SessionId): SessionMeta | undefined {
    return this.deps
      .listSessionMetas()
      .find(
        (meta) =>
          isRoomSession(meta) &&
          Object.values(meta.memberHomeSessionIds ?? {}).includes(homeSessionId)
      );
  }

  async acceptRoomSend(args: {
    roomSessionId: SessionId;
    prompt: string;
    clientNonce?: string;
    replyToId?: string;
    attachmentNames?: readonly string[];
  }): Promise<{ accepted: true } | { accepted: false; error: string }> {
    const nonce = args.clientNonce?.trim();
    if (!nonce) return { accepted: true };
    const digest = groupSendInputDigest({
      agentId: args.roomSessionId,
      prompt: args.prompt,
      replyToId: args.replyToId,
      attachmentNames: args.attachmentNames,
    });
    const existing = this.ledger.lookup(nonce, digest);
    if (existing.status === 'accepted' || existing.status === 'pending') {
      return { accepted: true };
    }
    if (existing.status === 'nonce-digest-mismatch') {
      return { accepted: false, error: GROUP_SEND_NONCE_DIGEST_MISMATCH };
    }
    this.ledger.recordPending({
      clientNonce: nonce,
      inputDigest: digest,
      agentId: args.roomSessionId,
      echoEntryId: null,
      acceptedAtMs: Date.now(),
    });
    return { accepted: true };
  }

  markRoomSendAccepted(clientNonce: string | undefined): void {
    if (clientNonce?.trim()) this.ledger.markAccepted(clientNonce.trim());
  }

  async runRoomUserTurn(args: {
    roomSessionId: SessionId;
    userTurnId: string;
    lane?: 'user' | 'agent';
    signal?: AbortSignal;
    excludeMemberId?: AgentRoleId;
  }): Promise<void> {
    const meta = this.deps.getSessionMeta(args.roomSessionId);
    if (!meta || !isRoomSession(meta)) return;
    const nextEpoch = (meta.groupEpoch ?? 0) + 1;
    await this.deps.upsertDocMeta(args.roomSessionId, {
      groupEpoch: nextEpoch,
      processingUserMsgId: args.userTurnId,
      dmPreemptedGroupMemberIds: [],
    });
    this.lanes.interrupt(args.roomSessionId, 'superseded');
    await this.lanes.enqueue(args.roomSessionId, {
      id: `${args.roomSessionId}:${nextEpoch}`,
      lane: args.lane ?? 'user',
      source: args.lane === 'agent' ? 'agent' : 'group',
      epoch: nextEpoch,
      run: async (signal) => {
        const merged = args.signal
          ? abortAny(args.signal, signal)
          : signal;
        await this.deps.setRoomPresence(args.roomSessionId, true);
        try {
          await this.runGroupTurn({
            roomSessionId: args.roomSessionId,
            epoch: nextEpoch,
            signal: merged,
            excludeMemberId: args.excludeMemberId,
          });
        } finally {
          await this.deps.setRoomPresence(args.roomSessionId, false);
          await this.deps.upsertDocMeta(args.roomSessionId, {
            lastHandledUserMsgId: args.userTurnId,
            processingUserMsgId: undefined,
          });
        }
      },
    });
  }

  async runGroupTurn(args: {
    roomSessionId: SessionId;
    epoch: number;
    signal: AbortSignal;
    excludeMemberId?: AgentRoleId;
  }): Promise<void> {
    const meta = this.deps.getSessionMeta(args.roomSessionId);
    if (!meta || !isRoomSession(meta)) return;
    const memberIds = normalizeMemberRoleIds(meta.memberRoleIds).filter(
      (id) => id !== args.excludeMemberId
    );
    const roomDoc = await this.deps.openSessionDoc(args.roomSessionId);
    const liveHistory = this.readGroupMessages(await roomDoc.getHistory());
    const orchestrator = new GroupChatOrchestrator({
      resolveMembers: (ids) => this.deps.resolveMembers(ids),
      readHistory: () => liveHistory,
      isCurrent: () =>
        !args.signal.aborted && this.deps.getSessionMeta(args.roomSessionId)?.groupEpoch === args.epoch,
      runMemberTurn: async ({ member, systemPrompt, prompt }) =>
        this.runMemberTurn({
          room: meta,
          member,
          systemPrompt,
          prompt,
          epoch: args.epoch,
          signal: args.signal,
        }),
      postMemberMessage: async (member, content) => {
        // `lody_room_speak` already wrote the room bubble. Only refresh the
        // in-memory transcript so later members see it.
        liveHistory.push({
          speaker: { kind: 'member', id: member.id, name: member.name },
          content,
        });
      },
    });
    try {
      await orchestrator.run({
        group: { name: meta.title?.trim() || 'Group', description: '' },
        memberIds,
      });
    } catch (error) {
      if (args.signal.aborted) return;
      throw error;
    }
  }

  async roomSpeak(args: {
    homeSessionId: SessionId;
    type: 'text' | 'attachment' | 'widget' | 'secret-request';
    content?: string;
    replyTo?: string;
    images?: SessionImagePayload[];
    warningTone?: boolean;
    mark?: string;
    widget?: Extract<MessageContent, { type: 'room_speech' }>['widget'];
    secretRequest?: Extract<MessageContent, { type: 'room_speech' }>['secretRequest'];
  }): Promise<{ ok: true; pass: boolean } | { ok: false; error: string }> {
    const active = this.activeByHomeSession.get(args.homeSessionId);
    if (!active) {
      return {
        ok: false,
        error: `This turn is not a group-room turn, so ${LODY_ROOM_SPEAK_TOOL_NAME} has nowhere to post.`,
      };
    }
    if (active.awaitingUser) {
      return {
        ok: false,
        error:
          'This turn is already waiting on the user (you sent a question widget or secret request). Wait for their next message.',
      };
    }
    const room = this.deps.getSessionMeta(active.roomSessionId);
    if (!room || room.groupEpoch !== active.epoch) {
      return { ok: false, error: 'This group turn is no longer current.' };
    }
    const members = await this.deps.resolveMembers([active.memberRoleId]);
    const member = members[0];
    if (!member) return { ok: false, error: 'This group member is no longer available.' };

    const text = args.content ?? '';
    if (args.type === 'text' && isPassContent(text)) {
      active.spoken.push('(pass)');
      this.spokenThisTurn.set(this.memberTurnKey(active), [...active.spoken]);
      await this.deps.interruptSession(args.homeSessionId, 'room-pass');
      return { ok: true, pass: true };
    }
    if (active.speakCount >= GROUP_MAX_MESSAGES_PER_TURN) {
      return { ok: false, error: `At most ${GROUP_MAX_MESSAGES_PER_TURN} visible room messages per turn.` };
    }
    if (args.type === 'widget' || args.type === 'secret-request') {
      active.awaitingUser = true;
    }
    await this.appendRoomSpeech(active.roomSessionId, member, text, {
      replyTo: args.replyTo,
      images: args.images,
      warningTone: args.warningTone,
      mark: args.mark ?? member.name,
      widget: args.widget,
      secretRequest: args.secretRequest,
    });
    active.speakCount += 1;
    active.spoken.push(text);
    this.spokenThisTurn.set(this.memberTurnKey(active), [...active.spoken]);
    if (active.awaitingUser || active.speakCount >= GROUP_MAX_MESSAGES_PER_TURN) {
      await this.deps.interruptSession(args.homeSessionId, 'room-turn-complete');
    }
    return { ok: true, pass: false };
  }

  async sendToAgent(args: {
    fromSessionId: SessionId;
    fromRoleId?: AgentRoleId;
    fromRoleName: string;
    fromMark?: string;
    targetRoleId?: AgentRoleId;
    targetRoomId?: SessionId;
    targetSessionId?: SessionId;
    message: string;
    hasImages?: boolean;
    priority?: boolean;
  }): Promise<{ ok: true; ack: string } | { ok: false; error: string }> {
    if (args.message.length > GROUP_SEND_TO_AGENT_MAX_CHARS) {
      return { ok: false, error: `Message must be at most ${GROUP_SEND_TO_AGENT_MAX_CHARS} characters.` };
    }
    if (args.targetSessionId === args.fromSessionId || args.targetRoleId === args.fromRoleId) {
      return { ok: false, error: 'Cannot send to yourself.' };
    }
    const senderTurn = this.activeByHomeSession.get(args.fromSessionId);
    if (senderTurn?.sentToAgentThisTurn) {
      return { ok: false, error: 'Cannot send another cross-session message in the same turn.' };
    }

    if (args.targetRoomId) {
      const room = this.deps.getSessionMeta(args.targetRoomId);
      if (!room || !isRoomSession(room)) {
        return { ok: false, error: 'Target is not a group room.' };
      }
      const memberIds = normalizeMemberRoleIds(room.memberRoleIds);
      if (args.fromRoleId && !memberIds.includes(args.fromRoleId)) {
        return { ok: false, error: 'You are not a member of that room.' };
      }
      const imageNote = args.hasImages ? ' Images were not delivered to the room.' : '';
      const member: GroupMember = {
        id: (args.fromRoleId ?? ('unknown' as AgentRoleId)),
        name: args.fromRoleName,
        description: '',
      };
      await this.appendRoomSpeech(args.targetRoomId, member, args.message, {
        mark: args.fromMark,
      });
      await this.appendAgentMessage(args.fromSessionId, {
        type: 'agent_message',
        direction: 'outbound',
        speakerRoleId: args.fromRoleId,
        speakerName: args.fromRoleName,
        mark: args.fromMark,
        targetRoomId: args.targetRoomId,
        text: `Posted to ${room.title?.trim() || 'the group'}.`,
      });
      if (senderTurn) senderTurn.sentToAgentThisTurn = true;
      void this.runRoomUserTurn({
        roomSessionId: args.targetRoomId,
        userTurnId: randomUUID(),
        lane: 'agent',
        excludeMemberId: args.fromRoleId,
      }).catch(() => undefined);
      return {
        ok: true,
        ack: `Posted to ${room.title?.trim() || 'the group'}. Its members will see it and reply on their own turns.${imageNote}`,
      };
    }

    const targetMeta = args.targetSessionId
      ? this.deps.getSessionMeta(args.targetSessionId)
      : this.findHomeSessionForRole(args.targetRoleId);
    if (!targetMeta || isRoomSession(targetMeta)) {
      return { ok: false, error: 'Target session is not a one-to-one chat.' };
    }
    await this.appendAgentMessage(targetMeta.id, {
      type: 'agent_message',
      direction: 'inbound',
      speakerRoleId: args.fromRoleId,
      speakerName: args.fromRoleName,
      mark: args.fromMark,
      targetSessionId: args.fromSessionId,
      text: args.message,
    });
    const cue =
      `[LODY_HIDDEN_AGENT_CUE] Another assistant (${args.fromRoleName}) sent you this, not the user. ` +
      `Reply with lody_send_to_agent on a later turn; do not ping-pong in this turn.\n\n` +
      args.message;
    if (senderTurn) senderTurn.sentToAgentThisTurn = true;
    void this.lanes
      .enqueue(targetMeta.id, {
        id: `agent-inbound:${targetMeta.id}:${randomUUID()}`,
        lane: 'agent',
        source: 'agent',
        preemptNonUser: args.priority === true,
        run: async () => {
          await this.appendHiddenUserTurn(targetMeta.id, cue);
        },
      })
      .catch(() => undefined);
    return {
      ok: true,
      ack: `Sent to ${targetMeta.title?.trim() || args.targetRoleId || 'the agent'}. They will reply on their own turn.`,
    };
  }

  async noteDmPreempt(homeSessionId: SessionId): Promise<void> {
    const active = this.activeByHomeSession.get(homeSessionId);
    if (!active) return;
    const room = this.deps.getSessionMeta(active.roomSessionId);
    if (!room) return;
    const already = new Set(room.dmPreemptedGroupMemberIds ?? []);
    already.add(active.memberRoleId);
    await this.deps.upsertDocMeta(active.roomSessionId, {
      dmPreemptedGroupMemberIds: [...already],
    });
    await this.deps.interruptSession(homeSessionId, 'dmPreempted');
    if (active.speakCount === 0 && active.redriveCount < GROUP_MEMBER_REDRIVE_LIMIT) {
      active.redriveCount += 1;
      const members = await this.deps.resolveMembers([active.memberRoleId]);
      const member = members[0];
      if (!member) return;
      const prompt = buildGroupTurnPrompt({
        member,
        group: { name: room.title?.trim() || 'Group', description: '' },
        peers: [],
        newMessages: [],
        redrive: true,
      });
      await this.dispatchMember(room, member, prompt, 'Continue the room turn.', active.epoch);
    }
  }

  private async runMemberTurn(args: {
    room: SessionMeta;
    member: GroupMember;
    systemPrompt: string;
    prompt: string;
    epoch: number;
    signal: AbortSignal;
  }): Promise<readonly string[]> {
    const homeId = await this.ensureMappedHome(args.room, args.member);
    const key = `${args.room.id}:${args.epoch}:${args.member.id}`;
    this.spokenThisTurn.set(key, []);
    const active: ActiveMemberTurn = {
      roomSessionId: args.room.id,
      memberRoleId: args.member.id,
      epoch: args.epoch,
      spoken: [],
      speakCount: 0,
      awaitingUser: false,
      redriveCount: 0,
      sentToAgentThisTurn: false,
    };
    return this.lanes.enqueue(homeId, {
      id: key,
      lane: 'agent',
      source: 'group-member',
      epoch: args.epoch,
      run: async (laneSignal) => {
        const signal = abortAny(args.signal, laneSignal);
        this.activeByHomeSession.set(homeId, active);
        try {
          if (signal.aborted) return [];
          await this.deps.dispatchHomeTurn({
            homeSessionId: homeId,
            prompt: args.prompt,
            systemPrompt: args.systemPrompt,
            roomSessionId: args.room.id,
            roomTitle: args.room.title?.trim() || 'Group',
            signal,
          });
          return this.spokenThisTurn.get(key) ?? active.spoken;
        } catch {
          return [];
        } finally {
          this.activeByHomeSession.delete(homeId);
        }
      },
    });
  }

  private async dispatchMember(
    room: SessionMeta,
    member: GroupMember,
    prompt: string,
    systemPrompt: string,
    epoch: number
  ): Promise<void> {
    const homeId = await this.ensureMappedHome(room, member);
    await this.deps.dispatchHomeTurn({
      homeSessionId: homeId,
      prompt,
      systemPrompt,
      roomSessionId: room.id,
      roomTitle: room.title?.trim() || 'Group',
      signal: new AbortController().signal,
    });
    void epoch;
  }

  private async ensureMappedHome(room: SessionMeta, member: GroupMember): Promise<SessionId> {
    const existing = room.memberHomeSessionIds?.[member.id];
    const homeId = await this.deps.ensureHomeSession({
      roomSessionId: room.id,
      member,
      existingHomeId: existing,
    });
    if (existing !== homeId) {
      await this.deps.upsertDocMeta(room.id, {
        memberHomeSessionIds: { ...(room.memberHomeSessionIds ?? {}), [member.id]: homeId },
      });
    }
    return homeId;
  }

  private findHomeSessionForRole(roleId: AgentRoleId | undefined): SessionMeta | undefined {
    if (!roleId) return undefined;
    return this.deps
      .listSessionMetas()
      .find((meta) => !isRoomSession(meta) && !meta.parentSessionId && meta.agentRoleId === roleId);
  }

  private readGroupMessages(history: readonly SessionHistoryInput[]): GroupMessage[] {
    const messages: GroupMessage[] = [];
    for (const entry of history) {
      if (entry.role === 'user') {
        const text = collectText(entry.items);
        if (text) messages.push({ speaker: { kind: 'user' }, content: text });
        continue;
      }
      for (const item of entry.items ?? []) {
        if (item.type === 'room_speech') {
          messages.push({
            speaker: { kind: 'member', id: item.speakerRoleId, name: item.speakerName },
            content: item.text,
          });
        }
      }
    }
    return messages;
  }

  private async appendRoomSpeech(
    roomSessionId: SessionId,
    member: GroupMember,
    content: string,
    extras: {
      replyTo?: string;
      images?: SessionImagePayload[];
      warningTone?: boolean;
      mark?: string;
      widget?: Extract<MessageContent, { type: 'room_speech' }>['widget'];
      secretRequest?: Extract<MessageContent, { type: 'room_speech' }>['secretRequest'];
    } = {}
  ): Promise<void> {
    const doc = await this.deps.openSessionDoc(roomSessionId);
    const entry: SessionHistoryInput = {
      id: randomUUID(),
      role: 'system',
      timestamp: new Date(getServerNow()).toISOString(),
      items: [
        {
          type: 'room_speech',
          speakerRoleId: member.id,
          speakerName: member.name,
          text: content,
          ...(extras.mark ? { mark: extras.mark } : {}),
          ...(extras.replyTo ? { replyTo: extras.replyTo } : {}),
          ...(extras.images && extras.images.length > 0 ? { images: extras.images } : {}),
          ...(extras.warningTone ? { warningTone: true } : {}),
          ...(extras.widget ? { widget: extras.widget } : {}),
          ...(extras.secretRequest ? { secretRequest: extras.secretRequest } : {}),
        },
      ],
      fileDiff: [],
      finished: true,
    };
    await doc.updateHistory((history) => [...history, entry]);
    await this.deps.upsertDocMeta(roomSessionId, { lastMessageAt: getServerNow() });
  }

  private async appendAgentMessage(
    sessionId: SessionId,
    item: Extract<MessageContent, { type: 'agent_message' }>
  ): Promise<void> {
    const doc = await this.deps.openSessionDoc(sessionId);
    const entry: SessionHistoryInput = {
      id: randomUUID(),
      role: 'system',
      timestamp: new Date(getServerNow()).toISOString(),
      items: [item],
      fileDiff: [],
      finished: true,
    };
    await doc.updateHistory((history) => [...history, entry]);
  }

  private async appendHiddenUserTurn(sessionId: SessionId, prompt: string): Promise<void> {
    const meta = this.deps.getSessionMeta(sessionId);
    if (!meta) return;
    const doc = await this.deps.openSessionDoc(sessionId);
    const id = randomUUID();
    const entry: SessionHistoryInput = {
      id,
      role: 'user',
      timestamp: new Date(getServerNow()).toISOString(),
      status: 'pending',
      items: [],
      inputConfig: {
        prompt,
        cliType: meta.cliType,
        agentType: meta.agentType,
      },
      fileDiff: [],
      finished: true,
    };
    await doc.updateHistory((history) => [...history, entry]);
    await this.deps.upsertDocMeta(sessionId, {
      latestUserMsgId: id,
      lastMissingHistoryUserMsgId: undefined,
    });
  }

  private memberTurnKey(active: ActiveMemberTurn): string {
    return `${active.roomSessionId}:${active.epoch}:${active.memberRoleId}`;
  }
}

function collectText(items: SessionHistoryInput['items'] | undefined): string {
  if (!items) return '';
  return items
    .map((item) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'room_speech') return item.text;
      if (item.type === 'agent_message') return item.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function abortAny(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

export function createGroupChatServiceFromManager(args: {
  manager: LoroDocumentManager;
  resolveMembers: GroupChatServiceDeps['resolveMembers'];
  ensureHomeSession: GroupChatServiceDeps['ensureHomeSession'];
  dispatchHomeTurn: GroupChatServiceDeps['dispatchHomeTurn'];
  interruptSession: GroupChatServiceDeps['interruptSession'];
  setRoomPresence?: GroupChatServiceDeps['setRoomPresence'];
}): GroupChatService & { rememberMeta(meta: SessionMeta): void } {
  const metas = new Map<SessionId, SessionMeta>();
  const service = new GroupChatService({
    getSessionMeta: (sessionId) => metas.get(sessionId),
    listSessionMetas: () => [...metas.values()],
    openSessionDoc: (sessionId) => args.manager.getOrCreateSessionDoc(sessionId),
    upsertDocMeta: async (sessionId, patch) => {
      const current = metas.get(sessionId);
      if (current) metas.set(sessionId, { ...current, ...patch, id: sessionId });
      await args.manager.repo.upsertDocMeta(getSessionRoomId(sessionId), patch);
    },
    resolveMembers: args.resolveMembers,
    ensureHomeSession: args.ensureHomeSession,
    dispatchHomeTurn: args.dispatchHomeTurn,
    interruptSession: args.interruptSession,
    setRoomPresence: args.setRoomPresence ?? (() => undefined),
  });
  return Object.assign(service, {
    rememberMeta(meta: SessionMeta) {
      metas.set(meta.id, meta);
    },
  });
}
