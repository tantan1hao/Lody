import {
  getLocalProjectHistoryProviderKey,
  isCustomAcpMissingLaunchCommandError,
  REGISTRY_ACP_AGENTS,
  type LocalProjectHistoryProvider,
  type SessionMeta,
} from '@lody/shared';

export type RefreshableExternalHistory = NonNullable<SessionMeta['externalHistory']> & {
  provider: LocalProjectHistoryProvider;
};

export function shouldRefreshExternalHistoryOnOpen(
  externalHistory: SessionMeta['externalHistory'] | undefined
): externalHistory is RefreshableExternalHistory {
  if (!externalHistory) return false;
  return externalHistory.status !== 'sync_conflict';
}

export function getExternalHistoryProviderLabel(provider: LocalProjectHistoryProvider): string {
  if (provider.cliType === 'builtin') {
    if (provider.agentType === 'claude') return 'Claude';
    if (provider.agentType === 'codex') return 'Codex';
  }
  return (
    REGISTRY_ACP_AGENTS.find((agent) => agent.id === provider.agentType)?.name ?? provider.agentType
  );
}

export function getExternalHistoryRefreshKey(
  sessionId: string,
  externalHistory: RefreshableExternalHistory
): string {
  const providerKey = getLocalProjectHistoryProviderKey(externalHistory.provider);
  return `${sessionId}:${providerKey}:${externalHistory.sourceAcpSessionId}`;
}

/**
 * Opening an imported session already has the local transcript. A custom ACP
 * with no launch command cannot refresh from the other agent; do not present
 * that as "failed to load the conversation".
 */
export function isBenignExternalHistoryRefreshError(error: unknown): boolean {
  return isCustomAcpMissingLaunchCommandError(error);
}
