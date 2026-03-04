import webpush from 'web-push';
import { db } from './db';
import { pushSubscriptionsTable } from '@shared/schema';
import { eq } from 'drizzle-orm';

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface StoredSubscription {
  id: string;
  subscription: PushSubscription;
  userId: string;
  instruments: string[];
  minConfidence: number;
  createdAt: string;
}

class PushNotificationService {
  private vapidConfigured = false;

  constructor() {
    this.initializeVapid();
  }

  private initializeVapid() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const email = process.env.VAPID_EMAIL || 'mailto:admin@tradeiq.app';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(email, publicKey, privateKey);
      this.vapidConfigured = true;
      console.log('[PushNotifications] VAPID configured successfully');
    } else {
      console.log('[PushNotifications] VAPID keys not configured - generating new keys');
      const keys = webpush.generateVAPIDKeys();
      console.log('[PushNotifications] Generated VAPID keys:');
      console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
      console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
      console.log('[PushNotifications] Add these to your environment variables to enable push notifications');
    }
  }

  private async loadSubscriptions(): Promise<StoredSubscription[]> {
    try {
      const rows = await db.select().from(pushSubscriptionsTable);
      return rows.map(row => ({
        id: row.id,
        subscription: {
          endpoint: row.endpoint,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth,
          },
        },
        userId: row.userId,
        instruments: (row.instruments as string[]) || ['XAUUSD', 'GBPUSD', 'EURUSD'],
        minConfidence: row.minConfidence,
        createdAt: row.createdAt,
      }));
    } catch (error) {
      console.error('[PushNotifications] Failed to load subscriptions from DB:', error);
      return [];
    }
  }

  isConfigured(): boolean {
    return this.vapidConfigured;
  }

  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY || null;
  }

  async subscribe(
    subscription: PushSubscription,
    userId: string = 'default',
    instruments: string[] = ['XAUUSD', 'GBPUSD', 'EURUSD'],
    minConfidence: number = 70
  ): Promise<{ success: boolean; id: string }> {
    try {
      const existing = await db.select().from(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.endpoint, subscription.endpoint));

      const clampedConfidence = Math.max(50, Math.min(95, minConfidence));

      if (existing.length > 0) {
        await db.update(pushSubscriptionsTable)
          .set({
            userId,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            instruments: instruments,
            minConfidence: clampedConfidence,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(pushSubscriptionsTable.endpoint, subscription.endpoint));
        console.log(`[PushNotifications] Subscription updated for user ${userId}: ${existing[0].id}`);
        return { success: true, id: existing[0].id };
      }

      const [inserted] = await db.insert(pushSubscriptionsTable).values({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        instruments: instruments,
        minConfidence: clampedConfidence,
      }).returning();

      console.log(`[PushNotifications] Subscription registered for user ${userId}: ${inserted.id}`);
      return { success: true, id: inserted.id };
    } catch (error) {
      console.error('[PushNotifications] Failed to save subscription:', error);
      return { success: false, id: '' };
    }
  }

  async unsubscribe(endpoint: string): Promise<boolean> {
    try {
      const result = await db.delete(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.endpoint, endpoint));
      console.log(`[PushNotifications] Subscription removed: ${endpoint.slice(0, 50)}...`);
      return true;
    } catch (error) {
      console.error('[PushNotifications] Failed to remove subscription:', error);
      return false;
    }
  }

  async updatePreferences(
    endpoint: string,
    instruments: string[],
    minConfidence: number
  ): Promise<boolean> {
    try {
      await db.update(pushSubscriptionsTable)
        .set({
          instruments: instruments,
          minConfidence: Math.max(50, Math.min(95, minConfidence)),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(pushSubscriptionsTable.endpoint, endpoint));
      console.log(`[PushNotifications] Updated preferences: instruments=${instruments.join(',')}, minConfidence=${minConfidence}%`);
      return true;
    } catch (error) {
      console.error('[PushNotifications] Failed to update preferences:', error);
      return false;
    }
  }

  async sendSignalNotification(signal: {
    instrument: string;
    timeframe: string;
    direction: string;
    confidence: number;
    entryZone: { low: number; high: number };
    stopLoss: number;
    takeProfit1: number;
  }): Promise<number> {
    if (!this.vapidConfigured) {
      console.log('[PushNotifications] VAPID not configured - skipping notification');
      return 0;
    }

    const allSubs = await this.loadSubscriptions();
    
    if (allSubs.length === 0) {
      console.log(`[PushNotifications] No subscribers registered - signal ${signal.instrument} ${signal.direction} not sent`);
      return 0;
    }

    let sentCount = 0;
    const failedEndpoints: string[] = [];

    for (const storedSub of allSubs) {
      if (
        signal.confidence >= storedSub.minConfidence &&
        storedSub.instruments.includes(signal.instrument)
      ) {
        const payload = JSON.stringify({
          title: `${signal.direction.toUpperCase()} ${signal.instrument} ${signal.timeframe}`,
          body: `${signal.confidence}% confidence • Entry: ${signal.entryZone.low.toFixed(2)}-${signal.entryZone.high.toFixed(2)} • TP1: ${signal.takeProfit1.toFixed(2)}`,
          tag: `signal-${signal.instrument}-${signal.timeframe}`,
          url: '/',
          signalId: `${signal.instrument}-${signal.timeframe}-${Date.now()}`,
          instrument: signal.instrument,
          direction: signal.direction,
          timeframe: signal.timeframe,
          tradeAction: 'confirm'
        });

        try {
          await webpush.sendNotification(storedSub.subscription, payload);
          sentCount++;
          console.log(`[PushNotifications] Sent to ${storedSub.userId}: ${signal.instrument} ${signal.direction} (${signal.confidence}%)`);
        } catch (error: any) {
          console.error(`[PushNotifications] Failed to send to ${storedSub.id}:`, error.message);
          if (error.statusCode === 410 || error.statusCode === 404) {
            failedEndpoints.push(storedSub.subscription.endpoint);
          }
        }
      } else {
        console.log(`[PushNotifications] Skipped ${storedSub.userId}: confidence ${signal.confidence} < ${storedSub.minConfidence} or instrument ${signal.instrument} not in ${storedSub.instruments.join(',')}`);
      }
    }

    for (const endpoint of failedEndpoints) {
      await this.unsubscribe(endpoint);
    }

    console.log(`[PushNotifications] Signal notification summary: sent=${sentCount}, failed=${failedEndpoints.length}, total_subs=${allSubs.length}`);
    return sentCount;
  }

  async getSubscriptionCount(): Promise<number> {
    try {
      const rows = await db.select().from(pushSubscriptionsTable);
      return rows.length;
    } catch {
      return 0;
    }
  }

  async getSubscriptions(): Promise<StoredSubscription[]> {
    return this.loadSubscriptions();
  }

  async getSubscriptionsForUser(userId: string): Promise<StoredSubscription[]> {
    try {
      const rows = await db.select().from(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.userId, userId));
      return rows.map(row => ({
        id: row.id,
        subscription: {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        userId: row.userId,
        instruments: (row.instruments as string[]) || [],
        minConfidence: row.minConfidence,
        createdAt: row.createdAt,
      }));
    } catch {
      return [];
    }
  }

  async sendUserNotification(
    userId: string,
    title: string,
    body: string,
    tag?: string,
    url?: string,
    extraData?: Record<string, any>
  ): Promise<number> {
    if (!this.vapidConfigured) {
      return 0;
    }

    const userSubs = await this.getSubscriptionsForUser(userId);
    if (userSubs.length === 0) {
      console.log(`[PushNotifications] No subscriptions for user ${userId.slice(0, 8)}... - notification not sent: ${title}`);
      return 0;
    }

    let sentCount = 0;
    const failedEndpoints: string[] = [];

    for (const storedSub of userSubs) {
      const payload = JSON.stringify({
        title,
        body,
        tag: tag || 'tradeiq-notification',
        url: url || '/',
        ...extraData,
      });

      try {
        await webpush.sendNotification(storedSub.subscription, payload);
        sentCount++;
        console.log(`[PushNotifications] Sent to user ${userId.slice(0, 8)}...: ${title}`);
      } catch (error: any) {
        console.error(`[PushNotifications] Failed to send to ${storedSub.id}:`, error.message);
        if (error.statusCode === 410 || error.statusCode === 404) {
          failedEndpoints.push(storedSub.subscription.endpoint);
        }
      }
    }

    for (const endpoint of failedEndpoints) {
      await this.unsubscribe(endpoint);
    }

    return sentCount;
  }

  async sendTradeNotification(
    userId: string,
    instrument: string,
    direction: string,
    outcome: 'executed' | 'opened' | 'tp_hit' | 'sl_hit' | 'closed' | 'expired' | 'scalp_opened' | 'scalp_closed',
    pnlPips?: number,
    extra?: string,
    tradeId?: string
  ): Promise<number> {
    let title: string;
    let body: string;

    switch (outcome) {
      case 'executed':
        title = `Trade Executed: ${direction.toUpperCase()} ${instrument}`;
        body = 'Your trade has been placed on OANDA';
        break;
      case 'opened':
        title = `New Trade: ${direction.toUpperCase()} ${instrument}`;
        body = extra || 'Simulated trade opened from signal';
        break;
      case 'tp_hit':
        title = `WIN: ${instrument} TP Hit!`;
        body = pnlPips ? `+${pnlPips.toFixed(1)} pips profit` : 'Take profit target reached';
        break;
      case 'sl_hit':
        if (pnlPips !== undefined && pnlPips > 0) {
          title = `WIN: ${instrument} SL Hit (Trailing)`;
          body = `+${pnlPips.toFixed(1)} pips profit (stop moved to profit)`;
        } else if (pnlPips !== undefined && pnlPips === 0) {
          title = `BREAK-EVEN: ${instrument} SL Hit`;
          body = `0 pips — break-even stop triggered`;
        } else {
          title = `LOSS: ${instrument} SL Hit`;
          body = pnlPips ? `${Math.abs(pnlPips).toFixed(1)} pips loss` : 'Stop loss triggered';
        }
        break;
      case 'closed':
        title = `Trade Closed: ${instrument}`;
        body = pnlPips ? `P/L: ${pnlPips > 0 ? '+' : ''}${pnlPips.toFixed(1)} pips` : 'Trade has been closed';
        break;
      case 'expired':
        title = `Trade Expired: ${instrument}`;
        body = pnlPips ? `Closed at ${pnlPips > 0 ? '+' : ''}${pnlPips.toFixed(1)} pips (time limit)` : 'Trade expired due to time limit';
        break;
      case 'scalp_opened':
        title = `Scalp Entry: ${direction.toUpperCase()} ${instrument}`;
        body = extra || 'Instant Profit Trapper opened a position';
        break;
      case 'scalp_closed':
        title = pnlPips && pnlPips > 0 ? `Scalp Win: ${instrument}` : `Scalp Closed: ${instrument}`;
        body = pnlPips ? `${pnlPips > 0 ? '+' : ''}${pnlPips.toFixed(1)} pips` : 'Scalp trade closed';
        break;
    }

    const extraData: Record<string, any> = {};
    if (outcome === 'opened') {
      extraData.instrument = instrument;
      extraData.direction = direction;
      extraData.tradeAction = 'confirm';
      if (tradeId) extraData.tradeId = tradeId;
      extraData.actions = [
        { action: 'take_trade', title: 'Take Trade' },
        { action: 'dismiss', title: 'Dismiss' }
      ];
    }

    return this.sendUserNotification(userId, title, body, `trade-${instrument}`, '/', extraData);
  }

  async sendToUser(userId: string, data: { title: string; body: string; tag?: string; url?: string }): Promise<number> {
    return this.sendUserNotification(userId, data.title, data.body, data.tag, data.url);
  }
}

export const pushNotificationService = new PushNotificationService();
