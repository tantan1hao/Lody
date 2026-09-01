import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_PUSH_SERVICE_WORKER_SCOPE,
  WEB_PUSH_SERVICE_WORKER_URL,
  WEB_PUSH_SUBSCRIPTION_PATH,
  WEB_PUSH_VAPID_PUBLIC_KEY_PATH,
  getWebPushState,
  inspectWebPushEnvironment,
  registerWebPushServiceWorker,
  subscribeWebPush,
  unsubscribeWebPush,
  urlBase64ToUint8Array,
} from '../src/lib/web-push-client';

const IPHONE_SAFARI_18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15';
const IPHONE_SAFARI_16_3 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15';
const IPHONE_SAFARI_16_4 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAC_SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function createPushApis() {
  return {
    Notification: function Notification() {},
    PushManager: function PushManager() {},
  };
}

function createSubscription(overrides?: { endpoint?: string }) {
  const endpoint = overrides?.endpoint ?? 'https://push.example/sub';
  return {
    endpoint,
    expirationTime: null,
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    }),
  };
}

function createServiceWorker(subscription: ReturnType<typeof createSubscription> | null = null) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => subscription),
      subscribe: vi.fn(async () => subscription ?? createSubscription()),
    },
  };
  return {
    registration,
    serviceWorker: {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  };
}

function stubBrowser(options: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayMode?: 'browser' | 'standalone' | 'fullscreen';
  permission?: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission>;
  subscription?: ReturnType<typeof createSubscription> | null;
  fetchImpl?: typeof fetch;
}) {
  const { serviceWorker, registration } = createServiceWorker(options.subscription ?? null);
  const NotificationCtor = Object.assign(function Notification() {}, {
    permission: options.permission ?? 'default',
    requestPermission: options.requestPermission ?? vi.fn(async () => 'granted' as const),
  });
  const displayMode = options.displayMode ?? (options.standalone ? 'standalone' : 'browser');
  const host = {
    navigator: {
      userAgent: options.userAgent,
      platform: options.platform ?? 'MacIntel',
      maxTouchPoints: options.maxTouchPoints ?? 0,
      standalone: options.standalone ?? false,
      serviceWorker,
    },
    matchMedia: (query: string) => ({
      matches:
        (query === '(display-mode: standalone)' && displayMode === 'standalone') ||
        (query === '(display-mode: fullscreen)' && displayMode === 'fullscreen'),
    }),
    Notification: NotificationCtor,
    PushManager: function PushManager() {},
  };
  vi.stubGlobal('window', host);
  vi.stubGlobal('navigator', host.navigator);
  vi.stubGlobal('Notification', NotificationCtor);
  if (options.fetchImpl) {
    vi.stubGlobal('fetch', options.fetchImpl);
  }
  return { host, serviceWorker, registration, NotificationCtor };
}

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 without padding', () => {
    const bytes = urlBase64ToUint8Array('AQID');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('restores missing padding', () => {
    const bytes = urlBase64ToUint8Array('AQIDBA');
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });
});

describe('inspectWebPushEnvironment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires the Home Screen app on iPhone Safari and does not expose a usable permission API', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: IPHONE_SAFARI_18,
        standalone: false,
        serviceWorker: {} as never,
      },
      matchMedia: () => ({ matches: false }),
      ...createPushApis(),
    });
    expect(environment).toMatchObject({
      ios: true,
      standalone: false,
      needsHomeScreen: true,
      apiAvailable: false,
    });
  });

  it('treats an installed iOS Home Screen app as ready for push APIs', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: IPHONE_SAFARI_16_4,
        standalone: true,
        serviceWorker: {} as never,
      },
      matchMedia: () => ({ matches: true }),
      ...createPushApis(),
    });
    expect(environment.needsHomeScreen).toBe(false);
    expect(environment.standalone).toBe(true);
    expect(environment.apiAvailable).toBe(true);
  });

  it('treats fullscreen display mode as an installed Home Screen app', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: IPHONE_SAFARI_18,
        standalone: false,
        serviceWorker: {} as never,
      },
      matchMedia: (query) => ({ matches: query === '(display-mode: fullscreen)' }),
      ...createPushApis(),
    });
    expect(environment.standalone).toBe(true);
    expect(environment.needsHomeScreen).toBe(false);
    expect(environment.apiAvailable).toBe(true);
  });

  it('detects iPadOS desktop-mode Safari as iOS that still needs the Home Screen', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: IPAD_DESKTOP_UA,
        platform: 'MacIntel',
        maxTouchPoints: 5,
        standalone: false,
        serviceWorker: {} as never,
      },
      matchMedia: () => ({ matches: false }),
      ...createPushApis(),
    });
    expect(environment.ios).toBe(true);
    expect(environment.needsHomeScreen).toBe(true);
    expect(environment.apiAvailable).toBe(false);
  });

  it('does not require Home Screen on desktop Safari', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: MAC_SAFARI_UA,
        platform: 'MacIntel',
        maxTouchPoints: 0,
        serviceWorker: {} as never,
      },
      matchMedia: () => ({ matches: false }),
      ...createPushApis(),
    });
    expect(environment.ios).toBe(false);
    expect(environment.needsHomeScreen).toBe(false);
    expect(environment.apiAvailable).toBe(true);
  });

  it('marks iOS older than 16.4 unsupported even from the Home Screen', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: IPHONE_SAFARI_16_3,
        standalone: true,
        serviceWorker: {} as never,
      },
      matchMedia: () => ({ matches: true }),
      ...createPushApis(),
    });
    expect(environment.ios).toBe(true);
    expect(environment.needsHomeScreen).toBe(false);
    expect(environment.apiAvailable).toBe(false);
  });
});

describe('registerWebPushServiceWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the same-origin worker at /sw.js', async () => {
    const { serviceWorker } = stubBrowser({ userAgent: MAC_SAFARI_UA });
    await registerWebPushServiceWorker();
    expect(serviceWorker.register).toHaveBeenCalledWith(WEB_PUSH_SERVICE_WORKER_URL, {
      scope: WEB_PUSH_SERVICE_WORKER_SCOPE,
    });
  });
});

describe('getWebPushState', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to look ready in an iPhone Safari tab', async () => {
    stubBrowser({ userAgent: IPHONE_SAFARI_18, standalone: false });
    await expect(getWebPushState()).resolves.toEqual({
      ready: false,
      subscribed: false,
      needsHomeScreen: true,
    });
  });

  it('is ready on Mac Safari after the service worker registers, without probing VAPID', async () => {
    const fetchImpl = vi.fn();
    const { serviceWorker } = stubBrowser({
      userAgent: MAC_SAFARI_UA,
      permission: 'default',
      fetchImpl,
    });
    await expect(getWebPushState()).resolves.toEqual({
      ready: true,
      subscribed: false,
      needsHomeScreen: false,
    });
    expect(serviceWorker.register).toHaveBeenCalledWith(WEB_PUSH_SERVICE_WORKER_URL, {
      scope: WEB_PUSH_SERVICE_WORKER_SCOPE,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports subscribed only when permission is granted and a subscription exists', async () => {
    stubBrowser({
      userAgent: MAC_SAFARI_UA,
      permission: 'granted',
      subscription: createSubscription(),
    });
    await expect(getWebPushState()).resolves.toEqual({
      ready: true,
      subscribed: true,
      needsHomeScreen: false,
    });
  });
});

describe('subscribeWebPush / unsubscribeWebPush', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws before requesting permission from an iPhone Safari tab', async () => {
    const requestPermission = vi.fn(async () => 'granted' as const);
    stubBrowser({
      userAgent: IPHONE_SAFARI_18,
      standalone: false,
      requestPermission,
    });
    await expect(subscribeWebPush()).rejects.toThrow('ios_home_screen_required');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('subscribes through the same-origin VAPID and subscription endpoints', async () => {
    const subscription = createSubscription();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === WEB_PUSH_VAPID_PUBLIC_KEY_PATH) {
        return Response.json({ publicKey: 'AQID' });
      }
      if (url === WEB_PUSH_SUBSCRIPTION_PATH && init?.method === 'PUT') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`);
    });
    const { registration } = stubBrowser({
      userAgent: MAC_SAFARI_UA,
      permission: 'default',
      requestPermission: vi.fn(async () => 'granted' as const),
      subscription: null,
      fetchImpl,
    });
    registration.pushManager.subscribe.mockResolvedValue(subscription);

    await subscribeWebPush();

    expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      WEB_PUSH_VAPID_PUBLIC_KEY_PATH,
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      WEB_PUSH_SUBSCRIPTION_PATH,
      expect.objectContaining({
        method: 'PUT',
        credentials: 'same-origin',
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        }),
      })
    );
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('onesignal'))).toBe(false);
  });

  it('deletes the same-origin subscription then unsubscribes', async () => {
    const subscription = createSubscription({ endpoint: 'https://push.example/old' });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === WEB_PUSH_SUBSCRIPTION_PATH && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`);
    });
    stubBrowser({
      userAgent: MAC_SAFARI_UA,
      permission: 'granted',
      subscription,
      fetchImpl,
    });

    await unsubscribeWebPush();

    expect(fetchImpl).toHaveBeenCalledWith(
      WEB_PUSH_SUBSCRIPTION_PATH,
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ endpoint: 'https://push.example/old' }),
      })
    );
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
});
