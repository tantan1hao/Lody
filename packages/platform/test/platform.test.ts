import { describe, expect, it } from 'vitest';
import type { WorkspaceId } from '@lody/shared';
import {
  CLOUD_PLATFORM_CAPABILITIES,
  createCapabilitySet,
  defineCloudAction,
  defineCloudMutation,
  defineCloudQuery,
  createLocalCloudPort,
  createLocalPlatformProvider,
  createSelfHostedCloudPort,
  createSelfHostedPlatformProvider,
  createSelfHostedStreamsConfig,
  createStaticLoroStreamsTokenProvider,
  createStaticStore,
  createStore,
  isLocalUserId,
  isLocalWorkspaceId,
  LOCAL_PLATFORM_CAPABILITIES,
  loadSelfHostedConfig,
  PLATFORM_CAPABILITIES,
  SELF_HOSTED_PLATFORM_CAPABILITIES,
  SelfHostedConfigSchema,
  type SelfHostedConfig,
  type PlatformSessionState,
  DEFAULT_RUNTIME_ARTIFACTS_BASE_URL,
  resolveRuntimeArtifactsBaseUrl,
  resolvePlatformKind,
} from '../src/index';

describe('resolvePlatformKind', () => {
  it('defaults to local when unset or blank', () => {
    expect(resolvePlatformKind(undefined)).toBe('local');
    expect(resolvePlatformKind(null)).toBe('local');
    expect(resolvePlatformKind('')).toBe('local');
    expect(resolvePlatformKind('  ')).toBe('local');
  });

  it('parses explicit kinds and trims whitespace', () => {
    expect(resolvePlatformKind('local')).toBe('local');
    expect(resolvePlatformKind(' self-hosted ')).toBe('self-hosted');
    expect(resolvePlatformKind(' cloud ')).toBe('cloud');
  });

  it('throws on unrecognized values instead of silently running cloud', () => {
    expect(() => resolvePlatformKind('offline')).toThrow(/Unrecognized/);
  });
});

describe('capabilities', () => {
  it('local set is empty; cloud set covers every capability', () => {
    expect(LOCAL_PLATFORM_CAPABILITIES.list()).toEqual([]);
    for (const capability of PLATFORM_CAPABILITIES) {
      expect(LOCAL_PLATFORM_CAPABILITIES.has(capability)).toBe(false);
      expect(CLOUD_PLATFORM_CAPABILITIES.has(capability)).toBe(true);
    }
  });

  it('self-hosted exposes remote dispatch without official enrollment', () => {
    expect(SELF_HOSTED_PLATFORM_CAPABILITIES.list()).toEqual(['remoteMachines']);
    expect(SELF_HOSTED_PLATFORM_CAPABILITIES.has('managedMachineEnrollment')).toBe(false);
  });

  it('createCapabilitySet deduplicates and answers membership', () => {
    const set = createCapabilitySet(['billing', 'billing', 'cloudSync']);
    expect(set.list()).toEqual(['billing', 'cloudSync']);
    expect(set.has('billing')).toBe(true);
    expect(set.has('teamSharing')).toBe(false);
  });
});

describe('cloud operation descriptors', () => {
  it('carry only a validated backend-neutral operation identity', () => {
    expect(defineCloudQuery<{ workspaceId: string }, string>('billing', 'billing:getPlan')).toEqual(
      {
        kind: 'query',
        capability: 'billing',
        name: 'billing:getPlan',
        access: 'authenticated',
      }
    );
    expect(
      defineCloudMutation<{ enabled: boolean }, null>('githubIntegration', 'github:setEnabled')
    ).toEqual({
      kind: 'mutation',
      capability: 'githubIntegration',
      name: 'github:setEnabled',
      access: 'authenticated',
    });
    expect(
      defineCloudAction<Record<string, never>, string>('billing', 'billing:createCheckout')
    ).toEqual({
      kind: 'action',
      capability: 'billing',
      name: 'billing:createCheckout',
      access: 'authenticated',
    });
  });

  it('rejects malformed names at assembly instead of deferring the error to a request', () => {
    expect(() => defineCloudQuery('billing', 'missingFunctionSeparator')).toThrow(
      /Invalid cloud operation/
    );
  });
});

describe('stores', () => {
  it('createStore notifies subscribers only on actual change', () => {
    const store = createStore(1);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.set(1);
    expect(notified).toBe(0);
    store.set(2);
    expect(notified).toBe(1);
    expect(store.get()).toBe(2);
    unsubscribe();
    store.set(3);
    expect(notified).toBe(1);
  });
});

describe('local id namespaces', () => {
  it('recognizes local prefixes and rejects cloud-shaped ids', () => {
    expect(isLocalWorkspaceId('lw_abc123')).toBe(true);
    expect(isLocalWorkspaceId('j57abcdefgh')).toBe(false);
    expect(isLocalUserId('local:abc')).toBe(true);
    expect(isLocalUserId('user_123')).toBe(false);
  });
});

describe('createLocalPlatformProvider', () => {
  const user = { id: 'local:u1', name: 'Local User' };
  const workspace = { id: 'lw_w1', name: 'Local', slug: null, role: 'owner' };

  it('resolves its injected identity with no capabilities and local sync mode', async () => {
    const session = createStore<PlatformSessionState>({ status: 'loading' });
    const provider = createLocalPlatformProvider({
      session,
      workspaces: createStaticStore({
        status: 'ready',
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
      } as const),
    });
    expect(provider.kind).toBe('local');
    expect(provider.sync.mode).toBe('local');
    expect(provider.capabilities.list()).toEqual([]);
    expect(provider.cloudApi).toBeNull();
    expect(provider.identity.session.get()).toEqual({ status: 'loading' });
    session.set({ status: 'authenticated', user });
    expect(provider.identity.session.get()).toEqual({ status: 'authenticated', user });
    expect(provider.workspaces.create).toBeUndefined();
    await expect(provider.workspaces.setActive(workspace.id)).resolves.toBeUndefined();
    await expect(provider.workspaces.setActive('lw_other')).rejects.toThrow(/single implicit/);
  });
});

describe('createLocalCloudPort', () => {
  const identity = { userId: 'local:u1' };
  const workspaces = [{ id: 'lw_w1', name: 'Local', slug: null, role: 'owner' }];

  it('allows only the owner and disables every optional port', async () => {
    const port = createLocalCloudPort({ identity, workspaces });
    expect(port.kind).toBe('local');
    expect(port.streamsTokens).toBeNull();
    expect(port.notifications).toBeNull();
    expect(port.usage).toBeNull();
    expect(port.billing).toBeNull();
    expect(port.githubTokens).toBeNull();
    expect(port.bugReports).toBeNull();
    expect(port.prAssociation).toBeNull();
    expect(port.attachmentUpload).toBeNull();
    expect(port.remotePreview).toBeNull();
    expect(port.runtimeArtifacts.baseUrl).toBe(DEFAULT_RUNTIME_ARTIFACTS_BASE_URL);

    await expect(
      port.access.verifyMachineAccess({
        workspaceId: 'lw_w1' as WorkspaceId,
        requesterUserId: 'local:u1',
      })
    ).resolves.toEqual({ allowed: true });
    await expect(
      port.access.verifyMachineAccess({
        workspaceId: 'lw_w1' as WorkspaceId,
        requesterUserId: 'cloud-user',
      })
    ).resolves.toEqual({ allowed: false, reason: 'requester_not_member' });

    const seen: unknown[] = [];
    const unsubscribe = port.access.watchWorkspaceAccess(
      (snapshot) => seen.push(snapshot),
      (error) => {
        throw error;
      }
    );
    expect(seen).toEqual([{ status: 'authorized', userId: identity.userId, workspaces }]);
    unsubscribe();
  });
});

describe('runtime artifact channel assembly', () => {
  it('uses the public R2-backed artifact channel by default', () => {
    expect(resolveRuntimeArtifactsBaseUrl()).toBe(DEFAULT_RUNTIME_ARTIFACTS_BASE_URL);
  });

  it('allows an explicit operator mirror to override the public channel', () => {
    expect(resolveRuntimeArtifactsBaseUrl('https://artifacts.example.test/')).toBe(
      'https://artifacts.example.test'
    );
  });

  it('rejects an invalid operator mirror at process assembly', () => {
    expect(() => resolveRuntimeArtifactsBaseUrl('not a URL')).toThrow(
      /Invalid runtime artifacts base URL/
    );
  });
});

const selfHostedConfig: SelfHostedConfig = {
  version: 1,
  controlOrigin: 'https://tan.example.test',
  workspace: { id: 'lw_shared', slug: 'local', name: 'Lody' },
  user: { id: 'local:shared', name: 'Owner' },
  ntfy: { baseUrl: 'https://tan.example.test:8093/', topic: 'lody-oss' },
  downloads: {
    pageUrl: 'https://updates.example.test/lody-oss/',
    macArm64Url: 'https://updates.example.test/lody-oss/LodyOSS.dmg',
    windowsX64Url: 'https://updates.example.test/lody-oss/LodyOSS.exe',
  },
  releaseManifestUrl: 'https://updates.example.test/lody-oss/release.json',
};

describe('self-hosted config', () => {
  it('validates the version and every network trust-boundary URL', () => {
    expect(SelfHostedConfigSchema.parse(selfHostedConfig)).toEqual(selfHostedConfig);
    expect(() => SelfHostedConfigSchema.parse({ ...selfHostedConfig, version: 2 })).toThrow();
    expect(() =>
      SelfHostedConfigSchema.parse({
        ...selfHostedConfig,
        releaseManifestUrl: 'http://updates.example.test/release.json',
      })
    ).toThrow(/HTTPS/);
    expect(() =>
      SelfHostedConfigSchema.parse({
        ...selfHostedConfig,
        controlOrigin: 'https://tan.example.test/control',
      })
    ).toThrow(/origin/);
  });

  it('uses a validated cache only after the control request fails', async () => {
    const values = new Map<string, string>();
    let requestInit: RequestInit | undefined;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const first = await loadSelfHostedConfig({
      controlOrigin: selfHostedConfig.controlOrigin,
      storage,
      fetchImpl: async (_input, init) => {
        requestInit = init;
        return new Response(JSON.stringify(selfHostedConfig), { status: 200 });
      },
    });
    expect(first.source).toBe('network');
    expect(requestInit?.credentials).toBe('same-origin');

    const cached = await loadSelfHostedConfig({
      controlOrigin: selfHostedConfig.controlOrigin,
      storage,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    expect(cached).toEqual({ config: selfHostedConfig, source: 'cache' });
  });
});

describe('self-hosted adapters', () => {
  it('preserves browser HTTP auth on same-origin Streams requests', async () => {
    const streams = createSelfHostedStreamsConfig(selfHostedConfig.controlOrigin);
    const sameOrigin = createStaticLoroStreamsTokenProvider(
      streams,
      selfHostedConfig.controlOrigin
    );
    const crossOrigin = createStaticLoroStreamsTokenProvider(streams, 'https://desktop.invalid');

    await expect(sameOrigin.createAuthCallback()()).resolves.toBeUndefined();
    await expect(crossOrigin.createAuthCallback()()).resolves.toBe(streams.token);
  });

  it('reuses the fixed workspace and static Streams endpoint in web mode', () => {
    const configStore = createStaticStore({
      status: 'ready',
      config: selfHostedConfig,
      source: 'network',
    } as const);
    const provider = createSelfHostedPlatformProvider({
      session: createStaticStore({
        status: 'authenticated',
        user: { id: selfHostedConfig.user.id, name: selfHostedConfig.user.name },
      } as const),
      workspaces: createStaticStore({
        status: 'ready',
        workspaces: [
          {
            id: selfHostedConfig.workspace.id,
            name: selfHostedConfig.workspace.name,
            slug: selfHostedConfig.workspace.slug,
            role: 'owner',
          },
        ],
        activeWorkspaceId: selfHostedConfig.workspace.id,
      } as const),
      config: configStore,
      controlOrigin: selfHostedConfig.controlOrigin,
      syncMode: 'cloud',
    });
    expect(provider.kind).toBe('self-hosted');
    expect(provider.sync.mode).toBe('cloud');
    expect(provider.sync.selfHostedStreams).toEqual(
      createSelfHostedStreamsConfig(selfHostedConfig.controlOrigin)
    );
    expect(provider.sync.selfHostedStreams?.baseUrl).toBe(selfHostedConfig.controlOrigin);
    expect(provider.capabilities.list()).toEqual(['remoteMachines']);
    expect(provider.cloudApi).toBeNull();
  });

  it('allows only the configured single user/workspace and sends concise ntfy messages', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const port = createSelfHostedCloudPort({
      config: selfHostedConfig,
      machineName: 'Mac mini',
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response('', { status: 200 });
      },
    });
    expect(port.kind).toBe('self-hosted');
    expect(port.streamsTokens).not.toBeNull();
    expect(port.billing).toBeNull();
    await expect(
      port.access.verifyMachineAccess({
        workspaceId: selfHostedConfig.workspace.id as WorkspaceId,
        requesterUserId: selfHostedConfig.user.id,
      })
    ).resolves.toEqual({ allowed: true });
    await expect(
      port.access.verifyMachineAccess({
        workspaceId: selfHostedConfig.workspace.id as WorkspaceId,
        requesterUserId: 'someone-else',
      })
    ).resolves.toEqual({ allowed: false, reason: 'requester_not_member' });

    await port.notifications?.notifySessionFailed({
      sessionId: 'session-1' as never,
      occurrenceId: 'turn-1',
      sessionTitle: 'Build release',
      workspaceId: selfHostedConfig.workspace.id as WorkspaceId,
      workspaceSlug: selfHostedConfig.workspace.slug,
      userId: selfHostedConfig.user.id,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://tan.example.test:8093/lody-oss');
    expect(requests[0]?.init?.body).toBe('Mac mini · Build release · failed');
    expect(new Headers(requests[0]?.init?.headers).get('Click')).toBe(
      'https://tan.example.test/local/sessions/session-1'
    );
  });
});
