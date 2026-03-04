import { db } from "./db";
import { commissionBalances, commissionLedger } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getUncachableStripeClient } from "./stripeClient";

const COMMISSION_RATE = 0.25;
const LOW_BALANCE_THRESHOLD = 20;
const GRACE_PERIOD_HOURS = 24;
const OWNER_USER_ID = "53443452";

export class CommissionService {
  async getBalance(userId: string) {
    const [record] = await db.select().from(commissionBalances).where(eq(commissionBalances.userId, userId));
    return record || null;
  }

  async getLedger(userId: string, limit = 50) {
    return await db.select().from(commissionLedger)
      .where(eq(commissionLedger.userId, userId))
      .orderBy(desc(commissionLedger.createdAt))
      .limit(limit);
  }

  async getAllBalances() {
    return await db.select().from(commissionBalances);
  }

  async getAllLedgerEntries(limit = 100) {
    return await db.select().from(commissionLedger)
      .orderBy(desc(commissionLedger.createdAt))
      .limit(limit);
  }

  async getTotalEarned(): Promise<number> {
    const result = await db.execute(
      sql`SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM commission_ledger WHERE type = 'commission_deduction'`
    );
    return parseFloat((result.rows[0] as any)?.total || '0');
  }

  async createBalance(userId: string, stripeCustomerId?: string) {
    const existing = await this.getBalance(userId);
    if (existing) return existing;

    const [record] = await db.insert(commissionBalances).values({
      userId,
      balance: 0,
      initialDeposit: 0,
      autoTopUpEnabled: true,
      stripeCustomerId: stripeCustomerId || null,
      tradingPaused: true,
    }).returning();

    return record;
  }

  async processDeposit(userId: string, amount: number, stripePaymentIntentId?: string, description?: string) {
    const balance = await this.getBalance(userId);
    if (!balance) throw new Error("No commission account found");

    const newBalance = balance.balance + amount;
    const newInitialDeposit = balance.initialDeposit === 0 ? amount : balance.initialDeposit;

    await db.update(commissionBalances)
      .set({
        balance: newBalance,
        initialDeposit: newInitialDeposit,
        tradingPaused: false,
        gracePeriodStart: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(commissionBalances.userId, userId));

    await db.insert(commissionLedger).values({
      userId,
      type: description?.includes("Auto") ? "auto_top_up" : "deposit",
      amount: amount,
      balanceAfter: newBalance,
      stripePaymentIntentId: stripePaymentIntentId || null,
      description: description || `Deposit of £${amount.toFixed(2)}`,
    });

    console.log(`[Commission] Deposit: ${userId} +£${amount.toFixed(2)}, balance: £${newBalance.toFixed(2)}`);
    return newBalance;
  }

  async deductCommission(userId: string, tradeId: string, tradePnl: number, instrument: string): Promise<{ deducted: boolean; commission: number; newBalance: number }> {
    if (userId === OWNER_USER_ID) {
      return { deducted: false, commission: 0, newBalance: -1 };
    }

    if (tradePnl <= 0) {
      return { deducted: false, commission: 0, newBalance: -1 };
    }

    const balance = await this.getBalance(userId);
    if (!balance) {
      return { deducted: false, commission: 0, newBalance: -1 };
    }

    const commission = tradePnl * COMMISSION_RATE;
    const newBalance = balance.balance - commission;

    await db.update(commissionBalances)
      .set({
        balance: newBalance,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(commissionBalances.userId, userId));

    await db.insert(commissionLedger).values({
      userId,
      type: "commission_deduction",
      amount: -commission,
      balanceAfter: newBalance,
      tradeId,
      instrument,
      tradePnl,
      description: `25% commission on £${tradePnl.toFixed(2)} profit (${instrument})`,
    });

    console.log(`[Commission] Deducted: ${userId} -£${commission.toFixed(2)} on £${tradePnl.toFixed(2)} profit (${instrument}), balance: £${newBalance.toFixed(2)}`);

    if (newBalance < LOW_BALANCE_THRESHOLD && balance.autoTopUpEnabled && balance.stripePaymentMethodId) {
      this.triggerAutoTopUp(userId).catch(err => {
        console.error(`[Commission] Auto top-up failed for ${userId}:`, err.message);
      });
    }

    if (newBalance <= 0 && !balance.tradingPaused) {
      await db.update(commissionBalances)
        .set({
          gracePeriodStart: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(commissionBalances.userId, userId));
      console.log(`[Commission] Balance at £${newBalance.toFixed(2)} for ${userId} - grace period started`);
    }

    return { deducted: true, commission, newBalance };
  }

  async triggerAutoTopUp(userId: string): Promise<boolean> {
    const balance = await this.getBalance(userId);
    if (!balance || !balance.stripeCustomerId || !balance.stripePaymentMethodId) {
      return false;
    }

    const topUpAmount = Math.max(balance.initialDeposit - balance.balance, LOW_BALANCE_THRESHOLD);

    try {
      const stripe = await getUncachableStripeClient();

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(topUpAmount * 100),
        currency: 'gbp',
        customer: balance.stripeCustomerId,
        payment_method: balance.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          userId,
          type: 'auto_top_up',
        },
      });

      if (paymentIntent.status === 'succeeded') {
        await this.processDeposit(userId, topUpAmount, paymentIntent.id, `Auto top-up of £${topUpAmount.toFixed(2)}`);
        console.log(`[Commission] Auto top-up succeeded for ${userId}: £${topUpAmount.toFixed(2)}`);
        return true;
      }
    } catch (err: any) {
      console.error(`[Commission] Auto top-up failed for ${userId}:`, err.message);
      await db.update(commissionBalances)
        .set({
          gracePeriodStart: balance.gracePeriodStart || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(commissionBalances.userId, userId));
    }

    return false;
  }

  async checkGracePeriods() {
    const allBalances = await this.getAllBalances();
    const now = Date.now();

    for (const balance of allBalances) {
      if (balance.gracePeriodStart && !balance.tradingPaused) {
        const graceStart = new Date(balance.gracePeriodStart).getTime();
        const hoursElapsed = (now - graceStart) / (1000 * 60 * 60);

        if (hoursElapsed >= GRACE_PERIOD_HOURS) {
          await db.update(commissionBalances)
            .set({
              tradingPaused: true,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(commissionBalances.userId, balance.userId));
          console.log(`[Commission] Trading paused for ${balance.userId} - grace period expired`);
        }
      }
    }
  }

  async isTradingAllowed(userId: string): Promise<boolean> {
    if (userId === OWNER_USER_ID) return true;

    const balance = await this.getBalance(userId);
    if (!balance) return true;

    if (balance.tradingPaused) return false;

    return true;
  }

  async saveStripeCustomer(userId: string, stripeCustomerId: string) {
    await db.update(commissionBalances)
      .set({
        stripeCustomerId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(commissionBalances.userId, userId));
  }

  async savePaymentMethod(userId: string, paymentMethodId: string) {
    await db.update(commissionBalances)
      .set({
        stripePaymentMethodId: paymentMethodId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(commissionBalances.userId, userId));
  }

  isOwner(userId: string): boolean {
    return userId === OWNER_USER_ID;
  }
}

export const commissionService = new CommissionService();
