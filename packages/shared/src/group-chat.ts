import type { AgentRoleId, SessionId } from './ids';
import type { SessionImagePayload } from './ai';

export const GROUP_CONFIG_VERSION = 1;
export const GROUP_MAX_MEMBERS = 6;
export const GROUP_MAX_MEMBER_TURNS = 10;
export const GROUP_MAX_ROUNDS = 3;
export const GROUP_PROMPT_HISTORY_LIMIT = 24;
export const GROUP_MAX_MESSAGES_PER_TURN = 2;
export const GROUP_MEMBER_REDRIVE_LIMIT = 3;
export const GROUP_SEND_TO_AGENT_MAX_CHARS = 8000;
export const GROUP_CHAT_TAG_PREFIX = '[Group chat: ';
export const GROUP_HIDDEN_PROMPT_MARKER = '[LODY_HIDDEN_GROUP_PROMPT]';
export const GROUP_SEND_ACCEPTANCE_LEDGER_LIMIT = 256;

export const LODY_ROOM_SPEAK_TOOL_NAME = 'lody_room_speak';
export const LODY_SEND_TO_AGENT_TOOL_NAME = 'lody_send_to_agent';

export type SessionKind = 'direct' | 'room';

export type GroupMember = {
  id: AgentRoleId;
  name: string;
  description: string;
};

export type GroupDescription = {
  name: string;
  description: string;
};

export type GroupMessage = {
  speaker:
    | { kind: 'user'; name?: string }
    | { kind: 'member'; id: AgentRoleId; name: string };
  content: string;
};

export type RoomWidgetPayload = {
  prompt: string;
  options: { label: string; value?: string; description?: string }[];
  allowCustom?: boolean;
  dismissOnMoveOn?: boolean;
  selectedValue?: string;
};

export type RoomSecretRequestPayload = {
  label: string;
  connector: string;
  field: string;
};

export type RoomSpeechContent = {
  type: 'room_speech';
  speakerRoleId: AgentRoleId;
  speakerName: string;
  mark?: string;
  text: string;
  images?: SessionImagePayload[];
  replyTo?: string;
  warningTone?: boolean;
  widget?: RoomWidgetPayload;
  secretRequest?: RoomSecretRequestPayload;
};

export type AgentMessageContent = {
  type: 'agent_message';
  direction: 'inbound' | 'outbound';
  speakerRoleId?: AgentRoleId;
  speakerName: string;
  mark?: string;
  targetRoomId?: SessionId;
  targetSessionId?: SessionId;
  text: string;
};

export type GroupTurnWakeMeta = {
  roomSessionId: SessionId;
  roomTitle: string;
};

export type GroupRunLane = 'user' | 'agent' | 'background';
export type GroupRunSource = 'group' | 'group-member' | 'agent' | 'turn';

export function isRoomSession(
  meta: { sessionKind?: string | undefined } | null | undefined
): boolean {
  return meta?.sessionKind === 'room';
}

export function normalizeMemberRoleIds(raw: unknown): AgentRoleId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const ids: AgentRoleId[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id as AgentRoleId);
    if (ids.length >= GROUP_MAX_MEMBERS) break;
  }
  return ids;
}

export function memberRoleSetKey(ids: readonly string[]): string {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort().join('\0');
}

export function isSameMemberSet(a: readonly string[], b: readonly string[]): boolean {
  return memberRoleSetKey(a) === memberRoleSetKey(b);
}

export function findRoomByMemberSet<T extends { memberRoleIds?: readonly string[] }>(
  rooms: readonly T[],
  memberRoleIds: readonly string[]
): T | undefined {
  const key = memberRoleSetKey(memberRoleIds);
  return rooms.find((room) => memberRoleSetKey(room.memberRoleIds ?? []) === key);
}

export class GroupNestingError extends Error {
  readonly nestedIds: string[];
  constructor(ids: readonly string[]) {
    super(
      `A group chat can only contain individual Agent Roles, not other group chats. Remove the nested group${ids.length === 1 ? '' : 's'} from the member list.`
    );
    this.name = 'GroupNestingError';
    this.nestedIds = [...ids];
  }
}

export function assertMembersAreNotRooms(
  ids: readonly string[],
  isRoomId: (id: string) => boolean
): void {
  const nested = [...new Set(ids)].filter(isRoomId);
  if (nested.length > 0) throw new GroupNestingError(nested);
}

export function orderRoundSpeakers<T>(memberIds: readonly T[], round: number): T[] {
  if (memberIds.length === 0) return [];
  const offset = ((round % memberIds.length) + memberIds.length) % memberIds.length;
  return [...memberIds.slice(offset), ...memberIds.slice(0, offset)];
}

export function memberMentionHandles(name: string): string[] {
  const lower = name.trim().toLowerCase();
  if (!lower) return [];
  const handles = new Set([lower, lower.replace(/\s+/g, '')]);
  const first = lower.split(/\s+/)[0];
  if (first) handles.add(first);
  return [...handles];
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[a-z0-9]/.test(char);
}

function hasMentionAt(lower: string, handle: string): boolean {
  const needle = `@${handle}`;
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + 1)) {
    if (!isWordChar(lower[index - 1]) && !isWordChar(lower[index + needle.length])) {
      return true;
    }
  }
  return false;
}

export function parseGroupMentions(
  text: string,
  members: readonly Pick<GroupMember, 'id' | 'name'>[]
): { isEveryone: boolean; memberIds: AgentRoleId[] } {
  const lower = text.toLowerCase();
  const memberIds: AgentRoleId[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    if (
      !seen.has(member.id) &&
      memberMentionHandles(member.name).some((handle) => hasMentionAt(lower, handle))
    ) {
      memberIds.push(member.id);
      seen.add(member.id);
    }
  }
  return {
    isEveryone: /(?:^|[^a-z0-9])@(everyone|all)\b/.test(lower),
    memberIds,
  };
}

export function resolveResponders<T extends Pick<GroupMember, 'id' | 'name'>>(
  members: readonly T[],
  history: readonly GroupMessage[]
): T[] {
  let start = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.speaker.kind === 'user') {
      start = index;
      break;
    }
  }
  let everyone = false;
  const mentioned = new Set<string>();
  for (const message of history.slice(start)) {
    const targets = parseGroupMentions(message.content, members);
    everyone ||= targets.isEveryone;
    for (const id of targets.memberIds) mentioned.add(id);
  }
  return everyone || mentioned.size === 0
    ? [...members]
    : members.filter((member) => mentioned.has(member.id));
}

export function isPassContent(content: string): boolean {
  const trimmed = content.trim();
  return !trimmed || /^\(?\s*pass\s*\)?\.?$/i.test(trimmed);
}

export function buildGroupRedriveNote(): string {
  return (
    '\n(Redelivery: your previous attempt at this turn was interrupted by a direct message to you. ' +
    'The room has NOT seen any reply from you for the messages above — anything you said or did while ' +
    'handling that direct message stayed in that private chat. If you already did the work, send the ' +
    `result to this room with ${LODY_ROOM_SPEAK_TOOL_NAME} now; otherwise take the turn normally.)`
  );
}

export function formatGroupLine(message: GroupMessage, viewerId: string): string {
  if (message.speaker.kind === 'user') {
    return message.speaker.name
      ? `${message.speaker.name} (user): ${message.content}`
      : `User: ${message.content}`;
  }
  return `${message.speaker.name}${message.speaker.id === viewerId ? ' (you)' : ''}: ${message.content}`;
}

export function formatGroupHistory(
  history: readonly GroupMessage[],
  viewerId: string,
  limit = GROUP_PROMPT_HISTORY_LIMIT
): string {
  const recent = history.slice(-limit);
  return recent.length === 0
    ? '(no messages yet)'
    : recent.map((message) => formatGroupLine(message, viewerId)).join('\n');
}

export function isGroupTurnPromptText(text: string): boolean {
  const body = text.startsWith(GROUP_HIDDEN_PROMPT_MARKER)
    ? text.slice(GROUP_HIDDEN_PROMPT_MARKER.length)
    : text;
  return body.startsWith(GROUP_CHAT_TAG_PREFIX);
}

export function groupDisplayName(group: GroupDescription): string {
  return group.name.trim() || 'the group';
}

export function describeGroup(group: GroupDescription): string {
  const name = groupDisplayName(group);
  const description = group.description.trim();
  return description ? `"${name}" — ${description}` : `"${name}"`;
}

export function formatGroupChatTag(
  group: GroupDescription,
  peers: readonly Pick<GroupMember, 'name'>[]
): string {
  return `${GROUP_CHAT_TAG_PREFIX}"${groupDisplayName(group)}"${
    peers.length > 0 ? ` - with ${peers.map((peer) => peer.name).join(', ')}` : ''
  }]`;
}

export function buildGroupMemberSystemPrompt(
  member: GroupMember,
  group: GroupDescription,
  peers: readonly GroupMember[]
): string {
  const lines = [
    `You are ${member.name}, one participant in a group chat (${describeGroup(group)}).`,
  ];
  if (member.description.trim()) {
    lines.push(`Your persona: ${member.description.trim()}`);
  }
  if (peers.length > 0) {
    lines.push(
      '',
      'Other participants in the room:',
      ...peers.map(
        (peer) => `- ${peer.name}${peer.description.trim() ? ` (${peer.description.trim()})` : ''}`
      )
    );
  }
  lines.push(
    '',
    peers.length > 0
      ? `Right now you are speaking in this group chat, with ${peers.map((peer) => peer.name).join(', ')}.`
      : 'Right now you are speaking in this group chat.',
    'You have your full toolkit in this room. Do the work first, then deliver the result with ' +
      `${LODY_ROOM_SPEAK_TOOL_NAME}.`,
    '',
    `Stay fully in character as ${member.name}. The ONLY way to say something the room can see is the ${LODY_ROOM_SPEAK_TOOL_NAME} tool. ` +
      'Keep each message short and conversational. If you have nothing new worth adding, send exactly "(pass)". ' +
      'Never reveal private one-on-one context. Do not use markdown image syntax.'
  );
  return lines.join('\n');
}

export function messagesSinceMemberLastSpoke(
  history: readonly GroupMessage[],
  memberId: string
): readonly GroupMessage[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const speaker = history[index]?.speaker;
    if (speaker?.kind === 'member' && speaker.id === memberId) {
      return history.slice(index + 1);
    }
  }
  return history;
}

export function buildGroupTurnPrompt(args: {
  member: GroupMember;
  group: GroupDescription;
  peers: readonly GroupMember[];
  newMessages: readonly GroupMessage[];
  redrive?: boolean;
}): string {
  const lines = [
    formatGroupChatTag(args.group, args.peers),
    args.newMessages.length === 0
      ? 'No new messages in the room since your last turn.'
      : `New messages in the room (oldest first):\n${formatGroupHistory(args.newMessages, args.member.id)}`,
    '',
    `It's your turn, ${args.member.name}. Reply in character with a single ${LODY_ROOM_SPEAK_TOOL_NAME} if you have something worth adding, or send "(pass)" if you don't.`,
  ];
  if (args.redrive) {
    lines.push(buildGroupRedriveNote());
  }
  return `${GROUP_HIDDEN_PROMPT_MARKER}${lines.join('\n')}`;
}

export function compareGroupRunLane(a: GroupRunLane, b: GroupRunLane): number {
  const rank: Record<GroupRunLane, number> = { user: 0, agent: 1, background: 2 };
  return rank[a] - rank[b];
}
