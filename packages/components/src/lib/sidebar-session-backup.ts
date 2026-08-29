export type SidebarSessionBackupInput = {
  id: string;
  title: string;
  machineId?: string | null;
  projectName?: string | null;
  repoFullName?: string | null;
  branchName?: string | null;
  agentType?: string | null;
  cliType?: string | null;
  status?: string | null;
  createdAt?: string | null;
};

export type SidebarSessionBackupPayload = {
  version: 1;
  kind: 'lody-oss-session-backup';
  exportedAt: string;
  session: SidebarSessionBackupInput;
};

export function buildSidebarSessionBackup(
  session: SidebarSessionBackupInput,
  exportedAt: string
): SidebarSessionBackupPayload {
  return {
    version: 1,
    kind: 'lody-oss-session-backup',
    exportedAt,
    session,
  };
}

export function sidebarSessionBackupFilename(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
  return `lody-session-${safe || 'backup'}.json`;
}

export function downloadSidebarSessionBackup(payload: SidebarSessionBackupPayload): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sidebarSessionBackupFilename(payload.session.id);
  link.click();
  URL.revokeObjectURL(url);
}
