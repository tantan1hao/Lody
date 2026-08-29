import type { ChildProcess } from 'child_process';
import os from 'os';
import * as acp from '@agentclientprotocol/sdk';
import type {
  AgentConfigCliType,
  BuiltinRuntimeOverrides,
  CustomAcpLaunchSpec,
} from '@lody/shared';
import { REGISTRY_ACP_AGENTS } from '@lody/shared';

import { withoutElectronBootstrapCredentials } from '@/electron-bootstrap-env';
import { withLoopbackNoProxy } from '@lody/shared/proxy-env';
import type { Logger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';
import { createStdinWritableStream, createStdoutReadableStream } from '@/utils/stream';
import { getLoginShellEnv } from './login-shell-env';
import {
  mergeACPProcessEnv,
  mergeLoginShellEnv,
  resolveACPProcessLaunchAsync,
  withDefaultAcpPathEntries,
} from './setting';
import { spawnAcpProcess, shutdownLocalAcpAgent } from './acp-runner';
import { withLodyNpmCacheForNpx } from './npx-cache';
import type { AcpAuthenticationProgressEvent, AcpAuthenticationResult } from './acp-authentication';

const PREFERRED_PROTOCOL_AUTH_METHOD_IDS = ['oauth-personal', 'oauth-business'] as const;
const AUTHORIZATION_URL_PATTERN = /https:\/\/[^\s"'<>]+/gu;

export function getAcpAuthMethodId(method: unknown): string | undefined {
  if (typeof method !== 'object' || method === null) return undefined;
  const record = method as Record<string, unknown>;
  if (typeof record.methodId === 'string' && record.methodId.trim()) return record.methodId.trim();
  if (typeof record.id === 'string' && record.id.trim()) return record.id.trim();
  return undefined;
}

export function getAcpAuthMethodType(method: unknown): 'agent' | 'terminal' | 'env_var' {
  if (typeof method !== 'object' || method === null) return 'agent';
  const type = (method as { type?: unknown }).type;
  if (type === 'terminal' || type === 'env_var') return type;
  return 'agent';
}

export function selectAcpProtocolAuthMethodId(
  methods: readonly unknown[],
  agentType?: string
): string | undefined {
  const agentMethodIds = methods
    .filter((method) => getAcpAuthMethodType(method) === 'agent')
    .map((method) => getAcpAuthMethodId(method))
    .filter((id): id is string => Boolean(id));
  for (const preferred of PREFERRED_PROTOCOL_AUTH_METHOD_IDS) {
    if (agentMethodIds.includes(preferred)) return preferred;
  }
  if (agentMethodIds[0]) return agentMethodIds[0];
  return agentType === 'antigravity-acp' ? 'oauth-personal' : undefined;
}

export function getRegistryAcpDisplayName(agentType: string): string {
  return REGISTRY_ACP_AGENTS.find((agent) => agent.id === agentType)?.name ?? agentType;
}

function hasDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isTrustedProtocolAuthorizationUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  return (
    hasDomain(url.hostname, 'accounts.google.com') ||
    hasDomain(url.hostname, 'antigravity.google') ||
    url.hostname === 'oauth2.googleapis.com'
  );
}

export function findTrustedProtocolAuthorizationUrl(output: string): string | undefined {
  for (const match of output.matchAll(AUTHORIZATION_URL_PATTERN)) {
    const candidate = match[0].replace(/[),.;]+$/u, '');
    try {
      const url = new URL(candidate);
      if (isTrustedProtocolAuthorizationUrl(url)) return url.toString();
    } catch {
      // Incomplete URL chunks arrive later.
    }
  }
  return undefined;
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}

export type AcpProtocolConnection = {
  initialize: (params: acp.InitializeRequest) => Promise<acp.InitializeResponse>;
  authenticate: (params: acp.AuthenticateRequest) => Promise<acp.AuthenticateResponse | void>;
};

export type AcpProtocolAuthenticateConnect = (options: {
  onOutput: (output: string) => void;
  onAuthorizationUrl: (authorizationUrl: string) => void;
}) => Promise<{
  connection: AcpProtocolConnection;
  agentProcess?: ChildProcess;
}>;

export async function authenticateAcpProtocol(options: {
  cliType: AgentConfigCliType;
  agentType: string;
  customAcp?: CustomAcpLaunchSpec;
  runtimeOverrides?: BuiltinRuntimeOverrides;
  env?: Record<string, string>;
  logger: Logger;
  signal?: AbortSignal;
  onChild?: (child: ChildProcess) => void;
  onProgress?: (event: AcpAuthenticationProgressEvent) => void;
  connect?: AcpProtocolAuthenticateConnect;
}): Promise<AcpAuthenticationResult> {
  const displayName = getRegistryAcpDisplayName(options.agentType);
  const connect = options.connect ?? createDefaultProtocolAuthConnect(options);
  let agentProcess: ChildProcess | undefined;
  try {
    options.signal?.throwIfAborted();
    options.onProgress?.({ status: 'starting' });
    const connected = await connect({
      onOutput: (output) => {
        const authorizationUrl = findTrustedProtocolAuthorizationUrl(output);
        if (authorizationUrl) {
          options.onProgress?.({ status: 'authorization', authorizationUrl });
        }
        options.onProgress?.({
          status: 'output',
          stream: 'stderr',
          output: output.slice(0, 16_384),
        });
      },
      onAuthorizationUrl: (authorizationUrl) => {
        options.onProgress?.({ status: 'authorization', authorizationUrl });
      },
    });
    agentProcess = connected.agentProcess;
    if (agentProcess) options.onChild?.(agentProcess);
    options.signal?.throwIfAborted();

    const initResponse = await connected.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        auth: { terminal: true },
      },
    });
    options.signal?.throwIfAborted();

    const methodId = selectAcpProtocolAuthMethodId(initResponse.authMethods ?? [], options.agentType);
    if (!methodId) {
      const error = `${displayName} did not advertise a protocol login method`;
      options.onProgress?.({ status: 'error', error });
      return { success: false, disposition: 'error', error };
    }

    await connected.connection.authenticate({ methodId });
    options.signal?.throwIfAborted();
    options.onProgress?.({ status: 'authenticated' });
    return { success: true, disposition: 'authenticated' };
  } catch (error) {
    if (options.signal?.aborted) {
      options.onProgress?.({ status: 'cancelled' });
      return { success: true, disposition: 'cancelled' };
    }
    const message = formatErrorMessage(error);
    options.onProgress?.({ status: 'error', error: message });
    return { success: false, disposition: 'error', error: message };
  } finally {
    if (agentProcess) {
      await shutdownLocalAcpAgent({
        agentProcess,
        logger: options.logger,
        sessionLabel: `acp-protocol-auth:${options.agentType}`,
      }).catch((error: unknown) => {
        options.logger.debug(
          `[acp-auth] Failed to stop protocol authentication process: ${formatErrorMessage(error)}`
        );
      });
    }
  }
}

function createDefaultProtocolAuthConnect(options: {
  cliType: AgentConfigCliType;
  agentType: string;
  customAcp?: CustomAcpLaunchSpec;
  runtimeOverrides?: BuiltinRuntimeOverrides;
  env?: Record<string, string>;
  logger: Logger;
  signal?: AbortSignal;
}): AcpProtocolAuthenticateConnect {
  return async ({ onOutput, onAuthorizationUrl }) => {
    const launch = await resolveACPProcessLaunchAsync({
      cliType: options.cliType,
      agentType: options.agentType,
      customAcp: options.customAcp,
      runtimeOverrides: options.runtimeOverrides,
      signal: options.signal,
    });
    options.signal?.throwIfAborted();
    const loginShellEnv = await getLoginShellEnv();
    const env = withLoopbackNoProxy(
      withoutElectronBootstrapCredentials(
        withLodyNpmCacheForNpx(
          launch.command,
          withDefaultAcpPathEntries(
            mergeACPProcessEnv(
              launch,
              mergeLoginShellEnv({ ...process.env, ...options.env, NO_COLOR: '1' }, loginShellEnv)
            ),
            options.agentType
          )
        )
      )
    );
    const agentProcess = spawnAcpProcess({
      cliType: options.cliType,
      agentType: options.agentType,
      workdir: os.homedir(),
      env,
      command: launch.command,
      args: launch.args,
    });
    agentProcess.stderr?.setEncoding('utf8');
    agentProcess.stderr?.on('data', (chunk: string) => {
      if (chunk) onOutput(chunk);
    });
    if (!agentProcess.stdout || !agentProcess.stdin) {
      throw new Error(`${getRegistryAcpDisplayName(options.agentType)} process streams are unavailable`);
    }
    const stream = acp.ndJsonStream(
      createStdinWritableStream(agentProcess.stdin),
      createStdoutReadableStream(agentProcess.stdout)
    );
    const connection = new acp.ClientSideConnection(
      () => ({
        async requestPermission(params) {
          const texts: string[] = [];
          collectStrings(params, texts);
          for (const text of texts) {
            const authorizationUrl = findTrustedProtocolAuthorizationUrl(text);
            if (authorizationUrl) {
              onAuthorizationUrl(authorizationUrl);
              break;
            }
          }
          const allow = params.options.find(
            (option) =>
              option.kind === 'allow_once' ||
              /allow|open|continue|authorize/iu.test(option.name ?? option.optionId)
          );
          if (allow) {
            return { outcome: { outcome: 'selected', optionId: allow.optionId } };
          }
          return { outcome: { outcome: 'cancelled' } };
        },
        async sessionUpdate(params) {
          const texts: string[] = [];
          collectStrings(params, texts);
          for (const text of texts) {
            const authorizationUrl = findTrustedProtocolAuthorizationUrl(text);
            if (authorizationUrl) {
              onAuthorizationUrl(authorizationUrl);
              return;
            }
          }
        },
      }),
      stream
    );
    return { connection, agentProcess };
  };
}
