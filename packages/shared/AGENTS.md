# packages/shared

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

- Group rooms are `SessionMeta.sessionKind === 'room'` with `memberRoleIds`.
  They are not a Workspace Flock catalog family.
- Visible room speech is `MessageContent` kind `room_speech`. Agent-to-agent
  visible posts use `agent_message`. Do not add a fourth history `Role`.
- Caps live in `group-chat.ts` and must not change: 3 rounds, 10 member
  messages, 2 per member turn, 6 members.
- `sessionGroupChat` protocol version is advertised and checked from
  `machine-protocol-capabilities.ts` only.
