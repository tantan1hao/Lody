import {
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_ROUNDS,
  GROUP_PROMPT_HISTORY_LIMIT,
  buildGroupMemberSystemPrompt,
  buildGroupTurnPrompt,
  isPassContent,
  messagesSinceMemberLastSpoke,
  orderRoundSpeakers,
  resolveResponders,
  type GroupDescription,
  type GroupMember,
  type GroupMessage,
} from '@lody/shared';

export interface GroupOrchestratorDeps {
  resolveMembers(ids: readonly string[]): Promise<GroupMember[]>;
  readHistory(): readonly GroupMessage[];
  isCurrent(): boolean;
  runMemberTurn(args: {
    member: GroupMember;
    systemPrompt: string;
    prompt: string;
  }): Promise<readonly string[]>;
  postMemberMessage(member: GroupMember, content: string): Promise<void> | void;
  finalizeMemberTurn?(member: GroupMember): Promise<void> | void;
}

export class GroupChatOrchestrator {
  constructor(readonly deps: GroupOrchestratorDeps) {}

  async run(args: {
    group: GroupDescription;
    memberIds: readonly string[];
  }): Promise<void> {
    const members = await this.deps.resolveMembers(args.memberIds);
    if (members.length === 0) return;

    const memberById = new Map(members.map((member) => [member.id, member]));
    let totalMessages = 0;

    for (let round = 0; round < GROUP_MAX_ROUNDS; round += 1) {
      if (!this.deps.isCurrent()) return;
      const responderIds = resolveResponders(members, this.deps.readHistory()).map(
        (member) => member.id
      );
      let messagesThisRound = 0;

      for (const memberId of orderRoundSpeakers(responderIds, round)) {
        if (totalMessages >= GROUP_MAX_MEMBER_TURNS || !this.deps.isCurrent()) return;
        const member = memberById.get(memberId);
        if (member == null) continue;

        const sent = await this.runOneTurn(args.group, member, members);
        let hitCap = false;
        for (const content of sent) {
          await this.deps.postMemberMessage(member, content);
          totalMessages += 1;
          messagesThisRound += 1;
          if (totalMessages >= GROUP_MAX_MEMBER_TURNS) {
            hitCap = true;
            break;
          }
        }
        await this.deps.finalizeMemberTurn?.(member);
        if (hitCap) return;
      }

      if (messagesThisRound === 0) return;
    }
  }

  async runOneTurn(
    group: GroupDescription,
    member: GroupMember,
    members: readonly GroupMember[]
  ): Promise<string[]> {
    const peers = members.filter((other) => other.id !== member.id);
    const history = this.deps.readHistory();
    const newMessages = messagesSinceMemberLastSpoke(history, member.id).slice(
      -GROUP_PROMPT_HISTORY_LIMIT
    );
    let sent: readonly string[] = [];
    try {
      sent = await this.deps.runMemberTurn({
        member,
        systemPrompt: buildGroupMemberSystemPrompt(member, group, peers),
        prompt: buildGroupTurnPrompt({ member, group, peers, newMessages }),
      });
    } catch {
      return [];
    }

    const spoken: string[] = [];
    for (const content of sent) {
      if (isPassContent(content)) continue;
      const trimmed = content.trim();
      if (trimmed.length === 0) continue;
      spoken.push(trimmed);
      if (spoken.length >= GROUP_MAX_MESSAGES_PER_TURN) break;
    }
    return spoken;
  }
}
