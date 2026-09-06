import { describe, expect, it } from 'vitest';

import {
  GROUP_MAX_MEMBERS,
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_MESSAGES_PER_TURN,
  GROUP_MAX_ROUNDS,
  GROUP_PROMPT_HISTORY_LIMIT,
  GROUP_SEND_NONCE_DIGEST_MISMATCH,
  GroupSendAcceptanceLedger,
  assertMembersAreNotRooms,
  findRoomByMemberSet,
  groupSendInputDigest,
  isPassContent,
  isRoomSession,
  isSameMemberSet,
  normalizeMemberRoleIds,
  orderRoundSpeakers,
  parseGroupMentions,
  resolveResponders,
  type GroupMember,
  type GroupMessage,
} from '../src';

const members: GroupMember[] = [
  { id: 'role-alice' as GroupMember['id'], name: 'Alice', description: '' },
  { id: 'role-bob' as GroupMember['id'], name: 'Bob Smith', description: '' },
  { id: 'role-cara' as GroupMember['id'], name: 'Cara', description: '' },
];

describe('group chat contract', () => {
  it('keeps product caps unchanged', () => {
    expect(GROUP_MAX_ROUNDS).toBe(3);
    expect(GROUP_MAX_MEMBER_TURNS).toBe(10);
    expect(GROUP_MAX_MESSAGES_PER_TURN).toBe(2);
    expect(GROUP_PROMPT_HISTORY_LIMIT).toBe(24);
    expect(GROUP_MAX_MEMBERS).toBe(6);
  });

  it('treats missing sessionKind as a direct session', () => {
    expect(isRoomSession(undefined)).toBe(false);
    expect(isRoomSession({})).toBe(false);
    expect(isRoomSession({ sessionKind: 'direct' })).toBe(false);
    expect(isRoomSession({ sessionKind: 'room' })).toBe(true);
  });

  it('dedupes and caps member Role ids', () => {
    expect(
      normalizeMemberRoleIds(['a', 'a', '', 'b', 'c', 'd', 'e', 'f', 'g', 1])
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('treats the same Role set as one room regardless of order', () => {
    expect(isSameMemberSet(['b', 'a'], ['a', 'b'])).toBe(true);
    expect(
      findRoomByMemberSet([{ memberRoleIds: ['b', 'a'] }], ['a', 'b'])
    ).toEqual({ memberRoleIds: ['b', 'a'] });
  });

  it('rejects nested rooms', () => {
    expect(() => assertMembersAreNotRooms(['role-a', 'room-1'], (id) => id === 'room-1')).toThrow(
      /individual Agent Roles/
    );
  });

  it('rotates the speaking order each round', () => {
    expect(orderRoundSpeakers(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c']);
    expect(orderRoundSpeakers(['a', 'b', 'c'], 1)).toEqual(['b', 'c', 'a']);
    expect(orderRoundSpeakers(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b']);
  });

  it('parses @everyone and member-name mentions', () => {
    expect(parseGroupMentions('hello @everyone', members).isEveryone).toBe(true);
    expect(parseGroupMentions('hey @all', members).isEveryone).toBe(true);
    expect(parseGroupMentions('ping @Alice and @BobSmith', members).memberIds).toEqual([
      'role-alice',
      'role-bob',
    ]);
    expect(parseGroupMentions('only @Bob', members).memberIds).toEqual(['role-bob']);
  });

  it('wakes everyone when nobody is mentioned after the latest user message', () => {
    const history: GroupMessage[] = [
      { speaker: { kind: 'user' }, content: 'hello' },
      { speaker: { kind: 'member', id: members[0]!.id, name: 'Alice' }, content: 'hi' },
    ];
    expect(resolveResponders(members, history).map((member) => member.id)).toEqual([
      'role-alice',
      'role-bob',
      'role-cara',
    ]);
  });

  it('wakes only mentioned members after the latest user message', () => {
    const history: GroupMessage[] = [
      { speaker: { kind: 'user' }, content: '@Alice take this' },
      { speaker: { kind: 'member', id: members[1]!.id, name: 'Bob Smith' }, content: 'not me' },
    ];
    expect(resolveResponders(members, history).map((member) => member.id)).toEqual(['role-alice']);
  });

  it('treats pass variants as silent', () => {
    expect(isPassContent('(pass)')).toBe(true);
    expect(isPassContent('PASS')).toBe(true);
    expect(isPassContent('pass.')).toBe(true);
    expect(isPassContent('  (Pass)  ')).toBe(true);
    expect(isPassContent('I will pass later')).toBe(false);
  });

  it('accepts the same nonce+digest and rejects a digest mismatch', () => {
    const ledger = new GroupSendAcceptanceLedger();
    const digest = groupSendInputDigest({
      agentId: 'room-1',
      prompt: 'hello',
    });
    ledger.recordPending({
      clientNonce: 'nonce-1',
      inputDigest: digest,
      agentId: 'room-1',
      echoEntryId: 't0u',
      acceptedAtMs: 1,
    });
    ledger.markAccepted('nonce-1');
    expect(ledger.lookup('nonce-1', digest).status).toBe('accepted');
    expect(
      ledger.lookup(
        'nonce-1',
        groupSendInputDigest({ agentId: 'room-1', prompt: 'other' })
      ).status
    ).toBe('nonce-digest-mismatch');
    expect(GROUP_SEND_NONCE_DIGEST_MISMATCH).toBe('send/nonce-digest-mismatch');
  });
});
