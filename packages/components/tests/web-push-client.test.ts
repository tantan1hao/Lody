import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inspectWebPushEnvironment,
  urlBase64ToUint8Array,
} from '../src/lib/web-push-client';

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 without padding', () => {
    const bytes = urlBase64ToUint8Array('AQID');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

describe('inspectWebPushEnvironment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires the Home Screen app on iPhone Safari', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
        standalone: false,
        serviceWorker: {},
      },
      matchMedia: () => ({ matches: false }),
      Notification: function Notification() {},
      PushManager: function PushManager() {},
    });
    expect(environment).toMatchObject({
      ios: true,
      standalone: false,
      needsHomeScreen: true,
      apiAvailable: true,
    });
  });

  it('treats an installed iOS Home Screen app as ready for push APIs', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
        standalone: true,
        serviceWorker: {},
      },
      matchMedia: () => ({ matches: true }),
      Notification: function Notification() {},
      PushManager: function PushManager() {},
    });
    expect(environment.needsHomeScreen).toBe(false);
    expect(environment.standalone).toBe(true);
  });

  it('does not require Home Screen on desktop Safari', () => {
    const environment = inspectWebPushEnvironment({
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        serviceWorker: {},
      },
      matchMedia: () => ({ matches: false }),
      Notification: function Notification() {},
      PushManager: function PushManager() {},
    });
    expect(environment.ios).toBe(false);
    expect(environment.needsHomeScreen).toBe(false);
    expect(environment.apiAvailable).toBe(true);
  });
});
