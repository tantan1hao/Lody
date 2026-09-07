import { useEffect, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  autoSyncExternalAgentHistoryAtom,
  autoSyncExternalAgentHistoryLastRunAtom,
  getAllAgentConfigAtom,
  runtimeAtom,
  userAtom,
} from '@/atoms';
import { currentWorkspaceIdAtom } from '@/atoms/workspace-context';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { getAgentDisplayName } from '@/components/icons/agent-icon';
import { useVisibleLocalProjects } from '@/hooks/use-visible-local-projects';
import {
  AUTO_EXTERNAL_AGENT_HISTORY_POLL_MS,
  AUTO_EXTERNAL_AGENT_HISTORY_START_DELAY_MS,
  autoExternalAgentHistoryTargetKey,
  collectHistoryProvidersForMachine,
  selectAutoImportSessionIds,
  selectDueAutoHistoryTargets,
  type AutoExternalAgentHistoryTarget,
} from '@/lib/auto-external-agent-history';
import {
  canUseProjectHistoryProjectControl,
  importProjectHistoryForLocalProject,
  syncProjectHistoryForLocalProject,
} from '@/lib/project-history-control-client';

/**
 * When enabled, lists other ACP agents' local-project histories and imports
 * sessions that are not in Lody yet. Manual Sync/Import in project settings
 * stays available for conflicts and older sessions past the per-wake cap.
 */
export function AutoExternalAgentHistoryWatcher() {
  const { t } = useTranslation();
  const enabled = useAtomValue(autoSyncExternalAgentHistoryAtom);
  const [lastRunByTarget, setLastRunByTarget] = useAtom(autoSyncExternalAgentHistoryLastRunAtom);
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const localMachineId = useAtomValue(localMachineIdAtom);
  const runtime = useAtomValue(runtimeAtom);
  const agentConfigs = useAtomValue(getAllAgentConfigAtom);
  const { projects, isLoading } = useVisibleLocalProjects();
  const inFlightRef = useRef(false);
  const lastRunRef = useRef(lastRunByTarget);
  lastRunRef.current = lastRunByTarget;

  useEffect(() => {
    if (!enabled || !workspaceId || !currentUserId || isLoading) return;

    const runDueTargets = async () => {
      if (inFlightRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      const targets: AutoExternalAgentHistoryTarget[] = [];
      for (const entry of projects.values()) {
        if (entry.machine.ownerUserId !== currentUserId) continue;
        const providers = collectHistoryProvidersForMachine(agentConfigs, entry.machineId);
        if (providers.length === 0) continue;
        if (
          !canUseProjectHistoryProjectControl({
            runtime,
            localMachineId,
            machineId: entry.machineId,
            supportsLocalProjectHistoryRpc: entry.machine.supportsLocalProjectHistoryRpc,
          })
        ) {
          continue;
        }
        for (const provider of providers) {
          targets.push({
            targetKey: autoExternalAgentHistoryTargetKey(workspaceId, entry.key, provider),
            projectKey: entry.key,
            machineId: entry.machineId,
            localProjectId: entry.project.id,
            provider,
          });
        }
      }

      const due = selectDueAutoHistoryTargets(targets, lastRunRef.current, Date.now());
      if (due.length === 0) return;

      inFlightRef.current = true;
      const nextLastRun = { ...lastRunRef.current };
      try {
        for (const target of due) {
          try {
            const catalog = await syncProjectHistoryForLocalProject({
              provider: target.provider,
              runtime,
              localMachineId,
              machineId: target.machineId,
              workspaceId,
              localProjectId: target.localProjectId,
              requestedByUserId: currentUserId,
            });
            const acpSessionIds = selectAutoImportSessionIds(catalog);
            if (acpSessionIds.length > 0) {
              const imported = await importProjectHistoryForLocalProject({
                provider: target.provider,
                runtime,
                localMachineId,
                machineId: target.machineId,
                workspaceId,
                localProjectId: target.localProjectId,
                acpSessionIds,
                requestedByUserId: currentUserId,
              });
              if (imported.summary.imported > 0) {
                const providerLabel =
                  getAgentDisplayName(target.provider.cliType, target.provider.agentType) ??
                  target.provider.agentType;
                toast.success(
                  t('settings.autoExternalHistory.importedToast', {
                    defaultValue: 'Imported {{count}} {{provider}} session(s)',
                    count: imported.summary.imported,
                    provider: providerLabel,
                  })
                );
              }
            }
            nextLastRun[target.targetKey] = Date.now();
          } catch (error) {
            console.error('AutoExternalAgentHistoryWatcher: sync failed', {
              targetKey: target.targetKey,
              error,
            });
            nextLastRun[target.targetKey] = Date.now();
          }
        }
        setLastRunByTarget(nextLastRun);
      } finally {
        inFlightRef.current = false;
      }
    };

    const startId = window.setTimeout(() => {
      void runDueTargets();
    }, AUTO_EXTERNAL_AGENT_HISTORY_START_DELAY_MS);
    const pollId = window.setInterval(() => {
      void runDueTargets();
    }, AUTO_EXTERNAL_AGENT_HISTORY_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void runDueTargets();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearTimeout(startId);
      window.clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [
    agentConfigs,
    currentUserId,
    enabled,
    isLoading,
    localMachineId,
    projects,
    runtime,
    setLastRunByTarget,
    t,
    workspaceId,
  ]);

  return null;
}
