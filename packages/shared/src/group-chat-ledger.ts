import { GROUP_SEND_ACCEPTANCE_LEDGER_LIMIT } from './group-chat';
import { sha256Hex } from './incremental-sha256';

export type GroupSendDigestInput = {
  agentId: string;
  prompt: string;
  richText?: string | null;
  replyToId?: string | null;
  isFork?: boolean;
  attachmentPaths?: readonly string[] | null;
  attachmentNames?: readonly string[] | null;
};

export type GroupSendAcceptanceRecord = {
  clientNonce: string;
  inputDigest: string;
  agentId: string;
  echoEntryId: string | null;
  acceptedAtMs: number;
};

export type GroupSendAcceptanceLookup =
  | { status: 'unknown' }
  | { status: 'pending'; record: GroupSendAcceptanceRecord }
  | { status: 'accepted'; record: GroupSendAcceptanceRecord }
  | { status: 'nonce-digest-mismatch'; record: GroupSendAcceptanceRecord };

export const GROUP_SEND_NONCE_DIGEST_MISMATCH = 'send/nonce-digest-mismatch';

export function groupSendInputDigest(input: GroupSendDigestInput): string {
  const payload = [
    input.agentId,
    input.prompt,
    input.richText ?? null,
    input.replyToId ?? null,
    input.isFork === true,
    input.attachmentPaths ?? [],
    input.attachmentNames ?? [],
  ];
  return sha256Hex(new TextEncoder().encode(JSON.stringify(payload)));
}

export class GroupSendAcceptanceLedger {
  private readonly accepted = new Map<string, GroupSendAcceptanceRecord>();
  private readonly pending = new Map<string, GroupSendAcceptanceRecord>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  lookup(clientNonce: string, digest: string): GroupSendAcceptanceLookup {
    const accepted = this.accepted.get(clientNonce);
    if (accepted) {
      return accepted.inputDigest === digest
        ? { status: 'accepted', record: accepted }
        : { status: 'nonce-digest-mismatch', record: accepted };
    }
    const pending = this.pending.get(clientNonce);
    if (pending) {
      return pending.inputDigest === digest
        ? { status: 'pending', record: pending }
        : { status: 'nonce-digest-mismatch', record: pending };
    }
    return { status: 'unknown' };
  }

  getInFlight(clientNonce: string): Promise<unknown> | undefined {
    return this.inFlight.get(clientNonce);
  }

  setInFlight(clientNonce: string, work: Promise<unknown>): void {
    this.inFlight.set(clientNonce, work);
    void work.finally(() => {
      if (this.inFlight.get(clientNonce) === work) {
        this.inFlight.delete(clientNonce);
      }
    });
  }

  recordPending(record: GroupSendAcceptanceRecord): void {
    this.pending.set(record.clientNonce, record);
  }

  markAccepted(clientNonce: string): void {
    const pending = this.pending.get(clientNonce);
    if (!pending) return;
    this.pending.delete(clientNonce);
    this.accepted.set(clientNonce, { ...pending, acceptedAtMs: Date.now() });
    this.prune();
  }

  toJSON(): GroupSendAcceptanceRecord[] {
    return [...this.accepted.values()]
      .sort((a, b) => b.acceptedAtMs - a.acceptedAtMs)
      .slice(0, GROUP_SEND_ACCEPTANCE_LEDGER_LIMIT);
  }

  loadAccepted(records: readonly GroupSendAcceptanceRecord[]): void {
    this.accepted.clear();
    for (const record of records.slice(0, GROUP_SEND_ACCEPTANCE_LEDGER_LIMIT)) {
      this.accepted.set(record.clientNonce, record);
    }
  }

  private prune(): void {
    if (this.accepted.size <= GROUP_SEND_ACCEPTANCE_LEDGER_LIMIT) return;
    const ordered = [...this.accepted.values()].sort((a, b) => a.acceptedAtMs - b.acceptedAtMs);
    const overflow = this.accepted.size - GROUP_SEND_ACCEPTANCE_LEDGER_LIMIT;
    for (const record of ordered.slice(0, overflow)) {
      this.accepted.delete(record.clientNonce);
    }
  }
}
