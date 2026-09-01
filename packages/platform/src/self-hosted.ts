import { z } from 'zod';
import { SELF_HOSTED_PLATFORM_CAPABILITIES } from './capabilities';
import type {
  CloudNotificationsPort,
  CloudPort,
  CloudStreamsTokenPort,
  LoroStreamsTokenProvider,
} from './cloud-port';
import type {
  PlatformProvider,
  PlatformSessionState,
  PlatformSyncMode,
  WorkspacesState,
} from './provider';
import { resolveRuntimeArtifactsBaseUrl } from './runtime-artifacts';
import type { ReadonlyStore } from './store';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA512_PATTERN = /^[A-Za-z0-9+/]{86}==$/u;
const CONFIG_PATH = '/.well-known/lody-oss.json';

function parseHttpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  return url.href;
}

const HttpsUrlSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    try {
      return parseHttpsUrl(value, 'URL');
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : String(error),
      });
      return z.NEVER;
    }
  });

const ControlOriginSchema = HttpsUrlSchema.transform((value, ctx) => {
  const url = new URL(value);
  if (url.pathname !== '/' || url.search || url.hash) {
    ctx.addIssue({
      code: 'custom',
      message: 'controlOrigin must be an HTTPS origin without a path',
    });
    return z.NEVER;
  }
  return url.origin;
});

export const SelfHostedConfigSchema = z
  .object({
    version: z.literal(1),
    controlOrigin: ControlOriginSchema,
    workspace: z
      .object({
        id: z.string().trim().min(1),
        slug: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    user: z
      .object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    ntfy: z
      .object({
        baseUrl: HttpsUrlSchema,
        topic: z.string().trim().min(1).max(256),
      })
      .strict(),
    downloads: z
      .object({
        pageUrl: HttpsUrlSchema,
        macArm64Url: HttpsUrlSchema,
        windowsX64Url: HttpsUrlSchema,
      })
      .strict(),
    releaseManifestUrl: HttpsUrlSchema,
  })
  .strict();

export type SelfHostedConfig = z.infer<typeof SelfHostedConfigSchema>;

export type SelfHostedConfigState =
  | { status: 'loading' }
  | { status: 'ready'; config: SelfHostedConfig; source: 'network' | 'cache' }
  | { status: 'error'; message: string };

export type SelfHostedStreamsConfig = {
  baseUrl: string;
  token: string;
};

export const SELF_HOSTED_STREAMS_TOKEN = 'lody-oss';
export const SELF_HOSTED_CONFIG_CACHE_KEY = 'lody:self-hosted-config:v1';

export const SelfHostedReleaseFileSchema = z
  .object({
    url: HttpsUrlSchema,
    size: z.number().int().positive(),
    sha512: z.string().regex(SHA512_PATTERN),
  })
  .strict();

export const SelfHostedReleaseManifestSchema = z
  .object({
    version: z.string().regex(VERSION_PATTERN),
    publishedAt: z.string().datetime({ offset: true }),
    downloads: z
      .object({
        macArm64: SelfHostedReleaseFileSchema,
        windowsX64: SelfHostedReleaseFileSchema,
      })
      .strict(),
    notes: z
      .object({
        en: z
          .string()
          .max(64 * 1024)
          .optional(),
        zh_CN: z
          .string()
          .max(64 * 1024)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SelfHostedReleaseManifest = z.infer<typeof SelfHostedReleaseManifestSchema>;

export interface SelfHostedConfigStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function resolveSelfHostedControlOrigin(
  configured: string | undefined | null,
  fallbackOrigin?: string | null
): string {
  const candidate = configured?.trim() || fallbackOrigin?.trim();
  if (!candidate) throw new Error('Self-hosted control origin is not configured');
  return ControlOriginSchema.parse(candidate);
}

export function getSelfHostedConfigUrl(controlOrigin: string): string {
  return new URL(CONFIG_PATH, resolveSelfHostedControlOrigin(controlOrigin)).href;
}

export function createSelfHostedStreamsConfig(controlOrigin: string): SelfHostedStreamsConfig {
  const origin = resolveSelfHostedControlOrigin(controlOrigin);
  return {
    // Streams clients append /ds/<bucket>/<stream> themselves. Supplying /ds
    // here would produce /ds/ds/... behind the same-origin nginx proxy.
    baseUrl: origin,
    token: SELF_HOSTED_STREAMS_TOKEN,
  };
}

function readCachedConfig(
  storage: SelfHostedConfigStorage | null | undefined,
  controlOrigin: string
): SelfHostedConfig | null {
  try {
    const raw = storage?.getItem(SELF_HOSTED_CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = SelfHostedConfigSchema.parse(JSON.parse(raw));
    return parsed.controlOrigin === controlOrigin ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadSelfHostedConfig(options: {
  controlOrigin: string;
  storage?: SelfHostedConfigStorage | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ config: SelfHostedConfig; source: 'network' | 'cache' }> {
  const controlOrigin = resolveSelfHostedControlOrigin(options.controlOrigin);
  const fetchImpl = options.fetchImpl ?? fetch;
  let networkError: unknown;
  try {
    const response = await fetchImpl(getSelfHostedConfigUrl(controlOrigin), {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = SelfHostedConfigSchema.parse(await response.json());
    if (config.controlOrigin !== controlOrigin) {
      throw new Error('Self-hosted config controlOrigin does not match the bootstrap origin');
    }
    try {
      options.storage?.setItem(SELF_HOSTED_CONFIG_CACHE_KEY, JSON.stringify(config));
    } catch {
      // The validated network config remains usable when browser storage is unavailable.
    }
    return { config, source: 'network' };
  } catch (error) {
    networkError = error;
  }

  const cached = readCachedConfig(options.storage, controlOrigin);
  if (cached) return { config: cached, source: 'cache' };
  const detail = networkError instanceof Error ? networkError.message : String(networkError);
  throw new Error(`Could not load self-hosted config from ${controlOrigin}: ${detail}`);
}

export function createStaticLoroStreamsTokenProvider(
  config: SelfHostedStreamsConfig,
  requestOrigin = globalThis.location?.origin
): LoroStreamsTokenProvider {
  const baseUrl = parseHttpsUrl(config.baseUrl, 'Streams base URL').replace(/\/$/u, '');
  const token = config.token.trim();
  if (!token) throw new Error('Streams token must not be empty');
  const useSameOriginCredentials = requestOrigin === new URL(baseUrl).origin;
  return {
    getToken: () => Promise.resolve(token),
    invalidate: () => {},
    getGatewayBaseUrl: () => baseUrl,
    getShardHostSuffix: () => undefined,
    createAuthCallback: () => async () => (useSameOriginCredentials ? undefined : token),
  };
}

export function createSelfHostedStreamsTokenPort(controlOrigin: string): CloudStreamsTokenPort {
  const streams = createSelfHostedStreamsConfig(controlOrigin);
  return {
    createTokenProvider: () => createStaticLoroStreamsTokenProvider(streams),
  };
}

export function createSelfHostedPlatformProvider(options: {
  session: ReadonlyStore<PlatformSessionState>;
  workspaces: ReadonlyStore<WorkspacesState>;
  config: ReadonlyStore<SelfHostedConfigState>;
  controlOrigin: string;
  syncMode: Extract<PlatformSyncMode, 'cloud' | 'dual'>;
}): PlatformProvider {
  return {
    kind: 'self-hosted',
    identity: { session: options.session, signOut: () => Promise.resolve() },
    workspaces: {
      state: options.workspaces,
      setActive: async (workspaceId) => {
        const state = options.workspaces.get();
        if (state.status === 'ready' && state.activeWorkspaceId === workspaceId) return;
        throw new Error(`Self-hosted mode has one fixed workspace; cannot activate ${workspaceId}`);
      },
    },
    capabilities: SELF_HOSTED_PLATFORM_CAPABILITIES,
    cloudApi: null,
    sync: {
      mode: options.syncMode,
      selfHostedStreams: createSelfHostedStreamsConfig(options.controlOrigin),
    },
    selfHosted: { config: options.config },
  };
}

function conciseText(value: string | null | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/gu, ' ').trim();
  return (normalized || fallback).slice(0, 180);
}

function sessionUrl(config: SelfHostedConfig, workspaceSlug: string, sessionId: string): string {
  return new URL(
    `/${encodeURIComponent(workspaceSlug)}/sessions/${encodeURIComponent(sessionId)}`,
    config.controlOrigin
  ).href;
}

function createNtfyNotificationsPort(options: {
  config: SelfHostedConfig;
  machineName: string;
  fetchImpl?: typeof fetch;
}): CloudNotificationsPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = new URL(
    encodeURIComponent(options.config.ntfy.topic),
    `${options.config.ntfy.baseUrl.replace(/\/+$/u, '')}/`
  ).href;
  const send = async (input: {
    status: string;
    title?: string | null;
    click: string;
    tag: string;
    priority?: 'default' | 'high';
  }): Promise<void> => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Title: 'Lody OSS',
        Click: input.click,
        Tags: input.tag,
        Priority: input.priority ?? 'default',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: `${conciseText(options.machineName, 'Machine')} · ${conciseText(input.title, 'Session')} · ${input.status}`,
    });
    if (!response.ok) throw new Error(`ntfy request failed with HTTP ${response.status}`);
  };

  return {
    notifySessionCompleted: async (input) =>
      await send({
        status: 'completed',
        title: input.sessionTitle,
        click: sessionUrl(options.config, input.workspaceSlug, input.sessionId),
        tag: 'white_check_mark',
      }),
    notifySessionFailed: async (input) =>
      await send({
        status: 'failed',
        title: input.sessionTitle,
        click: sessionUrl(options.config, input.workspaceSlug, input.sessionId),
        tag: 'x',
        priority: 'high',
      }),
    notifyPermissionRequested: async (input) =>
      await send({
        status:
          input.requestKind === 'ask_user_question'
            ? 'waiting for an answer'
            : 'permission requested',
        title: input.sessionTitle,
        click: sessionUrl(options.config, input.workspaceSlug, input.sessionId),
        tag: 'warning',
        priority: 'high',
      }),
    recordPermissionRequested: () => Promise.resolve(),
    resolvePermissionRequested: () => Promise.resolve(),
    syncLiveActivitySummary: () => Promise.resolve({ sent: false, reason: 'unsupported' }),
  };
}

export function createSelfHostedCloudPort(options: {
  config: SelfHostedConfig;
  machineName: string;
  fetchImpl?: typeof fetch;
  runtimeArtifactsBaseUrl?: string;
}): CloudPort {
  const { config } = options;
  const workspace = {
    id: config.workspace.id,
    name: config.workspace.name,
    slug: config.workspace.slug,
    role: 'owner',
  };
  return {
    kind: 'self-hosted',
    identity: { userId: config.user.id, name: config.user.name },
    access: {
      watchWorkspaceAccess: (listener) => {
        listener({ status: 'authorized', userId: config.user.id, workspaces: [workspace] });
        return () => {};
      },
      verifyMachineAccess: (request) =>
        Promise.resolve(
          request.requesterUserId === config.user.id && request.workspaceId === config.workspace.id
            ? { allowed: true }
            : { allowed: false, reason: 'requester_not_member' }
        ),
      registerMachineAccess: () => Promise.resolve(),
      resolveWorkspaceUser: (request) =>
        Promise.resolve(
          request.workspaceId === config.workspace.id && request.userId === config.user.id
            ? { id: config.user.id, name: config.user.name }
            : null
        ),
    },
    streamsTokens: createSelfHostedStreamsTokenPort(config.controlOrigin),
    notifications: createNtfyNotificationsPort(options),
    usage: null,
    billing: null,
    githubTokens: null,
    bugReports: null,
    prAssociation: null,
    attachmentUpload: null,
    remotePreview: null,
    runtimeArtifacts: {
      baseUrl: resolveRuntimeArtifactsBaseUrl(options.runtimeArtifactsBaseUrl),
    },
    dispose: () => Promise.resolve(),
  };
}
