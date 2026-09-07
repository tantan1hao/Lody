import {
  getLocalProjectHistoryProviderKey,
  hasCustomAcpLaunchCommand,
  type AgentConfigMeta,
  type LocalProjectHistoryCatalogResult,
  type LocalProjectHistoryProvider,
  type LocalProjectHistoryProviderKey,
  type LocalProjectId,
  type MachineId,
} from '@lody/shared';

export const AUTO_EXTERNAL_AGENT_HISTORY_IMPORT_LIMIT = 5;
export const AUTO_EXTERNAL_AGENT_HISTORY_TARGETS_PER_WAKE = 2;
export const AUTO_EXTERNAL_AGENT_HISTORY_COOLDOWN_MS = 15 * 60 * 1000;
export const AUTO_EXTERNAL_AGENT_HISTORY_START_DELAY_MS = 8_000;
export const AUTO_EXTERNAL_AGENT_HISTORY_POLL_MS = 15 * 60 * 1000;

export type AutoExternalAgentHistoryTarget = {
  targetKey: string;
  projectKey: string;
  machineId: MachineId;
  localProjectId: LocalProjectId;
  provider: LocalProjectHistoryProvider;
};

export function autoExternalAgentHistoryTargetKey(
  workspaceId: string,
  projectKey: string,
  provider: LocalProjectHistoryProvider
): string {
  return `${workspaceId}:${getLocalProjectHistoryProviderKey(provider)}:${projectKey}`;
}

export function collectHistoryProvidersForMachine(
  configs: readonly AgentConfigMeta[],
  machineId: MachineId
): LocalProjectHistoryProvider[] {
  const byKey = new Map<LocalProjectHistoryProviderKey, LocalProjectHistoryProvider>();
  for (const config of configs) {
    if (config.machineId !== machineId) continue;
    if (config.cliType === 'custom' && !hasCustomAcpLaunchCommand(config.customAcp)) continue;
    const provider: LocalProjectHistoryProvider = {
      cliType: config.cliType,
      agentType: config.agentType,
    };
    byKey.set(getLocalProjectHistoryProviderKey(provider), provider);
  }
  return [...byKey.values()];
}

export function shouldRunAutoHistorySync(args: {
  enabled: boolean;
  lastRunAt: number | null | undefined;
  now: number;
  cooldownMs?: number;
}): boolean {
  if (!args.enabled) return false;
  if (args.lastRunAt == null) return true;
  const cooldownMs = args.cooldownMs ?? AUTO_EXTERNAL_AGENT_HISTORY_COOLDOWN_MS;
  return args.now - args.lastRunAt >= cooldownMs;
}

export function selectDueAutoHistoryTargets(
  targets: readonly AutoExternalAgentHistoryTarget[],
  lastRunByTarget: Readonly<Record<string, number>>,
  now: number,
  options?: { cooldownMs?: number; limit?: number }
): AutoExternalAgentHistoryTarget[] {
  const cooldownMs = options?.cooldownMs ?? AUTO_EXTERNAL_AGENT_HISTORY_COOLDOWN_MS;
  const limit = options?.limit ?? AUTO_EXTERNAL_AGENT_HISTORY_TARGETS_PER_WAKE;
  const due = targets.filter((target) =>
    shouldRunAutoHistorySync({
      enabled: true,
      lastRunAt: lastRunByTarget[target.targetKey],
      now,
      cooldownMs,
    })
  );
  return due.slice(0, Math.max(0, limit));
}

export function selectAutoImportSessionIds(
  catalog: LocalProjectHistoryCatalogResult | null | undefined,
  limit = AUTO_EXTERNAL_AGENT_HISTORY_IMPORT_LIMIT
): string[] {
  if (!catalog || limit <= 0) return [];
  return [...catalog.sessions]
    .filter((session) => session.status === 'available')
    .sort((left, right) => {
      const leftUpdatedAt = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const rightUpdatedAt = right.updatedAt ? Date.parse(right.updatedAt) : 0;
      const leftTime = Number.isFinite(leftUpdatedAt) ? leftUpdatedAt : 0;
      const rightTime = Number.isFinite(rightUpdatedAt) ? rightUpdatedAt : 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.title.localeCompare(right.title);
    })
    .slice(0, limit)
    .map((session) => session.acpSessionId);
}
