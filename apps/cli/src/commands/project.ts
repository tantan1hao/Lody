import { Command } from 'commander';
import path from 'node:path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  type LocalProjectControlRequest,
  type LocalProjectControlResponse,
  type LocalProjectId,
  type MachineId,
  type WorkspaceId,
} from '@lody/shared';
import { AuthClient } from '@/lib/auth';
import { getCliPlatformKind } from '@/lib/cli-platform';
import { getCommandIdentityOrThrow, resolveWorkspaceOrThrow } from '@/lib/command-runtime';
import { getOrCreateStableMachineIdAsync } from '@/utils/const';
import {
  extractWorkspaceCandidates,
  printWorkspaceCandidates,
  promptWorkspaceSelection,
  sendLocalMachineRpc,
  sendLocalProjectControl,
} from '@/lib/local-project-control-client';
import { renderTerminalTable } from '@/lib/terminal-table';
import { getLogger, rootLogger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';

type CommonOptions = {
  json?: boolean;
  debug?: boolean;
};

type AddProjectOptions = CommonOptions & {
  workspace?: string;
  allWorkspaces?: boolean;
};

type SelectableProject = {
  workspaceId: WorkspaceId;
  workspaceName: string;
  localProjectId: LocalProjectId;
  name: string;
  rootPath: string;
};

function setDebugIfEnabled(options: CommonOptions): void {
  if (options.debug) {
    rootLogger.setDebug(true);
  }
}

async function resolveMachineIdOrExit(): Promise<MachineId> {
  const logger = getLogger('project');
  // The local platform has no account to read a machine id from; the stable
  // per-install id is the same one `lody start` registers under, so the
  // daemon recognises it.
  if (getCliPlatformKind() === 'local') {
    return (await getOrCreateStableMachineIdAsync()) as MachineId;
  }
  const authClient = new AuthClient(logger);
  const authInfo = authClient.getAuthInfo();
  if (!authInfo) {
    logger.error('Not logged in. Run `lody login` first.');
    process.exit(1);
  }
  return authInfo.machine.machineId as MachineId;
}

function printProjectControlError(
  action: string,
  response: Extract<LocalProjectControlResponse, { ok: false }>
): void {
  const logger = getLogger('project');
  logger.error(`Failed to ${action}: ${response.message}`);

  if (response.error === 'workspace_required') {
    const candidates = extractWorkspaceCandidates(response);
    if (candidates && candidates.length > 0) {
      printWorkspaceCandidates(candidates, 'project');
    }
  }
}

function buildAddProjectRequest(
  machineId: MachineId,
  rootPath: string,
  options: { workspace?: string; allWorkspaces?: boolean }
): LocalProjectControlRequest {
  return {
    type: 'local-project/add',
    machineId,
    rootPath,
    ...(options.workspace ? { workspace: options.workspace } : {}),
    ...(options.allWorkspaces ? { allWorkspaces: true } : {}),
  };
}

function collectSelectableProjects(
  response: Extract<LocalProjectControlResponse, { ok: true; type: 'local-project/list' }>
): SelectableProject[] {
  for (const workspace of response.result.workspaces) {
    workspace.projects.sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.rootPath.localeCompare(b.rootPath);
    });
  }

  const projects: SelectableProject[] = response.result.workspaces.flatMap((workspace) =>
    workspace.projects.map((project) => ({
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      localProjectId: project.localProjectId,
      name: project.name,
      rootPath: project.rootPath,
    }))
  );

  projects.sort((a, b) => {
    const workspaceCompare = a.workspaceName.localeCompare(b.workspaceName);
    if (workspaceCompare !== 0) {
      return workspaceCompare;
    }
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return a.rootPath.localeCompare(b.rootPath);
  });

  return projects;
}

async function promptDeleteProjectsSelection(
  projects: SelectableProject[]
): Promise<SelectableProject[] | null> {
  const logger = getLogger('project');
  const choices = projects.map((project) => {
    return {
      name: `${project.workspaceName} · ${project.name} ${chalk.gray(`(${project.rootPath})`)}`,
      value: project,
    };
  });

  try {
    const answer = await inquirer.prompt([
      {
        type: 'checkbox' as const,
        name: 'selection',
        message: 'Select local projects to delete:',
        choices,
        pageSize: Math.min(choices.length + 2, 12),
        validate: (value: unknown) => {
          if (!Array.isArray(value) || value.length === 0) {
            return 'Select at least one project.';
          }
          return true;
        },
      },
    ]);

    const rawSelection = (answer as { selection?: unknown }).selection;
    if (!Array.isArray(rawSelection)) {
      return null;
    }
    return rawSelection.filter(
      (item): item is SelectableProject =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as SelectableProject).workspaceId === 'string' &&
        typeof (item as SelectableProject).workspaceName === 'string' &&
        typeof (item as SelectableProject).localProjectId === 'string' &&
        typeof (item as SelectableProject).name === 'string' &&
        typeof (item as SelectableProject).rootPath === 'string'
    );
  } catch (error) {
    logger.error(`Project selection aborted: ${formatErrorMessage(error)}`);
    return null;
  }
}

const projectAddCommand = new Command('add')
  .description('Add a local project directory')
  .argument('[path]', 'Local project directory path', '.')
  .option('--workspace <selector>', 'Target workspace id, slug, or name')
  .option('--all-workspaces', 'Apply to all active workspaces')
  .option('--json', 'Output machine-readable JSON')
  .option('-d, --debug', 'enable debug output')
  .action(async (projectPath: string, options: AddProjectOptions) => {
    setDebugIfEnabled(options);

    if (options.workspace && options.allWorkspaces) {
      const logger = getLogger('project');
      logger.error('Cannot use --workspace together with --all-workspaces');
      process.exit(1);
    }

    const machineId = await resolveMachineIdOrExit();
    const rootPath = path.resolve(projectPath ?? '.');

    let response = await sendLocalProjectControl(
      buildAddProjectRequest(machineId, rootPath, {
        workspace: options.workspace,
        allWorkspaces: options.allWorkspaces,
      })
    );

    const canPromptForWorkspace =
      !options.json &&
      !options.workspace &&
      !options.allWorkspaces &&
      !!process.stdin.isTTY &&
      !!process.stdout.isTTY;

    if (!response.ok && response.error === 'workspace_required' && canPromptForWorkspace) {
      const candidates = extractWorkspaceCandidates(response);
      if (candidates && candidates.length > 0) {
        const selectedWorkspace = await promptWorkspaceSelection(candidates, 'project');
        if (!selectedWorkspace) {
          process.exit(1);
        }
        response = await sendLocalProjectControl(
          buildAddProjectRequest(machineId, rootPath, { workspace: selectedWorkspace })
        );
      }
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
      if (!response.ok) {
        process.exit(1);
      }
      return;
    }

    const logger = getLogger('project');
    if (!response.ok) {
      printProjectControlError('add project', response);
      process.exit(1);
    }
    if (response.type !== 'local-project/add') {
      logger.error(`Unexpected response type: ${response.type}`);
      process.exit(1);
    }

    logger.success(`✅ Added local project: ${response.result.name}`);
  });

const projectDeleteCommand = new Command('delete')
  .description('Delete local projects')
  .option('--json', 'Output machine-readable JSON')
  .option('-d, --debug', 'enable debug output')
  .action(async (options: CommonOptions) => {
    setDebugIfEnabled(options);

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      const logger = getLogger('project');
      logger.error('Interactive terminal required for project delete.');
      process.exit(1);
    }

    const machineId = await resolveMachineIdOrExit();
    const listResponse = await sendLocalProjectControl({
      type: 'local-project/list',
      machineId,
    });

    if (!listResponse.ok) {
      if (options.json) {
        process.stdout.write(`${JSON.stringify(listResponse, null, 2)}\n`);
      } else {
        printProjectControlError('list projects', listResponse);
      }
      process.exit(1);
    }
    if (listResponse.type !== 'local-project/list') {
      const logger = getLogger('project');
      logger.error(`Unexpected response type: ${listResponse.type}`);
      process.exit(1);
    }

    const selectableProjects = collectSelectableProjects(listResponse);
    if (selectableProjects.length === 0) {
      const logger = getLogger('project');
      logger.info('No local projects found.');
      return;
    }

    const selectedProjects = await promptDeleteProjectsSelection(selectableProjects);
    if (!selectedProjects) {
      process.exit(1);
    }

    const deleteResults: Array<LocalProjectControlResponse> = [];
    for (const selectedProject of selectedProjects) {
      const deleteResponse = await sendLocalProjectControl({
        type: 'local-project/delete',
        machineId,
        workspaceId: selectedProject.workspaceId,
        localProjectId: selectedProject.localProjectId,
      });
      deleteResults.push(deleteResponse);
    }

    const successResults = deleteResults.filter(
      (
        response
      ): response is Extract<
        LocalProjectControlResponse,
        { ok: true; type: 'local-project/delete' }
      > => response.ok && response.type === 'local-project/delete'
    );
    const failedResults = deleteResults.filter(
      (response): response is Extract<LocalProjectControlResponse, { ok: false }> => !response.ok
    );

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: failedResults.length === 0,
            deleted: successResults.map((result) => ({
              workspaceIds: result.result.workspaceIds,
              name: result.result.name,
              rootPath: result.result.rootPath,
            })),
            failed: failedResults.map((result) => ({
              type: result.type,
              error: result.error,
              message: result.message,
            })),
          },
          null,
          2
        )}\n`
      );
      if (failedResults.length > 0) {
        process.exit(1);
      }
      return;
    }

    const logger = getLogger('project');
    if (successResults.length > 0) {
      logger.success(
        `✅ Deleted ${successResults.length} local project${successResults.length > 1 ? 's' : ''}.`
      );
    }

    if (failedResults.length > 0) {
      for (const result of failedResults) {
        printProjectControlError('delete project', result);
      }
      process.exit(1);
    }
  });

const projectListCommand = new Command('list')
  .description('List local projects')
  .option('--json', 'Output machine-readable JSON')
  .option('-d, --debug', 'enable debug output')
  .action(async (options: CommonOptions) => {
    setDebugIfEnabled(options);

    const machineId = await resolveMachineIdOrExit();
    const response = await sendLocalProjectControl({
      type: 'local-project/list',
      machineId,
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
      if (!response.ok) {
        process.exit(1);
      }
      return;
    }

    const logger = getLogger('project');
    if (!response.ok) {
      printProjectControlError('list projects', response);
      process.exit(1);
    }
    if (response.type !== 'local-project/list') {
      logger.error(`Unexpected response type: ${response.type}`);
      process.exit(1);
    }

    const rows = response.result.workspaces
      .flatMap((workspace) =>
        workspace.projects.map((project) => [
          workspace.workspaceName,
          project.name,
          project.rootPath,
        ])
      )
      .sort((left, right) => {
        const workspaceCompare = String(left[0]).localeCompare(String(right[0]));
        if (workspaceCompare !== 0) {
          return workspaceCompare;
        }
        const projectCompare = String(left[1]).localeCompare(String(right[1]));
        if (projectCompare !== 0) {
          return projectCompare;
        }
        return String(left[2]).localeCompare(String(right[2]));
      });

    if (rows.length === 0) {
      logger.info('No local projects found.');
      return;
    }

    console.log(
      renderTerminalTable(
        [{ header: 'Workspace' }, { header: 'Project' }, { header: 'Path' }],
        rows
      )
    );
  });

/**
 * History sync and import, over the same project-control RPC the desktop UI
 * uses. There was no CLI entry point for either, so importing an external
 * agent's history meant clicking through project settings -- unusable on a
 * headless machine and unscriptable anywhere.
 */
type HistoryOptions = CommonOptions & {
  workspace?: string;
  agent: string;
  cliType?: string;
  session?: string[];
  all?: boolean;
};

async function resolveProjectOrExit(
  rootPath: string,
  workspaceSelector?: string
): Promise<{ workspaceId: WorkspaceId; localProjectId: LocalProjectId }> {
  const logger = getLogger('project');
  const machineId = await resolveMachineIdOrExit();
  const response = await sendLocalProjectControl({
    type: 'local-project/list',
    machineId,
  } as LocalProjectControlRequest);
  if (!response.ok) {
    printProjectControlError('list local projects', response);
    process.exit(1);
  }
  const resolved = path.resolve(rootPath);
  const workspaces = (response as { result: { workspaces: WorkspaceProjects[] } }).result.workspaces;
  const matches: { workspaceId: string; localProjectId: string }[] = [];
  for (const workspace of workspaces) {
    if (workspaceSelector && workspace.workspaceId !== workspaceSelector) continue;
    for (const project of workspace.projects) {
      if (path.resolve(project.rootPath) === resolved) {
        matches.push({
          workspaceId: workspace.workspaceId,
          localProjectId: project.localProjectId,
        });
      }
    }
  }
  if (matches.length === 0) {
    logger.error(`No registered local project at ${resolved}. Run \`lody project add\` first.`);
    process.exit(1);
  }
  if (matches.length > 1) {
    logger.error(`${resolved} is registered in several workspaces; pass --workspace.`);
    process.exit(1);
  }
  return {
    workspaceId: matches[0]!.workspaceId as WorkspaceId,
    localProjectId: matches[0]!.localProjectId as LocalProjectId,
  };
}

const projectHistoryListCommand = new Command('list')
  .description("List an agent's importable sessions for a local project")
  .argument('[path]', 'Project root path (defaults to the current directory)')
  .requiredOption('--agent <type>', 'Agent type, as shown by `lody agent-config list`')
  .option('--cli-type <type>', 'builtin | registry | custom (default: custom)', 'custom')
  .option('--workspace <id>', 'Workspace id when the path is registered more than once')
  .option('--json', 'Print JSON output')
  .option('--debug', 'Enable debug output')
  .action(async (projectPath: string | undefined, options: HistoryOptions) => {
    if (options.debug) rootLogger.setLevel('debug');
    const logger = getLogger('project');
    const machineId = await resolveMachineIdOrExit();
    const { workspaceId, localProjectId } = await resolveProjectOrExit(
      projectPath ?? '.',
      options.workspace
    );

    const response = await sendLocalProjectControl({
      type: 'local-project/sync-history',
      machineId,
      workspaceId,
      localProjectId,
      provider: { cliType: options.cliType ?? 'custom', agentType: options.agent },
    } as LocalProjectControlRequest);

    if (!response.ok) {
      printProjectControlError('sync history', response);
      process.exit(1);
    }
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    // 注意：RPC 回的 sessions 是**数组**。类型层的
    // LocalProjectHistoryCatalog.sessions 是 Record，两者不是一回事 ——
    // 照着类型写 Object.values 会在数组上得到一堆下标，静默变成空表。
    const sessions = (response as { result: { sessions?: HistoryCatalogRow[] } }).result.sessions ?? [];
    if (sessions.length === 0) {
      logger.info('No importable sessions found for this agent and project.');
      return;
    }
    console.log(
      renderTerminalTable(
        [{ header: 'Status' }, { header: 'Updated' }, { header: 'Title' }, { header: 'Session' }],
        sessions
          .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
          .map((session) => [
            session.status ?? 'available',
            String(session.updatedAt ?? '').slice(0, 16).replace('T', ' '),
            String(session.title ?? '').slice(0, 60),
            session.acpSessionId,
          ])
      )
    );
  });

const projectHistoryImportCommand = new Command('import')
  .description("Import an agent's sessions into this local project")
  .argument('[path]', 'Project root path (defaults to the current directory)')
  .requiredOption('--agent <type>', 'Agent type, as shown by `lody agent-config list`')
  .option('--cli-type <type>', 'builtin | registry | custom (default: custom)', 'custom')
  .option('--session <id>', 'Session id to import; repeatable', collectSessionId, [])
  .option('--all', 'Import every session the agent reports as available')
  .option('--workspace <id>', 'Workspace id when the path is registered more than once')
  .option('--json', 'Print JSON output')
  .option('--debug', 'Enable debug output')
  .action(async (projectPath: string | undefined, options: HistoryOptions) => {
    if (options.debug) rootLogger.setLevel('debug');
    const logger = getLogger('project');
    const machineId = await resolveMachineIdOrExit();
    const { workspaceId, localProjectId } = await resolveProjectOrExit(
      projectPath ?? '.',
      options.workspace
    );
    const provider = { cliType: options.cliType ?? 'custom', agentType: options.agent };

    let acpSessionIds = options.session ?? [];
    if (options.all) {
      // The catalog has to be refreshed first: import only accepts ids the
      // provider has already reported, so importing "everything" means asking
      // what everything is right now rather than trusting a stale list.
      const listed = await sendLocalProjectControl({
        type: 'local-project/sync-history',
        machineId,
        workspaceId,
        localProjectId,
        provider,
      } as LocalProjectControlRequest);
      if (!listed.ok) {
        printProjectControlError('sync history', listed);
        process.exit(1);
      }
      acpSessionIds = ((listed as { result: { sessions?: HistoryCatalogRow[] } }).result.sessions ?? [])
        .filter((session) => session.status !== 'imported')
        .map((session) => session.acpSessionId);
    }
    if (acpSessionIds.length === 0) {
      logger.info('Nothing to import (pass --session <id> or --all).');
      return;
    }

    logger.info(`Importing ${acpSessionIds.length} session(s)...`);
    const response = await sendLocalProjectControl({
      type: 'local-project/import-history',
      machineId,
      workspaceId,
      localProjectId,
      provider,
      acpSessionIds,
    } as LocalProjectControlRequest);

    if (!response.ok) {
      printProjectControlError('import history', response);
      process.exit(1);
    }
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    logger.success(`Imported ${acpSessionIds.length} session(s).`);
  });

function collectSessionId(value: string, previous: string[]): string[] {
  return [...previous, value];
}

type HistoryCatalogRow = {
  acpSessionId: string;
  title?: string;
  updatedAt?: string;
  status?: string;
};

type WorkspaceProjects = {
  workspaceId: string;
  projects: { localProjectId: string; rootPath: string }[];
};

/**
 * Switch which agent owns a session.
 *
 * The RPC already exists and the desktop composer calls it; there was no CLI
 * entry point. That matters most for sessions imported from a read-only
 * history provider: such an agent serves `session/list` and `session/load`
 * but refuses `session/prompt`, so the imported session cannot be continued
 * until it is handed to an agent that can actually run a turn.
 */
const projectSwitchAgentCommand = new Command('switch-agent')
  .description('Hand a session to a different agent config')
  .argument('<sessionId>', 'Session to move')
  .requiredOption('--agent-config <id>', 'Target agent config id (see `lody agent-config list`)')
  .option('--json', 'Print JSON output')
  .option('--debug', 'Enable debug output')
  .action(async (sessionId: string, options: CommonOptions & { agentConfig: string }) => {
    if (options.debug) rootLogger.setLevel('debug');
    const logger = getLogger('project');
    const auth = await getCommandIdentityOrThrow('project');
    const workspace = await resolveWorkspaceOrThrow(auth);
    const response = await sendLocalMachineRpc({
      method: 'session/switch-agent',
      machineId: auth.machineId,
      workspaceId: workspace.id,
      params: {
        sessionId,
        agentConfigId: options.agentConfig,
        requestedByUserId: auth.userId,
      },
    });
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    const ok = (response as { success?: boolean } | null)?.success;
    if (ok) {
      logger.success(`Session ${sessionId} now runs on agent config ${options.agentConfig}.`);
      return;
    }
    const err = (response as { error?: { message?: string } } | null)?.error;
    logger.error(`Failed to switch agent: ${err?.message ?? 'unknown error'}`);
    process.exit(1);
  });

const projectHistoryCommand = new Command('history')
  .description("Sync and import another agent's session history")
  .addCommand(projectHistoryListCommand)
  .addCommand(projectHistoryImportCommand);

export const projectCommand = new Command('project')
  .description('Manage local projects')
  .addCommand(projectAddCommand)
  .addCommand(projectDeleteCommand)
  .addCommand(projectListCommand)
  .addCommand(projectHistoryCommand)
  .addCommand(projectSwitchAgentCommand);
