import { apiRequest } from "./queryClient";

export interface NotificationSettings {
  enabled: boolean;
  minConfidence: number;
  instruments: string[];
  soundEnabled: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  minConfidence: 70,
  instruments: ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDCHF', 'AUDUSD', 'NZDUSD'],
  soundEnabled: true
};

export function getNotificationSettings(): NotificationSettings {
  const stored = localStorage.getItem('tradeiq_notification_settings');
  if (stored) {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
  return DEFAULT_SETTINGS;
}

export function saveNotificationSettings(settings: Partial<NotificationSettings>): void {
  const current = getNotificationSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem('tradeiq_notification_settings', JSON.stringify(updated));
}

export async function checkNotificationPermission(): Promise<'granted' | 'denied' | 'default'> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('Notifications not supported');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    await subscribeToPush();
  }
  return permission === 'granted';
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service workers not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/'
    });
    console.log('Service worker registered:', registration.scope);
    return registration;
  } catch (error) {
    console.error('Service worker registration failed:', error);
    return null;
  }
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const response = await fetch('/api/push/vapid-key');
    const data = await response.json();
    return data.publicKey || null;
  } catch (error) {
    console.error('Failed to get VAPID key:', error);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeToPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const vapidKey = await getVapidPublicKey();

    if (!vapidKey) {
      console.error('No VAPID key available');
      return false;
    }

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      console.log('Push subscription created');
    }

    const settings = getNotificationSettings();

    const subscriptionJSON = subscription.toJSON();
    await apiRequest("POST", "/api/push/subscribe", {
      subscription: {
        endpoint: subscriptionJSON.endpoint,
        keys: {
          p256dh: subscriptionJSON.keys?.p256dh,
          auth: subscriptionJSON.keys?.auth,
        },
      },
      instruments: settings.instruments,
      minConfidence: settings.minConfidence,
    });

    console.log('Push subscription sent to server');
    return true;
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await apiRequest("POST", "/api/push/unsubscribe", { endpoint });
      console.log('Push subscription removed');
    }
    return true;
  } catch (error) {
    console.error('Failed to unsubscribe from push:', error);
    return false;
  }
}

export async function showLocalNotification(
  title: string,
  body: string,
  options?: {
    tag?: string;
    url?: string;
    signalId?: string;
  }
): Promise<void> {
  const settings = getNotificationSettings();
  
  if (!settings.enabled) {
    return;
  }

  const permission = await checkNotificationPermission();
  if (permission !== 'granted') {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  
  const notificationOptions: NotificationOptions & { vibrate?: number[]; renotify?: boolean; requireInteraction?: boolean; data?: unknown } = {
    body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: options?.tag || 'trade-signal',
    renotify: true,
    requireInteraction: true,
    data: {
      url: options?.url || '/signals',
      signalId: options?.signalId
    }
  };
  
  if (settings.soundEnabled) {
    notificationOptions.vibrate = [200, 100, 200];
  }
  
  await registration.showNotification(title, notificationOptions);
}

export function formatSignalNotification(signal: {
  instrument: string;
  direction: 'buy' | 'sell';
  confidence: number;
  entryZone: { min: number; max: number };
}): { title: string; body: string } {
  const action = signal.direction.toUpperCase();
  
  return {
    title: `TradeIQ: ${signal.instrument} ${action} Signal`,
    body: `Confidence: ${signal.confidence}% | Entry: ${signal.entryZone.min.toFixed(4)} - ${signal.entryZone.max.toFixed(4)}`
  };
}

let lastSeenSignals: Set<string> = new Set();

export function checkForNewSignals(
  signals: Array<{
    id: string;
    instrument: string;
    direction: 'buy' | 'sell';
    confidence: number;
    entryZone: { min: number; max: number };
  }>
): void {
  const settings = getNotificationSettings();
  
  if (!settings.enabled) {
    return;
  }

  const newSignals = signals.filter(
    (s) => 
      !lastSeenSignals.has(s.id) && 
      s.confidence >= settings.minConfidence &&
      settings.instruments.includes(s.instrument)
  );

  for (const signal of newSignals) {
    const { title, body } = formatSignalNotification(signal);
    showLocalNotification(title, body, {
      tag: `signal-${signal.id}`,
      url: '/signals',
      signalId: signal.id
    });
  }

  lastSeenSignals = new Set(signals.map((s) => s.id));
}

export async function initializeNotifications(): Promise<void> {
  const sw = await registerServiceWorker();
  if (sw && Notification.permission === 'granted') {
    const settings = getNotificationSettings();
    if (settings.enabled) {
      await subscribeToPush();
    }
  }
}
