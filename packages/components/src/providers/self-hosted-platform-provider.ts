import {
  createSelfHostedPlatformProvider,
  createStore,
  loadSelfHostedConfig,
  resolveSelfHostedControlOrigin,
  type MutableStore,
  type PlatformProvider,
  type PlatformSessionState,
  type SelfHostedConfigState,
  type WorkspacesState,
} from '@lody/platform';

let cachedProvider: PlatformProvider | null = null;
let loadingStarted = false;

const sessionStore: MutableStore<PlatformSessionState> = createStore({ status: 'loading' });
const workspacesStore: MutableStore<WorkspacesState> = createStore({ status: 'loading' });
const configStore: MutableStore<SelfHostedConfigState> = createStore({ status: 'loading' });

function getControlOrigin(): string {
  return resolveSelfHostedControlOrigin(
    import.meta.env.VITE_LODY_OSS_CONTROL_URL,
    typeof window === 'undefined' ? null : window.location.origin
  );
}

function getConfigStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function startLoading(): void {
  if (loadingStarted) return;
  loadingStarted = true;
  void loadSelfHostedConfig({
    controlOrigin: getControlOrigin(),
    storage: getConfigStorage(),
  })
    .then(({ config, source }) => {
      configStore.set({ status: 'ready', config, source });
      sessionStore.set({
        status: 'authenticated',
        user: { id: config.user.id, name: config.user.name },
      });
      workspacesStore.set({
        status: 'ready',
        workspaces: [
          {
            id: config.workspace.id,
            slug: config.workspace.slug,
            name: config.workspace.name,
            role: 'owner',
          },
        ],
        activeWorkspaceId: config.workspace.id,
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      configStore.set({ status: 'error', message });
      workspacesStore.set({ status: 'error', message });
    });
}

export function getSelfHostedPlatformProvider(): PlatformProvider {
  if (!cachedProvider) {
    cachedProvider = createSelfHostedPlatformProvider({
      session: sessionStore,
      workspaces: workspacesStore,
      config: configStore,
      controlOrigin: getControlOrigin(),
      syncMode:
        typeof window !== 'undefined' && window.__LODY_ELECTRON__ === true ? 'dual' : 'cloud',
    });
    startLoading();
  }
  return cachedProvider;
}
