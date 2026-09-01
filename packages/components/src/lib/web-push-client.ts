export type WebPushEnvironment = {
  standalone: boolean;
  ios: boolean;
  needsHomeScreen: boolean;
  apiAvailable: boolean;
};

export type WebPushSubscriptionJson = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type WebPushState = {
  ready: boolean;
  subscribed: boolean;
  needsHomeScreen: boolean;
};

const VAPID_PUBLIC_KEY_PATH = '/push/vapid-public-key';
const SUBSCRIPTION_PATH = '/push/subscription';

type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  serviceWorker?: unknown;
};

type WindowLike = {
  navigator?: NavigatorLike;
  matchMedia?: (query: string) => { matches: boolean };
  Notification?: unknown;
  PushManager?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const urlBase64ToUint8Array = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
};

const isIosNavigator = (navigator: NavigatorLike | undefined): boolean => {
  if (!navigator) {
    return false;
  }
  const userAgent = navigator.userAgent ?? '';
  if (/iPad|iPhone|iPod/u.test(userAgent)) {
    return true;
  }
  // iPadOS 13+ reports itself as Macintosh.
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
};

export const inspectWebPushEnvironment = (host: WindowLike = window): WebPushEnvironment => {
  const navigator = host.navigator;
  const standalone =
    host.matchMedia?.('(display-mode: standalone)').matches === true || navigator?.standalone === true;
  const ios = isIosNavigator(navigator);
  const apiAvailable =
    typeof host.Notification === 'function' &&
    Boolean(navigator?.serviceWorker) &&
    typeof host.PushManager === 'function';
  return {
    standalone,
    ios,
    needsHomeScreen: ios && !standalone,
    apiAvailable,
  };
};

const toSubscriptionJson = (subscription: PushSubscription): WebPushSubscriptionJson => {
  const json = subscription.toJSON();
  const keys = isRecord(json.keys) ? json.keys : {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
  const auth = typeof keys.auth === 'string' ? keys.auth : '';
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error('Push subscription is missing endpoint or keys');
  }
  return {
    endpoint: json.endpoint,
    expirationTime: typeof json.expirationTime === 'number' ? json.expirationTime : null,
    keys: { p256dh, auth },
  };
};

const readVapidPublicKey = async (): Promise<string> => {
  const response = await fetch(VAPID_PUBLIC_KEY_PATH, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`VAPID public key request failed (${response.status})`);
  }
  const body: unknown = await response.json();
  const publicKey = isRecord(body) && typeof body.publicKey === 'string' ? body.publicKey.trim() : '';
  if (!publicKey) {
    throw new Error('VAPID public key is missing');
  }
  return publicKey;
};

const putSubscription = async (subscription: WebPushSubscriptionJson): Promise<void> => {
  const response = await fetch(SUBSCRIPTION_PATH, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(subscription),
  });
  if (!response.ok) {
    throw new Error(`Push subscription save failed (${response.status})`);
  }
};

const deleteSubscription = async (endpoint: string): Promise<void> => {
  const response = await fetch(SUBSCRIPTION_PATH, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Push subscription delete failed (${response.status})`);
  }
};

export const getWebPushState = async (): Promise<WebPushState> => {
  const environment = inspectWebPushEnvironment();
  if (environment.needsHomeScreen) {
    return { ready: false, subscribed: false, needsHomeScreen: true };
  }
  if (!environment.apiAvailable) {
    return { ready: false, subscribed: false, needsHomeScreen: false };
  }
  try {
    await readVapidPublicKey();
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return {
      ready: true,
      subscribed: Boolean(subscription) && Notification.permission === 'granted',
      needsHomeScreen: false,
    };
  } catch {
    return { ready: false, subscribed: false, needsHomeScreen: false };
  }
};

export const subscribeWebPush = async (): Promise<void> => {
  const environment = inspectWebPushEnvironment();
  if (environment.needsHomeScreen) {
    throw new Error('ios_home_screen_required');
  }
  if (!environment.apiAvailable) {
    throw new Error('web_push_unsupported');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('notification_permission_denied');
  }

  const publicKey = await readVapidPublicKey();
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  await putSubscription(toSubscriptionJson(subscription));
};

export const unsubscribeWebPush = async (): Promise<void> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }
  await deleteSubscription(subscription.endpoint);
  await subscription.unsubscribe();
};
