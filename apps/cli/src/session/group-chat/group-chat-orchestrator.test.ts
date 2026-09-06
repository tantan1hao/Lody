import { describe, expect, it } from 'vitest';

import type { GroupMember, GroupMessage } from '@lody/shared';
import { GroupChatOrchestrator } from './group-chat-orchestrator';

const members: GroupMember[] = [
  { id: 'role-a' as GroupMember['id'], name: 'Alice', description: '' },
  { id: 'role-b' as GroupMember['id'], name: 'Bob', description: '' },
];

describe('GroupChatOrchestrator', () => {
  it('posts spoken messages and stops after a silent round', async () => {
    const history: GroupMessage[] = [{ speaker: { kind: 'user' }, content: 'hello' }];
    const posted: string[] = [];
    let current = true;
    const orchestrator = new GroupChatOrchestrator({
      resolveMembers: async (ids) => members.filter((member) => ids.includes(member.id)),
      readHistory: () => history,
      isCurrent: () => current,
      runMemberTurn: async ({ member }) => {
        if (member.name !== 'Alice') return ['(pass)'];
        if (history.some((message) => message.speaker.kind === 'member')) return ['(pass)'];
        return ['I will look'];
      },
      postMemberMessage: (member, content) => {
        posted.push(`${member.name}:${content}`);
        history.push({
          speaker: { kind: 'member', id: member.id, name: member.name },
          content,
        });
      },
    });

    await orchestrator.run({
      group: { name: 'Room', description: '' },
      memberIds: members.map((member) => member.id),
    });

    expect(posted).toEqual(['Alice:I will look']);
  });

  it('wakes only the mentioned member', async () => {
    const history: GroupMessage[] = [{ speaker: { kind: 'user' }, content: '@Alice only' }];
    const called: string[] = [];
    const orchestrator = new GroupChatOrchestrator({
      resolveMembers: async (ids) => members.filter((member) => ids.includes(member.id)),
      readHistory: () => history,
      isCurrent: () => true,
      runMemberTurn: async ({ member }) => {
        called.push(member.name);
        return ['(pass)'];
      },
      postMemberMessage: () => undefined,
    });

    await orchestrator.run({
      group: { name: 'Room', description: '' },
      memberIds: members.map((member) => member.id),
    });

    expect(called).toEqual(['Alice']);
  });

  it('stops after ten member messages across rounds', async () => {
    const history: GroupMessage[] = [{ speaker: { kind: 'user' }, content: 'keep going' }];
    const posted: string[] = [];
    const crowd: GroupMember[] = Array.from({ length: 6 }, (_, index) => ({
      id: `role-${index}` as GroupMember['id'],
      name: `M${index}`,
      description: '',
    }));
    const orchestrator = new GroupChatOrchestrator({
      resolveMembers: async (ids) => crowd.filter((member) => ids.includes(member.id)),
      readHistory: () => history,
      isCurrent: () => true,
      runMemberTurn: async ({ member }) => [`${member.name} ${posted.length}`],
      postMemberMessage: (member, content) => {
        posted.push(content);
        history.push({
          speaker: { kind: 'member', id: member.id, name: member.name },
          content,
        });
      },
    });

    await orchestrator.run({
      group: { name: 'Room', description: '' },
      memberIds: crowd.map((member) => member.id),
    });

    expect(posted).toHaveLength(10);
  });

  it('treats a member failure as a pass', async () => {
    const history: GroupMessage[] = [{ speaker: { kind: 'user' }, content: 'hello' }];
    const orchestrator = new GroupChatOrchestrator({
      resolveMembers: async (ids) => members.filter((member) => ids.includes(member.id)),
      readHistory: () => history,
      isCurrent: () => true,
      runMemberTurn: async () => {
        throw new Error('model down');
      },
      postMemberMessage: () => {
        throw new Error('should not post');
      },
    });

    await expect(
      orchestrator.run({
        group: { name: 'Room', description: '' },
        memberIds: members.map((member) => member.id),
      })
    ).resolves.toBeUndefined();
  });
});
