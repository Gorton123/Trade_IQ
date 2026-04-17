import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { getRealtimeQuote, getCandles, rateLimitedFetch } from "./alpha-vantage";
import { analyzeMarket, generateSignal, analyzeSmartMoney, updateActiveStrategyProfile, updateInstrumentProfile, isInstrumentApprovedForTrading, isInstrumentRejected, getApprovedInstrumentTimeframes, type StrategyParameters } from "./analysis";
import { twelveDataService } from "./twelvedata-prices";
import { historicalDataService } from "./historical-data";
import { patternRecognitionService } from "./pattern-recognition";
import { backtestingEngine } from "./backtesting";
import { batchBacktestingService } from "./batch-backtesting";
import { strategyOptimizer } from "./strategy-optimizer";
import { autoOptimizer, runRealityCheck, startRealityCheckTimer, getRealityCheckStats, getRealityCheckStatsForCombo, type RealityCheckStats } from "./auto-optimizer";
import { divergenceDetectionService } from "./divergence-detection";
import { pushNotificationService } from "./push-notifications";
import { encryptApiKey, decryptApiKey, isEncrypted } from "./encryption";
import { 
  oandaService, 
  oandaTestConnection, 
  oandaGetAccountSummary, 
  oandaGetOpenTrades,
  oandaGetTradeDetails,
  oandaCloseTrade,
  oandaPlaceMarketOrder,
  oandaModifyTradeStopLoss,
  oandaGetTransactionsByDateRange,
  oandaGetCurrentPrice,
  type OandaCredentials 
} from "./oanda";
import { microScalperManager, backtestScalper, getSessionInfo } from "./micro-scalper";
import { startTelegramBot, isTelegramBotRunning, getRecentTelegramSignals, parseTelegramSignal } from "./telegram-bot";
import { db } from "./db";
import { 
  instruments, 
  timeframes,
  positionSizeInputSchema,
  tradeJournalTable,
  signalHistoryTable,
  userOandaCredentials,
  userAuditLogTable,
  userSettingsTable,
  timeframeStrategyProfiles,
  insertTradeJournalSchema,
  insertSignalHistorySchema,
  type Instrument, 
  type Timeframe,
  type SimulatedTrade,
  type TradeSignal,
  type SignalConditions,
  type MarketAnalysis,
  type WhaleZoneData,
  type InstitutionalLevel,
  type OrderBlock,
  type LiquidityHunt,
  type EconomicEvent,
  type InsertTradeJournal,
  type InsertSignalHistory,
  autoOptimizedProfiles,
  microScalperTradesTable,
  microScalperSettingsTable,
  simulatedTradesTable,
  oandaActivityLogTable,
  oandaBalanceSnapshots,
} from "@shared/schema";
import { z } from "zod";
import { randomUUID } from "crypto";
import { desc, eq, and, isNull, isNotNull, ne, or, sql, gte, lte } from "drizzle-orm";
import { users } from "@shared/models/auth";
import { commissionService } from "./commission";
import { strategyIntelligence } from "./strategy-intelligence";
import { commissionBalances, commissionLedger, quizProgress } from "@shared/schema";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";

// Helper: Get user ID from authenticated request
function getUserId(req: Request): string | null {
  const user = req.user as any;
  return user?.claims?.sub || null;
}

// Helper: Log user action to audit table
async function logUserAction(userId: string, action: string, details?: Record<string, any>, req?: Request) {
  try {
    await db.insert(userAuditLogTable).values({
      userId,
      action,
      details: details || null,
      ipAddress: req?.ip || req?.headers?.["x-forwarded-for"]?.toString() || null,
      userAgent: req?.headers?.["user-agent"] || null,
    });
  } catch (error) {
    console.error("[Audit] Failed to log action:", error);
  }
}

async function logOandaActivity(userId: string, action: string, opts: {
  instrument?: string; direction?: string; details?: string; tradeId?: string;
  pnl?: number; units?: number; source?: string;
} = {}) {
  try {
    await db.insert(oandaActivityLogTable).values({
      userId, action,
      instrument: opts.instrument || null,
      direction: opts.direction || null,
      details: opts.details || null,
      tradeId: opts.tradeId || null,
      pnl: opts.pnl ?? null,
      units: opts.units ?? null,
      source: opts.source || "system",
    });
  } catch (error) {
    console.error("[OandaLog] Failed:", error);
  }
}

interface GuardianConfig {
  maxTradeDurationHours: number;
  dailyLossLimitPercent: number;
  enabled: boolean;
  timeframeDurations: Record<string, number> | null;
}

let guardianInterval: NodeJS.Timeout | null = null;
const guardianPausedUsers: Set<string> = new Set();
const guardianRecentlyClosed: Set<string> = new Set();

function isForexMarketOpen(): boolean {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();
  if (utcDay === 6) return false;
  if (utcDay === 0 && utcHour < 22) return false;
  if (utcDay === 5 && utcHour >= 22) return false;
  return true;
}

async function getGuardianConfigFromDB(userId: string): Promise<GuardianConfig> {
  try {
    const [settings] = await db.select({
      guardianEnabled: userSettingsTable.guardianEnabled,
      maxTradeDurationHours: userSettingsTable.maxTradeDurationHours,
      dailyLossLimitPercent: userSettingsTable.dailyLossLimitPercent,
      timeframeDurations: userSettingsTable.timeframeDurations,
    }).from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
    
    if (settings) {
      return {
        enabled: settings.guardianEnabled,
        maxTradeDurationHours: settings.maxTradeDurationHours,
        dailyLossLimitPercent: settings.dailyLossLimitPercent,
        timeframeDurations: settings.timeframeDurations as Record<string, number> | null,
      };
    }
  } catch {}
  return { maxTradeDurationHours: 8, dailyLossLimitPercent: 5, enabled: true, timeframeDurations: null };
}

const TIMEFRAME_DURATION_LIMITS: Record<string, number> = {
  "1m": 3,
  "5m": 4,
  "15m": 6,
  "1h": 12,
  "4h": 24,
  "1D": 72,
  "1W": 168,
  "1M": 720,
};

function getTimeframeAwareDuration(timeframe: string | null, userMaxHours: number, userTimeframeDurations?: Record<string, number> | null): number {
  if (!timeframe) {
    return userMaxHours;
  }
  if (userTimeframeDurations && userTimeframeDurations[timeframe] != null) {
    return userTimeframeDurations[timeframe];
  }
  if (TIMEFRAME_DURATION_LIMITS[timeframe]) {
    return TIMEFRAME_DURATION_LIMITS[timeframe];
  }
  return userMaxHours;
}

async function runOandaGuardian() {
  if (!isForexMarketOpen()) {
    return;
  }
  try {
    const allCreds = await db.select().from(userOandaCredentials).where(eq(userOandaCredentials.isConnected, true));
    
    for (const cred of allCreds) {
      try {
        let apiKey = cred.apiKey;
        if (isEncrypted(apiKey)) {
          try { apiKey = decryptApiKey(apiKey); } catch { continue; }
        }
        
        const oCreds: OandaCredentials = {
          apiKey,
          accountId: cred.accountId,
          isLive: cred.environment === "live"
        };
        
        const config = await getGuardianConfigFromDB(cred.userId);
        if (!config.enabled) continue;

        const summary = await oandaGetAccountSummary(oCreds);
        if (summary) {
          const balance = parseFloat(summary.balance || "0");
          const unrealizedPL = parseFloat(summary.unrealizedPL || "0");
          const dailyLossLimit = balance * (config.dailyLossLimitPercent / 100);

          if (unrealizedPL < 0 && Math.abs(unrealizedPL) >= dailyLossLimit) {
            if (!guardianPausedUsers.has(cred.userId)) {
              guardianPausedUsers.add(cred.userId);
              console.log(`[Guardian] Daily loss limit hit for user ${cred.userId.slice(0,8)}: ${unrealizedPL.toFixed(2)} >= -${dailyLossLimit.toFixed(2)}`);
              await logOandaActivity(cred.userId, "daily_loss_limit_hit", {
                details: `Unrealized P&L: ${unrealizedPL.toFixed(2)}, limit: -${dailyLossLimit.toFixed(2)} (${config.dailyLossLimitPercent}% of ${balance.toFixed(2)})`,
                pnl: unrealizedPL,
                source: "guardian",
              });
              try {
                pushNotificationService.sendToUser(cred.userId, {
                  title: "Daily Loss Limit Reached",
                  body: `Loss of ${Math.abs(unrealizedPL).toFixed(2)} has hit your ${config.dailyLossLimitPercent}% daily limit. New trades paused.`,
                  tag: "daily-loss-limit",
                });
              } catch {}
            }
          } else {
            guardianPausedUsers.delete(cred.userId);
          }
        }
        
        const trades = await oandaGetOpenTrades(oCreds);
        if (!trades || trades.length === 0) continue;

        const now = Date.now();

        const linkedSimTrades = await storage.getSimulatedTrades();
        const oandaToTimeframe = new Map<string, string>();
        for (const st of linkedSimTrades) {
          if (st.oandaTradeId && st.timeframe) {
            oandaToTimeframe.set(st.oandaTradeId, st.timeframe);
          }
        }

        for (const trade of trades) {
          const openTime = new Date(trade.openTime || "").getTime();
          const ageMs = now - openTime;
          const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(1);

          const tradeTimeframe = oandaToTimeframe.get(trade.id) || null;
          const effectiveMaxHours = getTimeframeAwareDuration(tradeTimeframe, config.maxTradeDurationHours, config.timeframeDurations);
          const maxDurationMs = effectiveMaxHours * 60 * 60 * 1000;

          if (ageMs > maxDurationMs) {
            if (guardianRecentlyClosed.has(trade.id)) {
              continue;
            }
            const unrealizedPL = parseFloat(trade.unrealizedPL || "0");
            const hardCapMs = maxDurationMs * 2;
            const isInProfit = unrealizedPL > 0;
            const exceededHardCap = ageMs > hardCapMs;

            if (!isInProfit && !exceededHardCap) {
              console.log(`[Guardian] Trade ${trade.id} (${trade.instrument}${tradeTimeframe ? ` ${tradeTimeframe}` : ''}) expired ${ageHours}h > max ${effectiveMaxHours}h but at loss (P&L: ${unrealizedPL.toFixed(2)}). Leaving to recover or hit SL.`);
              continue;
            }

            const closeReason = isInProfit 
              ? `in profit (P&L: ${unrealizedPL.toFixed(2)})` 
              : `exceeded 2x safety cap (${ageHours}h > ${(effectiveMaxHours * 2)}h)`;
            console.log(`[Guardian] CLOSING overdue trade ${trade.id} (${trade.instrument}${tradeTimeframe ? ` ${tradeTimeframe}` : ''}) - open ${ageHours}h > max ${effectiveMaxHours}h, ${closeReason}`);
            guardianRecentlyClosed.add(trade.id);
            setTimeout(() => guardianRecentlyClosed.delete(trade.id), 5 * 60 * 1000);
            try {
              const result = await oandaCloseTrade(oCreds, trade.id);
              await logOandaActivity(cred.userId, "guardian_close", {
                instrument: trade.instrument,
                direction: parseFloat(trade.initialUnits || trade.currentUnits) > 0 ? "buy" : "sell",
                tradeId: trade.id,
                details: `Auto-closed after ${ageHours}h (max: ${effectiveMaxHours}h${tradeTimeframe ? `, timeframe: ${tradeTimeframe}` : ''})`,
                pnl: parseFloat(trade.unrealizedPL || "0"),
                units: Math.abs(parseInt(trade.currentUnits || trade.initialUnits || "0")),
                source: "guardian",
              });

              const guardianLinkedSim = linkedSimTrades.find(st => st.oandaTradeId === trade.id && st.status === "open");
              if (guardianLinkedSim) {
                try {
                  const freshGuardianTrades = await storage.getSimulatedTrades();
                  const freshGuardianSim = freshGuardianTrades.find(t => t.id === guardianLinkedSim.id);
                  if (!freshGuardianSim || freshGuardianSim.status !== "open") {
                    console.log(`[Guardian] Sim trade ${guardianLinkedSim.id.slice(0, 8)} already closed, skipping sync`);
                  } else {
                  const guardianTradeDetails = await oandaGetTradeDetails(oCreds, trade.id);
                  let guardianClosePrice: number | null = guardianTradeDetails?.closePrice ?? null;
                  if (!guardianClosePrice) {
                    const gAnalysis = storage.getCachedAnalysis(guardianLinkedSim.instrument, guardianLinkedSim.timeframe);
                    if (gAnalysis) guardianClosePrice = gAnalysis.currentPrice;
                  }
                  if (guardianClosePrice) {
                    const gPipSize = guardianLinkedSim.instrument === "XAUUSD" ? 0.1 : guardianLinkedSim.instrument === "XAGUSD" ? 0.01 : guardianLinkedSim.instrument.includes("JPY") ? 0.01 : 0.0001;
                    const gPnlPips = guardianLinkedSim.direction === "buy"
                      ? (guardianClosePrice - guardianLinkedSim.entryPrice) / gPipSize
                      : (guardianLinkedSim.entryPrice - guardianClosePrice) / gPipSize;
                    const gSlDist = Math.abs(guardianLinkedSim.entryPrice - guardianLinkedSim.stopLoss);
                    const gTargetPips = gSlDist / gPipSize;
                    const gPnlPercent = gTargetPips > 0 ? (gPnlPips / gTargetPips) * 100 : 0;
                    const gAcct = await storage.getPaperAccount(cred.userId);
                    const gMoneyPnl = guardianLinkedSim.lotSize ? calculateMoneyPnL(gPnlPips, guardianLinkedSim.lotSize, guardianLinkedSim.instrument, gAcct.currency, guardianClosePrice) : undefined;
                    await storage.updateSimulatedTrade(guardianLinkedSim.id, {
                      status: "manual_close",
                      closedAt: new Date().toISOString(),
                      closePrice: guardianClosePrice,
                      pnlPips: Math.round(gPnlPips * 10) / 10,
                      pnlPercent: Math.round(gPnlPercent * 100) / 100,
                      pnlMoney: gMoneyPnl,
                    });
                    if (gMoneyPnl !== undefined) {
                      const gNewBal = gAcct.currentBalance + gMoneyPnl;
                      const gNewPk = Math.max(gAcct.peakBalance, gNewBal);
                      const gDd = gNewPk > 0 ? ((gNewPk - gNewBal) / gNewPk) * 100 : 0;
                      await storage.updatePaperAccount({
                        currentBalance: Math.round(gNewBal * 100) / 100,
                        peakBalance: Math.round(gNewPk * 100) / 100,
                        maxDrawdown: Math.round(Math.max(gAcct.maxDrawdown, gDd) * 100) / 100,
                      }, cred.userId);
                    }
                    console.log(`[Guardian] Immediately synced sim trade ${guardianLinkedSim.id.slice(0, 8)} for closed OANDA trade ${trade.id}`);
                    deductCommissionIfApplicable(cred.userId, guardianLinkedSim.id, gMoneyPnl, guardianLinkedSim.instrument).catch(() => {});
                  }
                  }
                } catch (syncErr) {
                  console.warn(`[Guardian] Immediate sim sync failed for trade ${trade.id}:`, (syncErr as Error).message);
                }
              }

              try {
                const guardianPL = parseFloat(trade.unrealizedPL || "0");
                const guardianCloseMsg = guardianPL > 0
                  ? `${trade.instrument} profit locked after ${ageHours}h (max ${effectiveMaxHours}h). P&L: +${guardianPL.toFixed(2)}`
                  : `${trade.instrument} force-closed after ${ageHours}h (2x safety cap: ${(effectiveMaxHours * 2)}h). P&L: ${guardianPL.toFixed(2)}`;
                pushNotificationService.sendToUser(cred.userId, {
                  title: guardianPL > 0 ? "Trade Guardian: Profit Locked" : "Trade Guardian: Safety Close",
                  body: guardianCloseMsg,
                  tag: `guardian-close-${trade.id}`,
                });
              } catch {}
            } catch (closeErr) {
              console.error(`[Guardian] Failed to close trade ${trade.id}:`, closeErr);
              guardianRecentlyClosed.delete(trade.id);
              await logOandaActivity(cred.userId, "guardian_close_failed", {
                tradeId: trade.id,
                instrument: trade.instrument,
                details: `Failed after ${ageHours}h: ${(closeErr as Error).message}`,
                source: "guardian",
              });
            }
          }
        }

      } catch (userErr) {
        console.error(`[Guardian] Error for user ${cred.userId}:`, userErr);
      }
    }
  } catch (err) {
    console.error("[Guardian] Scan error:", err);
  }
}

function isUserPausedByGuardian(userId: string): boolean {
  return guardianPausedUsers.has(userId);
}

function startOandaGuardian() {
  if (guardianInterval) return;
  console.log("[Guardian] Starting OANDA Trade Guardian (checks every 60s)");
  guardianInterval = setInterval(async () => {
    await runOandaGuardian();
    commissionService.checkGracePeriods().catch(err => console.error("[Commission] Grace period check error:", err));
  }, 60 * 1000);
  setTimeout(runOandaGuardian, 5000);
}

startOandaGuardian();

let snapshotInterval: NodeJS.Timeout | null = null;

async function snapshotOandaBalances() {
  try {
    const allCreds = await db.select().from(userOandaCredentials).where(eq(userOandaCredentials.isConnected, true));
    for (const cred of allCreds) {
      try {
        const decryptedKey = isEncrypted(cred.apiKey) ? decryptApiKey(cred.apiKey) : cred.apiKey;
        const oandaCreds: OandaCredentials = {
          apiKey: decryptedKey,
          accountId: cred.accountId,
          isLive: cred.environment === "live"
        };
        const ok = await oandaTestConnection(oandaCreds);
        if (!ok) continue;
        const account = await oandaGetAccountSummary(oandaCreds);
        const trades = await oandaGetOpenTrades(oandaCreds);

        const bal = parseFloat(account.balance);
        const eq = parseFloat(account.NAV || account.balance);
        const upl = parseFloat(account.unrealizedPL || "0");
        if (isNaN(bal) || isNaN(eq)) continue;

        await db.insert(oandaBalanceSnapshots).values({
          id: randomUUID(),
          userId: cred.userId,
          balance: bal,
          equity: eq,
          unrealizedPL: isNaN(upl) ? 0 : upl,
          openTradeCount: trades.length,
          currency: account.currency || "GBP",
          environment: cred.environment,
          snapshotAt: new Date().toISOString(),
        });
      } catch (e) {
        // skip failed users silently
      }
    }
  } catch (err) {
    console.error("[Snapshot] Balance snapshot error:", err);
  }
}

function startBalanceSnapshots() {
  if (snapshotInterval) return;
  console.log("[Snapshot] Starting OANDA balance snapshots (every 15min)");
  snapshotInterval = setInterval(snapshotOandaBalances, 15 * 60 * 1000);
  setTimeout(snapshotOandaBalances, 10000);
}

startBalanceSnapshots();

// Helper: Get user's OANDA credentials from database (with decryption)
async function getUserOandaCredentials(userId: string) {
  const [creds] = await db.select().from(userOandaCredentials).where(eq(userOandaCredentials.userId, userId));
  if (!creds) return null;
  
  // Decrypt API key if encrypted
  let apiKey = creds.apiKey;
  if (isEncrypted(apiKey)) {
    try {
      apiKey = decryptApiKey(apiKey);
    } catch (error) {
      console.error("[OANDA] Failed to decrypt API key for user:", userId);
      return null;
    }
  }
  
  return { ...creds, apiKey };
}

// Helper: Save user's OANDA credentials to database (with encryption)
async function saveUserOandaCredentials(userId: string, apiKey: string, accountId: string, environment: string) {
  const existing = await db.select().from(userOandaCredentials).where(eq(userOandaCredentials.userId, userId));
  
  // Encrypt the API key before storage
  const encryptedApiKey = encryptApiKey(apiKey);
  
  if (existing.length > 0) {
    await db.update(userOandaCredentials)
      .set({ 
        apiKey: encryptedApiKey, 
        accountId, 
        environment,
        isConnected: true,
        lastConnected: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .where(eq(userOandaCredentials.userId, userId));
  } else {
    await db.insert(userOandaCredentials).values({
      userId,
      apiKey: encryptedApiKey,
      accountId,
      environment,
      isConnected: true,
      lastConnected: new Date().toISOString(),
    });
  }
}

// Helper: Mark user's OANDA as disconnected
async function disconnectUserOanda(userId: string) {
  await db.update(userOandaCredentials)
    .set({ isConnected: false, updatedAt: new Date().toISOString() })
    .where(eq(userOandaCredentials.userId, userId));
}

// Helper: Get or create user settings
async function getUserSettings(userId: string) {
  const [settings] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
  if (settings) return settings;
  
  // Create default settings for user with explicit UUID
  try {
    const [newSettings] = await db.insert(userSettingsTable)
      .values({ id: randomUUID(), userId })
      .returning();
    return newSettings;
  } catch (err: any) {
    // Handle race condition - another process created it
    if (err.code === '23505') {
      const [existing] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
      return existing;
    }
    throw err;
  }
}

// Helper: Deduct commission on profitable trade closure (live OANDA accounts only)
async function deductCommissionIfApplicable(userId: string | null | undefined, tradeId: string, pnlMoney: number | undefined, instrument: string) {
  if (!userId || pnlMoney === undefined || pnlMoney <= 0) return;
  
  try {
    // Check if user has a live OANDA account
    const [creds] = await db.select().from(userOandaCredentials).where(eq(userOandaCredentials.userId, userId));
    if (!creds || creds.environment !== "live" || !creds.isConnected) return;

    const result = await commissionService.deductCommission(userId, tradeId, pnlMoney, instrument);
    if (result.deducted) {
      console.log(`[Commission] Deducted £${result.commission.toFixed(2)} from ${userId.slice(0, 8)}... (trade ${tradeId.slice(0, 8)})`);
    }
  } catch (err: any) {
    console.error(`[Commission] Deduction error for ${userId}:`, err.message);
  }
}

// Helper: Auto-execute a signal on OANDA for all users with auto-trade enabled
async function autoExecuteForAllUsers(signal: TradeSignal, entryPrice: number, userSimTradeIds?: Map<string, string>) {
  try {
    const allUsersWithAutoTrade = await db.select()
      .from(userSettingsTable)
      .where(eq(userSettingsTable.autoExecuteEnabled, true));
    
    if (allUsersWithAutoTrade.length === 0) {
      console.log(`[AutoExecute] No users with auto-execute enabled`);
      return;
    }
    console.log(`[AutoExecute] Found ${allUsersWithAutoTrade.length} user(s) with auto-execute enabled for ${signal.instrument} ${signal.direction}`);
    
    for (const userSettings of allUsersWithAutoTrade) {
      if (!userSettings.userId) continue;
      
      // Check OANDA-specific filters first, fall back to simulation filters
      const oandaInstruments = userSettings.oandaInstruments as string[] | null;
      const simInstruments = userSettings.simulationInstruments as string[] | null;
      const allowedInstruments = (oandaInstruments && oandaInstruments.length > 0) ? oandaInstruments : simInstruments;

      if (allowedInstruments && allowedInstruments.length > 0 && !allowedInstruments.includes(signal.instrument)) {
        console.log(`[AutoExecute] BLOCKED ${signal.instrument} for user ${userSettings.userId.slice(0, 8)}... - restricted by instrument filter`);
        continue;
      }

      const oandaTimeframes = userSettings.oandaTimeframes as string[] | null;
      const simTimeframes = userSettings.simulationTimeframes as string[] | null;
      const allowedTimeframes = (oandaTimeframes && oandaTimeframes.length > 0) ? oandaTimeframes : simTimeframes;

      if (allowedTimeframes && allowedTimeframes.length > 0 && !allowedTimeframes.includes(signal.timeframe)) {
        console.log(`[AutoExecute] BLOCKED ${signal.instrument} ${signal.timeframe} for user ${userSettings.userId.slice(0, 8)}... - restricted by timeframe filter`);
        continue;
      }
      
      try {
        // Check commission balance for live accounts
        const tradingAllowed = await commissionService.isTradingAllowed(userSettings.userId);
        if (!tradingAllowed) {
          console.log(`[AutoExecute] BLOCKED for user ${userSettings.userId.slice(0, 8)}... - commission balance depleted`);
          continue;
        }

        if (isUserPausedByGuardian(userSettings.userId)) {
          console.log(`[AutoExecute] BLOCKED for user ${userSettings.userId.slice(0, 8)}... - daily loss limit reached`);
          continue;
        }

        const dbCreds = await getUserOandaCredentials(userSettings.userId);
        if (!dbCreds || !dbCreds.isConnected || !dbCreds.apiKey) continue;
        
        const creds: OandaCredentials = {
          apiKey: dbCreds.apiKey,
          accountId: dbCreds.accountId,
          isLive: dbCreds.environment === "live"
        };
        
        const existingTrades = await oandaGetOpenTrades(creds);
        const oandaOpenIds = new Set(existingTrades.map((t: any) => t.id));

        const aeUserOpenTrades = await storage.getOpenSimulatedTrades(userSettings.userId);
        let fastSyncClosed = 0;
        for (const simTrade of aeUserOpenTrades) {
          if (simTrade.oandaTradeId && !oandaOpenIds.has(simTrade.oandaTradeId)) {
            try {
              const freshTrades = await storage.getSimulatedTrades();
              const freshTrade = freshTrades.find(t => t.id === simTrade.id);
              if (!freshTrade || freshTrade.status !== "open") {
                continue;
              }
              const tradeDetails = await oandaGetTradeDetails(creds, simTrade.oandaTradeId);
              let closePrice: number | null = tradeDetails?.closePrice ?? null;
              if (!closePrice) {
                const analysis = storage.getCachedAnalysis(simTrade.instrument, simTrade.timeframe);
                if (analysis) closePrice = analysis.currentPrice;
              }
              if (closePrice) {
                const pipSize = simTrade.instrument === "XAUUSD" ? 0.1 : simTrade.instrument === "XAGUSD" ? 0.01 : simTrade.instrument.includes("JPY") ? 0.01 : 0.0001;
                const pnlPips = simTrade.direction === "buy"
                  ? (closePrice - simTrade.entryPrice) / pipSize
                  : (simTrade.entryPrice - closePrice) / pipSize;
                const slDist = Math.abs(simTrade.entryPrice - simTrade.stopLoss);
                const targetPips = slDist / pipSize;
                const pnlPercent = targetPips > 0 ? (pnlPips / targetPips) * 100 : 0;
                const acct = await storage.getPaperAccount(userSettings.userId);
                const moneyPnl = simTrade.lotSize ? calculateMoneyPnL(pnlPips, simTrade.lotSize, simTrade.instrument, acct.currency, closePrice) : undefined;
                await storage.updateSimulatedTrade(simTrade.id, {
                  status: "manual_close",
                  closedAt: new Date().toISOString(),
                  closePrice,
                  pnlPips: Math.round(pnlPips * 10) / 10,
                  pnlPercent: Math.round(pnlPercent * 100) / 100,
                  pnlMoney: moneyPnl,
                });
                if (moneyPnl !== undefined) {
                  const newBal = acct.currentBalance + moneyPnl;
                  const newPk = Math.max(acct.peakBalance, newBal);
                  const dd = newPk > 0 ? ((newPk - newBal) / newPk) * 100 : 0;
                  await storage.updatePaperAccount({
                    currentBalance: Math.round(newBal * 100) / 100,
                    peakBalance: Math.round(newPk * 100) / 100,
                    maxDrawdown: Math.round(Math.max(acct.maxDrawdown, dd) * 100) / 100,
                  }, userSettings.userId);
                }
                fastSyncClosed++;
                console.log(`[AutoExecute] Fast-sync closed stale sim trade ${simTrade.id.slice(0, 8)} (${simTrade.instrument} ${simTrade.timeframe}) - OANDA trade ${simTrade.oandaTradeId} no longer open`);
                deductCommissionIfApplicable(userSettings.userId, simTrade.id, moneyPnl, simTrade.instrument).catch(() => {});
              }
            } catch (syncErr) {
              console.warn(`[AutoExecute] Fast-sync failed for trade ${simTrade.id.slice(0, 8)}:`, (syncErr as Error).message);
            }
          }
        }

        const aeUserOpenTradesAfterSync = fastSyncClosed > 0 
          ? await storage.getOpenSimulatedTrades(userSettings.userId)
          : aeUserOpenTrades;
        const aeMaxPositions = userSettings.maxOpenPositions ?? storage.getRiskManagement().maxOpenPositions;
        if (aeUserOpenTradesAfterSync.length >= aeMaxPositions) {
          console.log(`[AutoExecute] BLOCKED for user ${userSettings.userId.slice(0, 8)}... - max positions (${aeMaxPositions}) reached (${aeUserOpenTradesAfterSync.length} open)`);
          continue;
        }

        const instrumentOanda = signal.instrument.replace("XAUUSD", "XAU_USD")
          .replace("XAGUSD", "XAG_USD")
          .replace("EURUSD", "EUR_USD").replace("GBPUSD", "GBP_USD")
          .replace("USDCHF", "USD_CHF").replace("AUDUSD", "AUD_USD")
          .replace("NZDUSD", "NZD_USD");
        const hasOpenTrade = existingTrades.some((t: any) => t.instrument === instrumentOanda);
        if (hasOpenTrade) {
          console.log(`[AutoExecute] User ${userSettings.userId.slice(0, 8)}... already has open ${signal.instrument} trade, skipping`);
          continue;
        }
        
        const account = await oandaGetAccountSummary(creds);
        const accountBalance = parseFloat(account.balance);
        const riskPercent = userSettings.defaultRiskPercent || 1;
        const slDistance = Math.abs(entryPrice - signal.stopLoss);
        
        const autoExecPipSize = PIP_VALUES[signal.instrument] || 0.0001;
        const slPips = slDistance / autoExecPipSize;

        const aeMaxSlMap: Record<string, number> = { "1m": 15, "5m": 30, "15m": 50, "1h": 100, "4h": 200, "1D": 500, "1W": 1000, "1M": 2000 };
        let aeMaxSlPips = aeMaxSlMap[signal.timeframe] || 100;
        if (signal.instrument === "XAUUSD") aeMaxSlPips *= 10;
        else if (signal.instrument === "XAGUSD") aeMaxSlPips *= 5;
        if (slPips > aeMaxSlPips) {
          console.log(`[AutoExecute] BLOCKED for user ${userSettings.userId.slice(0, 8)}...: ${signal.instrument} ${signal.timeframe} — SL ${slPips.toFixed(1)} pips exceeds max ${aeMaxSlPips} for ${signal.timeframe}`);
          continue;
        }
        
        const autoLotInfo = calculateLotSize(
          accountBalance,
          riskPercent,
          slPips,
          signal.instrument,
          account.currency || "USD",
          entryPrice
        );
        
        if (autoLotInfo.skipped) {
          console.log(`[AutoExecute] User ${userSettings.userId.slice(0, 8)}... skipped ${signal.instrument}: ${autoLotInfo.skipReason}`);
          continue;
        }
        
        if (autoLotInfo.elevatedRisk) {
          const userMaxRisk = userSettings.maxAutoExecuteRiskPercent as number;
          const maxRiskLimit = (userMaxRisk && userMaxRisk > 0) ? userMaxRisk : riskPercent;
          if (autoLotInfo.actualRiskPercent && autoLotInfo.actualRiskPercent > maxRiskLimit) {
            console.log(`[AutoExecute] BLOCKED ${signal.instrument} for user ${userSettings.userId.slice(0, 8)}... - elevated risk ${autoLotInfo.actualRiskPercent.toFixed(1)}% exceeds max allowed ${maxRiskLimit}% (${userMaxRisk > 0 ? 'custom limit' : 'matches risk setting'})`);
            continue;
          }
          console.log(`[AutoExecute] User ${userSettings.userId.slice(0, 8)}... ELEVATED RISK on ${signal.instrument}: ${autoLotInfo.actualRiskPercent?.toFixed(1)}% vs normal ${riskPercent}%. Within max limit ${maxRiskLimit}%. Proceeding.`);
        }
        
        let rawUnits = autoLotInfo.units;
        const unitsPerLot = CONTRACT_SIZES[signal.instrument] || 100000;
        
        const aeBoostThreshold = userSettings.confidenceBoostThreshold as number | null;
        const aeBoostMultiplier = userSettings.confidenceBoostMultiplier as number | null;
        if (aeBoostThreshold && aeBoostMultiplier && signal.confidence >= aeBoostThreshold && !autoLotInfo.elevatedRisk) {
          const boostedUnits = Math.round(rawUnits * aeBoostMultiplier);
          const maxUnits = rawUnits * 3;
          rawUnits = Math.min(boostedUnits, maxUnits);
          console.log(`[AutoExecute] Confidence boost for user ${userSettings.userId.slice(0,8)}: ${signal.confidence}% >= ${aeBoostThreshold}% -> ${aeBoostMultiplier}x units`);
        } else if (aeBoostThreshold && aeBoostMultiplier && signal.confidence >= aeBoostThreshold && autoLotInfo.elevatedRisk) {
          console.log(`[AutoExecute] Skipped confidence boost for user ${userSettings.userId.slice(0,8)}: elevated risk trade, not boosting lot size`);
        }
        
        let aeStopLoss = signal.stopLoss;
        let aeTakeProfit = signal.takeProfit1 || signal.stopLoss * 2;
        
        const aeMinSl = enforceMinimumSlDistance(signal.instrument, entryPrice, aeStopLoss, aeTakeProfit, signal.direction);
        if (aeMinSl.widened) {
          aeStopLoss = aeMinSl.stopLoss;
          aeTakeProfit = aeMinSl.takeProfit;
          const widenedSlDist = Math.abs(entryPrice - aeStopLoss);
          const widenedSlPips = widenedSlDist / autoExecPipSize;
          const widenedLotInfo = calculateLotSize(accountBalance, riskPercent, widenedSlPips, signal.instrument, account.currency || "USD", entryPrice);
          if (widenedLotInfo.skipped) {
            console.log(`[AutoExecute] User ${userSettings.userId.slice(0, 8)}... skipped ${signal.instrument} after SL widening: ${widenedLotInfo.skipReason}`);
            continue;
          }
          rawUnits = widenedLotInfo.units;
        }
        
        rawUnits = Math.min(rawUnits, unitsPerLot * 1);
        
        const units = signal.direction === "buy" ? rawUnits : -rawUnits;
        
        const result = await oandaPlaceMarketOrder(creds, signal.instrument, units, aeStopLoss, aeTakeProfit);
        
        if (result.success) {
          const lotSize = Math.round((Math.abs(units) / unitsPerLot) * 1000) / 1000;
          console.log(`[AutoExecute] User ${userSettings.userId.slice(0, 8)}... trade placed: ${signal.instrument} ${signal.direction} ${lotSize} lots - Trade ID: ${result.tradeId}`);
          
          const aeTpDist = Math.abs(aeTakeProfit - entryPrice) / (PIP_VALUES[signal.instrument] || 0.0001);
          const aeSlDist = slPips;
          const aePotentialProfit = calculateMoneyPnL(aeTpDist, lotSize, signal.instrument, account.currency || "GBP", entryPrice);
          const aePotentialLoss = calculateMoneyPnL(aeSlDist, lotSize, signal.instrument, account.currency || "GBP", entryPrice);
          const aeCurrSym = account.currency === "USD" ? "$" : account.currency === "EUR" ? "€" : "£";
          const aeProfitStr = isFinite(aePotentialProfit) ? `${aeCurrSym}${Math.abs(aePotentialProfit).toFixed(2)}` : "calculating";
          const aeLossStr = isFinite(aePotentialLoss) ? `${aeCurrSym}${Math.abs(aePotentialLoss).toFixed(2)}` : "calculating";
          
          pushNotificationService.sendTradeNotification(
            userSettings.userId, signal.instrument, signal.direction, 'executed', undefined,
            `${signal.timeframe} ${signal.direction.toUpperCase()} @ ${entryPrice.toFixed(signal.instrument.includes("XA") ? 2 : 5)} | Profit: ${aeProfitStr} | Risk: ${aeLossStr}`
          ).catch(() => {});
          
          await logOandaActivity(userSettings.userId, "auto_execute_open", {
            instrument: signal.instrument,
            direction: signal.direction,
            tradeId: result.tradeId,
            units: Math.abs(units),
            details: `Auto-executed: ${signal.instrument} ${signal.direction} ${lotSize} lots, ${signal.confidence}% confidence, ${signal.timeframe}`,
            source: "auto_execute",
          });

          await db.insert(tradeJournalTable).values({
            userId: userSettings.userId,
            instrument: signal.instrument,
            direction: signal.direction,
            entryPrice,
            stopLoss: aeStopLoss,
            takeProfit: aeTakeProfit,
            lotSize,
            status: "open",
            notes: `Auto-executed from signal scanner. Trade ID: ${result.tradeId}`,
            timeframe: signal.timeframe,
            entryTime: new Date().toISOString(),
            signalConfidence: signal.confidence,
          } as InsertTradeJournal);
          
          if (result.tradeId) {
            let linked = false;
            const directTradeId = userSimTradeIds?.get(userSettings.userId);
            if (directTradeId) {
              await storage.updateSimulatedTrade(directTradeId, {
                oandaTradeId: result.tradeId,
              });
              console.log(`[AutoExecute] Linked OANDA trade ${result.tradeId} to sim trade ${directTradeId.slice(0, 8)}... (direct)`);
              linked = true;
            }
            if (!linked) {
              for (let attempt = 0; attempt < 3; attempt++) {
                const simTrades = await storage.getOpenSimulatedTrades();
                const matchingTrade = simTrades.find(t => 
                  t.instrument === signal.instrument && 
                  t.timeframe === signal.timeframe &&
                  t.status === "open" &&
                  t.userId === userSettings.userId &&
                  !t.oandaTradeId
                );
                if (matchingTrade) {
                  await storage.updateSimulatedTrade(matchingTrade.id, {
                    oandaTradeId: result.tradeId,
                  });
                  console.log(`[AutoExecute] Linked OANDA trade ${result.tradeId} to sim trade ${matchingTrade.id.slice(0, 8)}... (retry ${attempt})`);
                  linked = true;
                  break;
                }
                if (attempt < 2) await new Promise(r => setTimeout(r, 500));
              }
              if (!linked) {
                console.warn(`[AutoExecute] WARNING: Could not link OANDA trade ${result.tradeId} to any sim trade for ${signal.instrument} ${signal.timeframe} user ${userSettings.userId.slice(0, 8)}`);
              }
            }
          }
          
          await logUserAction(userSettings.userId, "auto_trade_execute", {
            instrument: signal.instrument,
            direction: signal.direction,
            tradeId: result.tradeId,
            lotSize,
            confidence: signal.confidence,
          });
        } else {
          console.log(`[AutoExecute] User ${userSettings.userId.slice(0, 8)}... trade failed: ${result.error}`);
        }
      } catch (userError) {
        console.warn(`[AutoExecute] Error executing for user ${userSettings.userId.slice(0, 8)}...:`, userError instanceof Error ? userError.message : "Unknown");
      }
    }
  } catch (error) {
    console.error("[AutoExecute] Error in auto-execute for users:", error);
  }
}

async function closeLinkedOandaTrade(userId: string | null, oandaTradeId: string, reason: string) {
  try {
    if (userId) {
      const dbCreds = await getUserOandaCredentials(userId);
      if (dbCreds && dbCreds.isConnected && dbCreds.apiKey) {
        const creds: OandaCredentials = {
          apiKey: dbCreds.apiKey,
          accountId: dbCreds.accountId,
          isLive: dbCreds.environment === "live",
        };
        const result = await oandaCloseTrade(creds, oandaTradeId);
        if (result.success) {
          console.log(`[TradeMonitor] Closed OANDA trade ${oandaTradeId} (${reason})`);
        } else {
          console.warn(`[TradeMonitor] OANDA close failed for ${oandaTradeId}: ${result.error}`);
        }
      }
    } else {
      console.warn(`[TradeMonitor] Cannot close OANDA trade ${oandaTradeId} - no userId associated`);
    }
  } catch (error) {
    console.error(`[TradeMonitor] Failed to close OANDA trade ${oandaTradeId} (${reason}):`, error);
  }
}

// Helper: Modify OANDA trailing stop - multi-user aware
// Uses user's own OANDA credentials if trade has userId, otherwise falls back to system OANDA
async function modifyOandaTrailingStop(userId: string | null, oandaTradeId: string, newStopLoss: number, instrument: string): Promise<boolean> {
  try {
    if (userId) {
      const dbCreds = await getUserOandaCredentials(userId);
      if (dbCreds && dbCreds.isConnected && dbCreds.apiKey) {
        const creds: OandaCredentials = {
          apiKey: dbCreds.apiKey,
          accountId: dbCreds.accountId,
          isLive: dbCreds.environment === "live",
        };
        const result = await oandaModifyTradeStopLoss(creds, oandaTradeId, newStopLoss, instrument);
        if (result.success) {
          console.log(`[TradeMonitor] Modified trailing SL for user ${userId.slice(0, 8)}... trade ${oandaTradeId} -> ${newStopLoss}`);
          return true;
        } else {
          console.error(`[TradeMonitor] OANDA rejected SL modification for trade ${oandaTradeId}: ${result.error}`);
          return false;
        }
      }
    } else {
      if (oandaService.isConfigured()) {
        await oandaService.modifyTradeStopLoss(oandaTradeId, newStopLoss, instrument);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error(`[TradeMonitor] Failed to modify trailing stop:`, error);
    return false;
  }
}

const DEFAULT_TIMEFRAME: Timeframe = "1h";

// Helper: Save signal to database for history/persistence
async function saveSignalToDatabase(signal: TradeSignal) {
  try {
    const signalData: InsertSignalHistory = {
      instrument: signal.instrument,
      timeframe: signal.timeframe,
      direction: signal.direction,
      confidence: signal.confidence,
      entryLow: signal.entryZone.low,
      entryHigh: signal.entryZone.high,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      riskRewardRatio: signal.riskRewardRatio,
      reasoning: signal.reasoning,
      generatedAt: new Date().toISOString(),
    };
    
    await db.insert(signalHistoryTable).values(signalData);
    console.log(`[SignalHistory] Saved ${signal.instrument} ${signal.timeframe} ${signal.direction} signal (${signal.confidence}% confidence)`);
  } catch (error) {
    console.error("[SignalHistory] Failed to save signal:", error);
  }
}

async function updateSignalOutcome(
  instrument: string,
  timeframe: string,
  direction: string,
  openedAt: string,
  closePrice: number,
  pnlPips: number,
  closureType: "natural" | "managed" = "managed"
) {
  try {
    const tradeTime = new Date(openedAt);
    const tfWindowMap: Record<string, number> = { "1m": 2*60*1000, "5m": 5*60*1000, "15m": 15*60*1000, "1h": 60*60*1000, "4h": 4*60*60*1000 };
    const windowMs = tfWindowMap[timeframe] || 15 * 60 * 1000;
    const windowStart = new Date(tradeTime.getTime() - windowMs).toISOString();
    const windowEnd = new Date(tradeTime.getTime() + windowMs).toISOString();

    const matches = await db.select()
      .from(signalHistoryTable)
      .where(
        and(
          eq(signalHistoryTable.instrument, instrument),
          eq(signalHistoryTable.timeframe, timeframe),
          eq(signalHistoryTable.direction, direction),
          gte(signalHistoryTable.generatedAt, windowStart),
          lte(signalHistoryTable.generatedAt, windowEnd),
          isNull(signalHistoryTable.outcome)
        )
      );

    if (matches.length === 0) return;

    const closest = matches.reduce((best, m) => {
      const delta = Math.abs(new Date(m.generatedAt!).getTime() - tradeTime.getTime());
      const bestDelta = Math.abs(new Date(best.generatedAt!).getTime() - tradeTime.getTime());
      return delta < bestDelta ? m : best;
    });

    let outcome: string;
    if (closureType === "natural") {
      outcome = pnlPips > 0 ? "tp1_hit" : "sl_hit";
    } else {
      outcome = pnlPips > 0 ? "managed_close" : pnlPips < -1 ? "sl_hit" : "expired";
    }

    const now = new Date().toISOString();
    await db.update(signalHistoryTable)
      .set({
        outcome,
        outcomePrice: closePrice,
        outcomeTime: now,
      })
      .where(eq(signalHistoryTable.id, closest.id));

    console.log(`[SignalHistory] Updated ${instrument} ${timeframe} signal outcome -> ${outcome} (${pnlPips.toFixed(1)} pips)`);
  } catch (error) {
    // Non-critical, don't crash trade monitor
  }
}

// Helper: Calculate performance stats from a list of trades
function calculatePerformanceStats(trades: SimulatedTrade[]) {
  const closedTrades = trades.filter(t => t.status !== "open");
  const wins = closedTrades.filter(t => (t.pnlPips || 0) > 0);
  const losses = closedTrades.filter(t => (t.pnlPips || 0) <= 0);
  
  const totalPips = closedTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
  const winPips = wins.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
  const lossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pnlPips || 0), 0));
  
  return {
    totalTrades: closedTrades.length,
    openTrades: trades.filter(t => t.status === "open").length,
    wins: wins.length,
    losses: losses.length,
    winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
    totalPips,
    avgPipsPerTrade: closedTrades.length > 0 ? totalPips / closedTrades.length : 0,
    profitFactor: lossPips > 0 ? winPips / lossPips : (winPips > 0 ? Infinity : 0),
    avgWinPips: wins.length > 0 ? winPips / wins.length : 0,
    avgLossPips: losses.length > 0 ? lossPips / losses.length : 0,
  };
}

// Track simulated price movement for realistic trade outcomes
const priceHistory: Map<string, { basePrice: number; lastUpdate: number; trend: number }> = new Map();

// Generate mock data for demo when API limits are hit
// Note: Mock data is used to demonstrate functionality when API limits are reached
function generateMockAnalysis(instrument: Instrument, timeframe: Timeframe, isLive: boolean = false) {
  // Updated Feb 3, 2026 - Matched to current market levels after ATH correction
  // Gold hit $5,608 ATH in late Jan, now around $4,800-4,900 after correction
  const basePrices: Record<Instrument, number> = {
    "XAUUSD": 4890, // Gold corrected from $5,608 ATH
    "XAGUSD": 32.50, // Silver ~$32.50/oz
    "EURUSD": 1.0450,
    "GBPUSD": 1.2443,
    "USDCHF": 0.9075,
    "AUDUSD": 0.6274,
    "NZDUSD": 0.5646,
    "USDJPY": 142.50,
    "USDCAD": 1.3850,
    "EURGBP": 0.8420,
    "EURJPY": 149.10,
    "GBPJPY": 177.20,
  };
  
  // Get or create price tracking for this instrument
  const key = instrument;
  let priceState = priceHistory.get(key);
  const now = Date.now();
  
  if (!priceState) {
    priceState = { 
      basePrice: basePrices[instrument], 
      lastUpdate: now,
      trend: Math.random() > 0.5 ? 1 : -1 // random initial trend
    };
    priceHistory.set(key, priceState);
  }
  
  // Update price with realistic movement (trends with reversals)
  const timeDiff = (now - priceState.lastUpdate) / 1000; // seconds
  if (timeDiff > 5) { // Update every 5+ seconds
    const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
    const volatility = instrument === "XAUUSD" ? 2 : instrument === "XAGUSD" ? 0.15 : 0.0005;
    
    // 20% chance to reverse trend
    if (Math.random() < 0.20) {
      priceState.trend *= -1;
    }
    
    // Move price in trend direction with randomness
    const move = (Math.random() * volatility * 2) * priceState.trend;
    priceState.basePrice += move;
    priceState.lastUpdate = now;
    
    // Keep price within reasonable bounds (±1% from base)
    const originalBase = basePrices[instrument];
    const maxDeviation = originalBase * 0.01;
    if (priceState.basePrice > originalBase + maxDeviation) {
      priceState.basePrice = originalBase + maxDeviation;
      priceState.trend = -1;
    } else if (priceState.basePrice < originalBase - maxDeviation) {
      priceState.basePrice = originalBase - maxDeviation;
      priceState.trend = 1;
    }
    
    priceHistory.set(key, priceState);
  }
  
  const basePrice = priceState.basePrice;
  
  const states = ["uptrend", "downtrend", "ranging"] as const;
  const marketState = states[Math.floor(Math.random() * states.length)];
  const trendStrength = 40 + Math.floor(Math.random() * 40);
  const volatility = ["low", "medium", "high"] as const;
  const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
  const pipSize = PIP_VALUES[instrument] || 0.0001;

  return {
    instrument,
    timeframe,
    currentPrice: basePrice,
    previousClose: basePrice * (1 - (Math.random() * 0.002 - 0.001)),
    changePercent: Math.random() * 0.4 - 0.2,
    marketState,
    trend: {
      direction: marketState === "uptrend" ? "up" as const : 
                 marketState === "downtrend" ? "down" as const : "sideways" as const,
      strength: trendStrength,
    },
    supportLevels: [
      { price: basePrice - (instrument === "XAUUSD" ? 10 : isMetal ? 0.50 : 0.0020), strength: "strong" as const, type: "support" as const, touches: 3 },
      { price: basePrice - (instrument === "XAUUSD" ? 20 : isMetal ? 1.00 : 0.0040), strength: "moderate" as const, type: "support" as const, touches: 2 },
    ],
    resistanceLevels: [
      { price: basePrice + (instrument === "XAUUSD" ? 10 : isMetal ? 0.50 : 0.0020), strength: "strong" as const, type: "resistance" as const, touches: 3 },
      { price: basePrice + (instrument === "XAUUSD" ? 20 : isMetal ? 1.00 : 0.0040), strength: "moderate" as const, type: "resistance" as const, touches: 2 },
    ],
    volatility: volatility[Math.floor(Math.random() * volatility.length)],
    lastUpdated: new Date().toISOString(),
  };
}

async function correctJpyPipInflation() {
  try {
    const jpyPipSize = 0.01;
    const allClosed = await db.select().from(simulatedTradesTable).where(ne(simulatedTradesTable.status, "open"));
    const jpyTrades = allClosed.filter(t => 
      t.instrument.includes("JPY") && 
      t.pnlPips !== null && t.pnlPips !== undefined && t.pnlPips !== 0 &&
      t.closePrice !== null && t.closePrice !== undefined
    );
    
    if (jpyTrades.length === 0) {
      console.log("[JPYCorrection] No JPY trades to correct");
      return;
    }

    const needsCorrection = jpyTrades.filter(t => {
      const actualPriceDiff = Math.abs((t.closePrice ?? 0) - t.entryPrice);
      const correctPips = actualPriceDiff / jpyPipSize;
      const storedPips = Math.abs(t.pnlPips ?? 0);
      return storedPips > 1 && correctPips > 0.01 && (storedPips / correctPips) > 50;
    });

    if (needsCorrection.length === 0) {
      console.log("[JPYCorrection] All JPY trades already have correct pip values");
      return;
    }

    console.log(`[JPYCorrection] Found ${needsCorrection.length} JPY trades with 100x inflated pips, correcting...`);

    const affectedUsers = new Set<string>();
    for (const trade of needsCorrection) {
      const correctedPips = Math.round((trade.pnlPips ?? 0) / 100 * 10) / 10;
      const correctedMoney = trade.pnlMoney !== null && trade.pnlMoney !== undefined 
        ? Math.round(trade.pnlMoney / 100 * 100) / 100 
        : undefined;
      
      await storage.updateSimulatedTrade(trade.id, {
        pnlPips: correctedPips,
        pnlMoney: correctedMoney,
      });
      
      if (trade.userId) affectedUsers.add(trade.userId);
      console.log(`[JPYCorrection] Fixed ${trade.instrument} ${trade.timeframe}: ${trade.pnlPips} -> ${correctedPips} pips, ${trade.pnlMoney} -> ${correctedMoney}`);
    }

    for (const userId of affectedUsers) {
      const acct = await storage.getPaperAccount(userId);
      const userTrades = await db.select().from(simulatedTradesTable).where(eq(simulatedTradesTable.userId, userId));
      const closedUserTrades = userTrades.filter(t => t.status !== "open" && t.pnlMoney !== null && t.pnlMoney !== undefined);
      
      const totalPnl = closedUserTrades.reduce((sum, t) => sum + (t.pnlMoney ?? 0), 0);
      const newBalance = Math.round((acct.startingBalance + totalPnl) * 100) / 100;
      const newPeak = Math.max(acct.startingBalance, newBalance);
      const dd = newPeak > 0 ? ((newPeak - newBalance) / newPeak) * 100 : 0;
      
      await storage.updatePaperAccount({
        currentBalance: newBalance,
        peakBalance: newPeak,
        maxDrawdown: Math.round(dd * 100) / 100,
      }, userId);
      
      console.log(`[JPYCorrection] User ${userId.slice(0, 8)}: balance ${acct.currentBalance} -> ${newBalance} (starting: ${acct.startingBalance}, total PnL: ${totalPnl.toFixed(2)})`);
    }

    console.log(`[JPYCorrection] Correction complete: ${needsCorrection.length} trades fixed, ${affectedUsers.size} users rebalanced`);
  } catch (err) {
    console.error("[JPYCorrection] Error during correction:", err);
  }
}

// Load active strategy profiles from database on startup
async function loadActiveStrategyProfiles() {
  try {
    const profiles = await db.select().from(timeframeStrategyProfiles);
    for (const profile of profiles) {
      if (profile.isActive) {
        updateActiveStrategyProfile(profile.timeframe, {
          minTrendStrength: profile.minTrendStrength,
          minConfluence: profile.minConfluence,
          slMultiplier: profile.slMultiplier,
          rrRatio: profile.rrRatio,
          maxVolatility: profile.maxVolatility,
          requireMTFConfluence: profile.requireMTFConfluence,
          minConfidence: profile.minConfidence,
        });
      }
    }
    console.log(`[StrategyProfiles] Loaded ${profiles.filter(p => p.isActive).length} active profiles`);
    
    // Also load per-instrument approved profiles from auto-optimizer
    const autoProfiles = await db.select().from(autoOptimizedProfiles);
    let approvedCount = 0;
    for (const profile of autoProfiles) {
      if (profile.status === "active") {
        updateInstrumentProfile(profile.instrument, profile.timeframe, {
          minTrendStrength: profile.minTrendStrength,
          minConfluence: profile.minConfluence,
          slMultiplier: profile.slMultiplier,
          rrRatio: profile.rrRatio,
          maxVolatility: profile.maxVolatility as "low" | "medium" | "high",
          requireMTFConfluence: profile.requireMTFConfluence,
          minConfidence: profile.minConfidence,
        });
        approvedCount++;
        console.log(`[StrategyProfiles] Approved ${profile.instrument} ${profile.timeframe} for trading`);
      }
    }
    console.log(`[StrategyProfiles] Loaded ${approvedCount} approved instrument+timeframe pairs`);
  } catch (error) {
    console.error("[StrategyProfiles] Error loading profiles:", error);
  }

  setTimeout(async () => {
    try {
      await correctJpyPipInflation();
    } catch (err) {
      console.error("[JPYCorrection] Failed:", err);
    }
    try {
      await autoOptimizer.start();
    } catch (err) {
      console.error("[AutoOptimizer] Failed to start:", err);
    }
    try {
      await runRealityCheck();
      startRealityCheckTimer();
    } catch (err) {
      console.error("[RealityCheck] Failed to start:", err);
    }
    try {
      strategyIntelligence.start();
    } catch (err) {
      console.error("[StrategyIntel] Failed to start:", err);
    }
  }, 10000);
}

const PIP_VALUES: Record<string, number> = {
  XAUUSD: 0.1,
  XAGUSD: 0.01,
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  USDCHF: 0.0001,
  AUDUSD: 0.0001,
  NZDUSD: 0.0001,
  USDJPY: 0.01,
  USDCAD: 0.0001,
  EURGBP: 0.0001,
  EURJPY: 0.01,
  GBPJPY: 0.01,
};

const CONTRACT_SIZES: Record<string, number> = {
  XAUUSD: 100,
  XAGUSD: 5000,
  EURUSD: 100000,
  GBPUSD: 100000,
  USDCHF: 100000,
  AUDUSD: 100000,
  NZDUSD: 100000,
  USDJPY: 100000,
  USDCAD: 100000,
  EURGBP: 100000,
  EURJPY: 100000,
  GBPJPY: 100000,
};

const MIN_OANDA_SL_DISTANCE: Record<string, number> = {
  XAUUSD: 0.50,
  XAGUSD: 0.05,
  EURUSD: 0.00050,
  GBPUSD: 0.00050,
  USDCHF: 0.00050,
  AUDUSD: 0.00050,
  NZDUSD: 0.00050,
  USDJPY: 0.050,
  USDCAD: 0.00050,
  EURGBP: 0.00050,
  EURJPY: 0.050,
  GBPJPY: 0.050,
};

function enforceMinimumSlDistance(
  instrument: string,
  currentPrice: number,
  stopLoss: number,
  takeProfit: number,
  direction: string
): { stopLoss: number; takeProfit: number; widened: boolean } {
  const minDist = MIN_OANDA_SL_DISTANCE[instrument] || 0.00050;
  const slDist = Math.abs(currentPrice - stopLoss);

  if (slDist >= minDist) {
    return { stopLoss, takeProfit, widened: false };
  }

  const originalRR = Math.abs(takeProfit - currentPrice) / (slDist || minDist);
  const newSl = direction === "buy"
    ? currentPrice - minDist
    : currentPrice + minDist;
  const newTp = direction === "buy"
    ? currentPrice + (minDist * originalRR)
    : currentPrice - (minDist * originalRR);

  console.log(`[OANDA] Widened SL for ${instrument}: ${slDist.toFixed(5)} -> ${minDist.toFixed(5)} (min distance). SL=${newSl.toFixed(5)}, TP=${newTp.toFixed(5)}, R:R=${originalRR.toFixed(1)}`);
  return { stopLoss: newSl, takeProfit: newTp, widened: true };
}

function calculateMoneyPnL(
  pnlPips: number,
  lotSize: number,
  instrument: string,
  accountCurrency: string,
  currentPrice?: number
): number {
  const pipSize = PIP_VALUES[instrument] || 0.0001;
  const contractSize = CONTRACT_SIZES[instrument] || 100000;
  
  let pipValueUsd = pipSize * contractSize;
  
  const isJpyQuote = instrument.endsWith("JPY");
  const isChfQuote = instrument.endsWith("CHF");
  if (isJpyQuote && currentPrice && currentPrice > 0) {
    pipValueUsd = pipValueUsd / currentPrice;
  } else if (isChfQuote && currentPrice && currentPrice > 0) {
    pipValueUsd = pipValueUsd / currentPrice;
  }
  
  const isGbpQuotePnl = instrument.endsWith("GBP");
  let pipValuePerLot: number;
  if (isGbpQuotePnl && accountCurrency === "GBP") {
    pipValuePerLot = pipValueUsd;
  } else if (accountCurrency === "GBP") {
    pipValuePerLot = pipValueUsd * 0.735;
  } else if (accountCurrency === "EUR") {
    pipValuePerLot = pipValueUsd * 0.84;
  } else {
    pipValuePerLot = pipValueUsd;
  }
  
  return Math.round(pnlPips * lotSize * pipValuePerLot * 100) / 100;
}

function calculateLotSize(
  accountBalance: number,
  riskPercent: number,
  stopLossPips: number,
  instrument: string,
  accountCurrency: string,
  currentPrice?: number
): { lotSize: number; units: number; riskAmount: number; pipValue: number; skipped?: boolean; skipReason?: string; elevatedRisk?: boolean; actualRiskPercent?: number; actualRiskAmount?: number; minAccountFor1Pct?: number } {
  const pipSize = PIP_VALUES[instrument] || 0.0001;
  const contractSize = CONTRACT_SIZES[instrument] || 100000;
  
  const riskAmount = accountBalance * (riskPercent / 100);
  
  let pipValueUsd = pipSize * contractSize;
  
  const isJpyQuote = instrument.endsWith("JPY");
  const isChfQuote = instrument.endsWith("CHF");
  const isGbpQuote = instrument.endsWith("GBP");
  if (isJpyQuote && currentPrice && currentPrice > 0) {
    pipValueUsd = pipValueUsd / currentPrice;
  } else if (isChfQuote && currentPrice && currentPrice > 0) {
    pipValueUsd = pipValueUsd / currentPrice;
  }
  
  let pipValuePerLot: number;
  if (isGbpQuote && accountCurrency === "GBP") {
    pipValuePerLot = pipValueUsd;
  } else if (accountCurrency === "GBP") {
    pipValuePerLot = pipValueUsd * 0.735;
  } else if (accountCurrency === "EUR") {
    pipValuePerLot = pipValueUsd * 0.84;
  } else {
    pipValuePerLot = pipValueUsd;
  }
  
  const rawLotSize = riskAmount / (stopLossPips * pipValuePerLot);
  const lotSize = Math.round(rawLotSize * 1000) / 1000;
  
  const minUnits: Record<string, number> = {
    XAUUSD: 1,
    XAGUSD: 5,
  };
  const instrumentMinUnits = minUnits[instrument] || 1;
  const instrumentMinLot = Math.ceil((instrumentMinUnits / contractSize) * 1000) / 1000;
  const minLotSize = Math.max(0.001, instrumentMinLot);
  
  const safeLotSize = Math.max(minLotSize, lotSize);
  
  const rawUnits = Math.round(safeLotSize * contractSize);
  const effectiveUnits = Math.max(instrumentMinUnits, rawUnits);
  const effectiveLotSize = Math.round((effectiveUnits / contractSize) * 1000) / 1000;
  
  const actualRisk = effectiveLotSize * stopLossPips * pipValuePerLot;
  const actualRiskPercent = (actualRisk / accountBalance) * 100;
  const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
  const maxRiskPercent = isMetal ? 5 : 2;
  const minAccountFor1Pct = Math.ceil(actualRisk / 0.01);

  if (effectiveLotSize <= minLotSize && actualRiskPercent > maxRiskPercent) {
    console.log(`[LotSize] SKIPPED ${instrument}: min ${effectiveLotSize} lots (${effectiveUnits} units) would risk ${actualRisk.toFixed(2)} (${actualRiskPercent.toFixed(1)}% of ${accountBalance.toFixed(0)}) - exceeds ${maxRiskPercent}% max risk. Need ${accountCurrency} ${minAccountFor1Pct} for 1% risk.`);
    return {
      lotSize: 0,
      units: 0,
      riskAmount,
      pipValue: pipValuePerLot,
      skipped: true,
      skipReason: `Min ${effectiveLotSize} lots would risk ${actualRisk.toFixed(2)} (${actualRiskPercent.toFixed(1)}% of account) vs budget ${riskAmount.toFixed(2)} (${riskPercent}%)`,
      actualRiskPercent,
      actualRiskAmount: actualRisk,
      minAccountFor1Pct,
    };
  }
  
  const riskRatio = actualRisk / riskAmount;
  const isElevated = actualRisk > riskAmount * 1.5;
  if (isElevated) {
    console.log(`[LotSize] ${instrument}: ${effectiveLotSize} lots (${effectiveUnits} units), ELEVATED risk ${actualRisk.toFixed(2)} (${actualRiskPercent.toFixed(1)}%) vs budget ${riskAmount.toFixed(2)} (${riskPercent}% of ${accountBalance.toFixed(0)}). Min lot forces higher risk. Need ${accountCurrency} ${minAccountFor1Pct} for 1% risk.`);
  } else {
    console.log(`[LotSize] ${instrument}: ${effectiveLotSize} lots (${effectiveUnits} units), risk ${actualRisk.toFixed(2)} vs budget ${riskAmount.toFixed(2)} (${riskPercent}% of ${accountBalance.toFixed(0)}) [${(riskRatio * 100).toFixed(0)}% of budget]`);
  }
  
  return {
    lotSize: effectiveLotSize,
    units: effectiveUnits,
    riskAmount,
    pipValue: pipValuePerLot,
    elevatedRisk: isElevated || undefined,
    actualRiskPercent: isElevated ? actualRiskPercent : undefined,
    actualRiskAmount: isElevated ? actualRisk : undefined,
    minAccountFor1Pct: isElevated ? minAccountFor1Pct : undefined,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.get("/api/health", (_req, res) => {
    res.json({ 
      status: "ok", 
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Keep-alive: aggressive self-ping to prevent Autoscale sleep (production only)
  const isProduction = process.env.NODE_ENV === "production";
  const deployedUrl = process.env.RENDER_EXTERNAL_URL || process.env.REPLIT_DEPLOYMENT_URL || process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_SLUG;
  if (isProduction) {
    if (!deployedUrl) {
      console.error("[KeepAlive] WARNING: No deployment URL found! Self-ping cannot start. Set REPLIT_DEPLOYMENT_URL or use an external pinger.");
      console.error("[KeepAlive] Checked: REPLIT_DEPLOYMENT_URL, REPLIT_DEV_DOMAIN, REPLIT_SLUG - all undefined");
    } else {
      const KEEP_ALIVE_INTERVAL = 2 * 60 * 1000; // Every 2 minutes for reliability
      const pingUrl = deployedUrl.startsWith("http") ? `${deployedUrl}/api/health` : `https://${deployedUrl}/api/health`;
      let consecutiveFailures = 0;
      const MAX_RETRIES = 3;

      const performPing = async () => {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const resp = await fetch(pingUrl, { signal: controller.signal });
            clearTimeout(timeout);
            if (resp.ok) {
              consecutiveFailures = 0;
              const uptimeMin = Math.round(process.uptime() / 60);
              if (uptimeMin % 30 === 0 || uptimeMin <= 2) {
                console.log(`[KeepAlive] OK (uptime: ${uptimeMin}min, scanner+monitor active)`);
              }
              return;
            }
          } catch (err) {
            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
              continue;
            }
            consecutiveFailures++;
            console.warn(`[KeepAlive] Ping failed after ${MAX_RETRIES} attempts (streak: ${consecutiveFailures}):`, err instanceof Error ? err.message : "Unknown");
          }
        }
      };

      // Also try local self-ping as fallback
      const localPing = async () => {
        try {
          const resp = await fetch("http://localhost:5000/api/health");
          if (!resp.ok) console.warn("[KeepAlive] Local ping returned non-OK");
        } catch {
          // Local ping failure is not critical
        }
      };

      setInterval(performPing, KEEP_ALIVE_INTERVAL);
      setInterval(localPing, KEEP_ALIVE_INTERVAL);
      setTimeout(performPing, 30000);
      console.log(`[KeepAlive] Active every 2 min with retry -> ${pingUrl}`);
    }
  } else {
    console.log("[KeepAlive] Disabled in development mode");
  }

  // Setup authentication BEFORE other routes
  const { setupAuth, registerAuthRoutes } = await import("./replit_integrations/auth");
  await setupAuth(app);
  registerAuthRoutes(app);

  // Seed OANDA credentials into historicalDataService from DB on startup
  try {
    const allCreds = await db.select().from(userOandaCredentials).where(eq(userOandaCredentials.isConnected, true));
    for (const creds of allCreds) {
      if (creds.apiKey && creds.accountId) {
        historicalDataService.setOandaCredentials(creds.apiKey, creds.accountId, creds.environment === "live");
        break;
      }
    }
  } catch (e) {
    console.warn("[Startup] Could not seed historical data credentials:", e);
  }

  // ===== COMMISSION & STRIPE ROUTES =====

  // Get Stripe publishable key
  app.get("/api/stripe/publishable-key", async (_req, res) => {
    try {
      const key = await getStripePublishableKey();
      res.json({ publishableKey: key });
    } catch (err: any) {
      res.status(500).json({ error: "Stripe not configured" });
    }
  });

  // Get commission balance for current user
  app.get("/api/commission/balance", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const balance = await commissionService.getBalance(userId);
    const isOwner = commissionService.isOwner(userId);
    res.json({ balance, isOwner });
  });

  // Get commission ledger for current user
  app.get("/api/commission/ledger", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const ledger = await commissionService.getLedger(userId);
    res.json({ ledger });
  });

  // Check if user needs to set up commission (live OANDA account connected but no commission balance)
  app.get("/api/commission/status", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isOwner = commissionService.isOwner(userId);
    if (isOwner) return res.json({ required: false, isOwner: true });

    // Check if user has a live OANDA account
    const [creds] = await db.select().from(userOandaCredentials).where(eq(userOandaCredentials.userId, userId));
    const hasLiveAccount = creds && creds.environment === "live" && creds.isConnected;
    
    if (!hasLiveAccount) return res.json({ required: false, isLive: false });

    const balance = await commissionService.getBalance(userId);
    const needsDeposit = !balance || balance.balance <= 0;
    const tradingPaused = balance?.tradingPaused ?? false;

    // Get OANDA balance for minimum deposit calculation
    let oandaBalance = 0;
    try {
      const decryptedKey = isEncrypted(creds.apiKey) ? decryptApiKey(creds.apiKey) : creds.apiKey;
      const summary = await oandaGetAccountSummary({
        apiKey: decryptedKey,
        accountId: creds.accountId,
        isLive: true,
      });
      oandaBalance = parseFloat(summary.balance) || 0;
    } catch (e) {}

    const minDeposit = Math.max(Math.ceil(oandaBalance * 0.1), 20);

    res.json({
      required: needsDeposit,
      isLive: true,
      balance: balance?.balance ?? 0,
      tradingPaused,
      minDeposit,
      oandaBalance,
      hasPaymentMethod: !!balance?.stripePaymentMethodId,
      autoTopUpEnabled: balance?.autoTopUpEnabled ?? false,
    });
  });

  // Create Stripe checkout session for commission deposit
  app.post("/api/commission/create-checkout", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { amount } = req.body;
    if (!amount || amount < 10) return res.status(400).json({ error: "Minimum deposit is £10" });

    try {
      const stripe = await getUncachableStripeClient();

      let balance = await commissionService.getBalance(userId);
      if (!balance) {
        balance = await commissionService.createBalance(userId);
      }

      // Create or get Stripe customer
      let customerId = balance.stripeCustomerId;
      if (!customerId) {
        const [userRecord] = await db.select().from(users).where(eq(users.id, userId));
        const customer = await stripe.customers.create({
          email: userRecord?.email || undefined,
          metadata: { userId, platform: 'TradeIQ' },
        });
        customerId = customer.id;
        await commissionService.saveStripeCustomer(userId, customerId);
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        mode: 'payment',
        payment_intent_data: {
          setup_future_usage: 'off_session',
          metadata: { userId, type: 'commission_deposit' },
        },
        line_items: [{
          price_data: {
            currency: 'gbp',
            product_data: {
              name: 'TradeIQ Commission Deposit',
              description: `Commission balance top-up - £${amount}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        success_url: `${baseUrl}/commission?deposit=success&amount=${amount}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/commission?deposit=cancelled`,
        metadata: { userId, type: 'commission_deposit', amount: String(amount) },
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[Commission] Checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Stripe checkout success webhook callback - process deposit
  app.post("/api/commission/confirm-deposit", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "Missing session ID" });

    try {
      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent', 'payment_intent.payment_method'],
      });

      if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: "Payment not completed" });
      }

      const amount = session.amount_total ? session.amount_total / 100 : 0;
      const paymentIntent = session.payment_intent as any;
      const paymentMethodId = paymentIntent?.payment_method?.id || paymentIntent?.payment_method;

      await commissionService.processDeposit(userId, amount, paymentIntent?.id, `Initial deposit of £${amount.toFixed(2)}`);

      if (paymentMethodId && typeof paymentMethodId === 'string') {
        await commissionService.savePaymentMethod(userId, paymentMethodId);
      }

      res.json({ success: true, balance: amount });
    } catch (err: any) {
      console.error("[Commission] Confirm deposit error:", err.message);
      res.status(500).json({ error: "Failed to confirm deposit" });
    }
  });

  // Manual top-up for existing users with saved payment method
  app.post("/api/commission/top-up", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { amount } = req.body;
    if (!amount || amount < 10) return res.status(400).json({ error: "Minimum top-up is £10" });

    const balance = await commissionService.getBalance(userId);
    if (!balance?.stripeCustomerId || !balance?.stripePaymentMethodId) {
      return res.status(400).json({ error: "No saved payment method. Please use the deposit page." });
    }

    try {
      const stripe = await getUncachableStripeClient();
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'gbp',
        customer: balance.stripeCustomerId,
        payment_method: balance.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { userId, type: 'manual_top_up' },
      });

      if (paymentIntent.status === 'succeeded') {
        const newBalance = await commissionService.processDeposit(userId, amount, paymentIntent.id, `Manual top-up of £${amount.toFixed(2)}`);
        res.json({ success: true, balance: newBalance });
      } else {
        res.status(400).json({ error: "Payment failed" });
      }
    } catch (err: any) {
      console.error("[Commission] Top-up error:", err.message);
      res.status(500).json({ error: err.message || "Top-up failed" });
    }
  });

  // Toggle auto top-up
  app.post("/api/commission/auto-top-up", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { enabled } = req.body;
    const balance = await commissionService.getBalance(userId);
    if (!balance) return res.status(404).json({ error: "No commission account" });

    await db.update(commissionBalances)
      .set({ autoTopUpEnabled: !!enabled, updatedAt: new Date().toISOString() })
      .where(eq(commissionBalances.userId, userId));

    res.json({ success: true });
  });

  // ADMIN ONLY: Get all commission data (owner view)
  app.get("/api/commission/admin/overview", async (req, res) => {
    const userId = getUserId(req);
    if (!userId || !commissionService.isOwner(userId)) {
      return res.status(403).json({ error: "Admin only" });
    }

    const allBalances = await commissionService.getAllBalances();
    const totalEarned = await commissionService.getTotalEarned();
    const recentLedger = await commissionService.getAllLedgerEntries(100);

    const userIds = allBalances.map(b => b.userId);
    const userRecords = userIds.length > 0 
      ? await db.select().from(users).where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    
    const userSettingsRecords = userIds.length > 0
      ? await db.select().from(userSettingsTable).where(sql`${userSettingsTable.userId} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    const allOandaCreds = userIds.length > 0
      ? await db.select().from(userOandaCredentials).where(sql`${userOandaCredentials.userId} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    const perUserCommission = await db.execute(
      sql`SELECT user_id, COALESCE(SUM(ABS(amount)), 0) as total_commission,
          COUNT(*) as trade_count
          FROM commission_ledger WHERE type = 'commission_deduction'
          GROUP BY user_id`
    );
    const commissionByUser: Record<string, { totalCommission: number; tradeCount: number }> = {};
    for (const row of (perUserCommission.rows as any[])) {
      commissionByUser[row.user_id] = {
        totalCommission: parseFloat(row.total_commission || '0'),
        tradeCount: parseInt(row.trade_count || '0'),
      };
    }

    const perUserDeposits = await db.execute(
      sql`SELECT user_id, COALESCE(SUM(amount), 0) as total_deposited
          FROM commission_ledger WHERE type IN ('deposit', 'auto_top_up')
          GROUP BY user_id`
    );
    const depositsByUser: Record<string, number> = {};
    for (const row of (perUserDeposits.rows as any[])) {
      depositsByUser[row.user_id] = parseFloat(row.total_deposited || '0');
    }

    const oandaBalances: Record<string, { balance: number; currency: string; environment: string; fetchFailed: boolean }> = {};
    const oandaFetchPromises = allOandaCreds
      .filter(cred => cred.isConnected)
      .map(async (cred) => {
        try {
          const decryptedKey = isEncrypted(cred.apiKey) ? decryptApiKey(cred.apiKey) : cred.apiKey;
          const summary = await Promise.race([
            oandaGetAccountSummary({
              apiKey: decryptedKey,
              accountId: cred.accountId,
              isLive: cred.environment === "live",
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
          ]);
          oandaBalances[cred.userId] = {
            balance: parseFloat(summary.balance) || 0,
            currency: summary.currency || 'GBP',
            environment: cred.environment,
            fetchFailed: false,
          };
        } catch (e) {
          oandaBalances[cred.userId] = { balance: 0, currency: 'GBP', environment: cred.environment, fetchFailed: true };
        }
      });
    await Promise.all(oandaFetchPromises);

    const enrichedBalances = allBalances.map(b => {
      const user = userRecords.find(u => u.id === b.userId);
      const settings = userSettingsRecords.find(s => s.userId === b.userId);
      const oanda = oandaBalances[b.userId];
      const commission = commissionByUser[b.userId];
      return {
        ...b,
        displayName: settings?.displayName || user?.firstName || user?.email || b.userId.substring(0, 8),
        oandaBalance: oanda?.balance || 0,
        oandaCurrency: oanda?.currency || 'GBP',
        oandaEnvironment: oanda?.environment || 'unknown',
        oandaFetchFailed: oanda?.fetchFailed ?? true,
        commissionPaidToOwner: commission?.totalCommission || 0,
        commissionTradeCount: commission?.tradeCount || 0,
        totalDeposited: depositsByUser[b.userId] || 0,
      };
    });

    res.json({
      balances: enrichedBalances,
      totalEarned,
      recentLedger,
    });
  });

  // ADMIN ONLY: Real-time OANDA account data for all connected users
  app.get("/api/admin/live-accounts", async (req, res) => {
    const userId = getUserId(req);
    if (!userId || !commissionService.isOwner(userId)) {
      return res.status(403).json({ error: "Admin only" });
    }

    try {
      const allCreds = await db.select().from(userOandaCredentials).where(eq(userOandaCredentials.isConnected, true));
      const userIds = allCreds.map(c => c.userId);

      const userRecords = userIds.length > 0
        ? await db.select().from(users).where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
        : [];

      const userSettingsRecords = userIds.length > 0
        ? await db.select().from(userSettingsTable).where(sql`${userSettingsTable.userId} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
        : [];

      const accounts = await Promise.all(allCreds.map(async (cred) => {
        const user = userRecords.find(u => u.id === cred.userId);
        const settings = userSettingsRecords.find(s => s.userId === cred.userId);
        const displayName = settings?.displayName || user?.firstName || user?.email || cred.userId.substring(0, 8);

        try {
          const decryptedKey = isEncrypted(cred.apiKey) ? decryptApiKey(cred.apiKey) : cred.apiKey;
          const oandaCreds = { apiKey: decryptedKey, accountId: cred.accountId, isLive: cred.environment === "live" };

          const [summary, openTrades] = await Promise.all([
            Promise.race([
              oandaGetAccountSummary(oandaCreds),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
            ]),
            Promise.race([
              oandaGetOpenTrades(oandaCreds),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
            ]).catch(() => [] as any[]),
          ]);

          return {
            userId: cred.userId,
            displayName,
            environment: cred.environment,
            balance: parseFloat(summary.balance) || 0,
            unrealizedPL: parseFloat(summary.unrealizedPL) || 0,
            nav: parseFloat(summary.NAV) || 0,
            currency: summary.currency || "GBP",
            openTradeCount: summary.openTradeCount || 0,
            marginUsed: parseFloat(summary.marginUsed) || 0,
            marginAvailable: parseFloat(summary.marginAvailable) || 0,
            openTrades: openTrades.map((t: any) => ({
              id: t.id,
              instrument: t.instrument?.replace("_", "/") || t.instrument,
              units: parseFloat(t.currentUnits) || 0,
              direction: parseFloat(t.currentUnits) > 0 ? "BUY" : "SELL",
              entryPrice: parseFloat(t.price) || 0,
              unrealizedPL: parseFloat(t.unrealizedPL) || 0,
              openTime: t.openTime,
            })),
            isOwner: commissionService.isOwner(cred.userId),
            autoExecuteEnabled: settings?.autoExecuteEnabled ?? false,
            status: "connected",
          };
        } catch (e) {
          return {
            userId: cred.userId,
            displayName,
            environment: cred.environment,
            balance: 0,
            unrealizedPL: 0,
            nav: 0,
            currency: "GBP",
            openTradeCount: 0,
            marginUsed: 0,
            marginAvailable: 0,
            openTrades: [],
            isOwner: commissionService.isOwner(cred.userId),
            autoExecuteEnabled: settings?.autoExecuteEnabled ?? false,
            status: "error",
          };
        }
      }));

      res.json({ accounts, timestamp: Date.now() });
    } catch (error) {
      console.error("[Admin] Failed to fetch live accounts:", error);
      res.status(500).json({ error: "Failed to fetch account data" });
    }
  });

  // ===== END COMMISSION & STRIPE ROUTES =====
  
  // Load active strategy profiles for signal generation
  await loadActiveStrategyProfiles();
  
  const previousOandaPrices: Record<string, number> = {};
  
  app.get("/api/markets", async (req, res) => {
    try {
      let oandaPrices: Record<string, { bid: number; ask: number; mid: number }> = {};
      if (oandaService.isConfigured()) {
        try {
          oandaPrices = await oandaService.getAllPrices([...instruments]);
        } catch (e) {
          console.warn("[Markets] OANDA prices failed, using cached data");
        }
      }

      const analyses = instruments.map(instrument => {
        let analysis = storage.getCachedAnalysis(instrument, DEFAULT_TIMEFRAME);
        if (!analysis) {
          analysis = generateMockAnalysis(instrument, DEFAULT_TIMEFRAME);
          storage.setCachedAnalysis(analysis);
        }
        
        const oandaPrice = oandaPrices[instrument];
        if (oandaPrice && oandaPrice.mid > 0) {
          const prevPrice = previousOandaPrices[instrument];
          if (prevPrice && prevPrice > 0) {
            analysis.changePercent = ((oandaPrice.mid - prevPrice) / prevPrice) * 100;
          }
          analysis.currentPrice = oandaPrice.mid;
          previousOandaPrices[instrument] = oandaPrice.mid;
          storage.setCachedAnalysis(analysis);
        }
        
        return analysis;
      });

      res.json(analyses);
    } catch (error) {
      console.error("Error fetching markets:", error);
      res.status(500).json({ error: "Failed to fetch market data" });
    }
  });

  // Get detailed analysis for a specific instrument
  app.get("/api/analysis/:instrument/:timeframe", async (req, res) => {
    try {
      const { instrument, timeframe } = req.params;
      
      if (!instruments.includes(instrument as Instrument)) {
        return res.status(400).json({ error: "Invalid instrument" });
      }
      if (!timeframes.includes(timeframe as Timeframe)) {
        return res.status(400).json({ error: "Invalid timeframe" });
      }

      const inst = instrument as Instrument;
      const tf = timeframe as Timeframe;

      // Check cache - use 2 HOUR TTL to minimize API usage (smart caching)
      const cached = storage.getCachedAnalysis(inst, tf);
      const cacheTTL = 2 * 60 * 60 * 1000; // 2 hours - matches price cache
      
      // Helper to override price with OANDA real-time data
      const overrideWithOandaPrice = async (analysis: typeof cached) => {
        if (!analysis) return analysis;
        if (oandaService.isConfigured()) {
          try {
            const price = await oandaService.getPrice(inst);
            if (price && price.bid > 0) {
              analysis.currentPrice = (price.bid + price.ask) / 2;
            }
          } catch (e) {
            // Keep cached price
          }
        }
        return analysis;
      };
      
      if (cached && cached.lastUpdated) {
        const cacheAge = Date.now() - new Date(cached.lastUpdated).getTime();
        if (cacheAge < cacheTTL) {
          // Even for cached data, override price with real-time OANDA price
          const updatedCached = await overrideWithOandaPrice(cached);
          return res.json(updatedCached);
        }
      }

      // Try to fetch data using Twelve Data (historicalDataService) - uses same 2-hour cache
      try {
        const histData = await historicalDataService.getHistoricalData(inst, tf, 100);
        
        if (histData.data.length > 0) {
          // Convert OHLCV to Candle format and cache
          const candles = histData.data.map(d => ({
            timestamp: d.timestamp.toISOString(),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume
          }));
          
          storage.setCachedCandles(inst, tf, candles);
          const currentPrice = candles[candles.length - 1]?.close || 0;
          const analysis = analyzeMarket(inst, tf, candles, currentPrice);
          // Override with real-time OANDA price for accuracy
          await overrideWithOandaPrice(analysis);
          storage.setCachedAnalysis(analysis);
          return res.json(analysis);
        }
      } catch (apiError) {
        console.warn("Historical data fetch failed, using mock data:", apiError);
      }

      // Fall back to mock data with OANDA price override
      const analysis = generateMockAnalysis(inst, tf);
      await overrideWithOandaPrice(analysis);
      storage.setCachedAnalysis(analysis);
      res.json(analysis);
    } catch (error) {
      console.error("Error fetching analysis:", error);
      res.status(500).json({ error: "Failed to fetch analysis" });
    }
  });

  // Get trade signal for a specific instrument
  app.get("/api/signal/:instrument/:timeframe", async (req, res) => {
    try {
      const { instrument, timeframe } = req.params;
      
      if (!instruments.includes(instrument as Instrument)) {
        return res.status(400).json({ error: "Invalid instrument" });
      }
      if (!timeframes.includes(timeframe as Timeframe)) {
        return res.status(400).json({ error: "Invalid timeframe" });
      }

      const inst = instrument as Instrument;
      const tf = timeframe as Timeframe;

      // Check signal cache - use 5 minute TTL to reduce API calls
      const cachedSignal = storage.getCachedSignal(inst, tf);
      const signalTTL = 5 * 60 * 1000; // 5 minutes
      
      if (cachedSignal && cachedSignal.timestamp) {
        const cacheAge = Date.now() - new Date(cachedSignal.timestamp).getTime();
        if (cacheAge < signalTTL) {
          return res.json(cachedSignal);
        }
      }

      // Get or generate analysis
      let analysis = storage.getCachedAnalysis(inst, tf);
      if (!analysis) {
        analysis = generateMockAnalysis(inst, tf);
        storage.setCachedAnalysis(analysis);
      }

      // Get learning adjustment based on historical performance
      const signalConditions = {
        trendStrength: analysis.trend.strength,
        trendDirection: analysis.trend.direction,
        volatility: analysis.volatility,
        marketState: analysis.marketState,
        nearSupport: analysis.supportLevels.some(s => 
          Math.abs(analysis.currentPrice - s.price) / analysis.currentPrice < 0.003
        ),
        nearResistance: analysis.resistanceLevels.some(r => 
          Math.abs(analysis.currentPrice - r.price) / analysis.currentPrice < 0.003
        ),
        confidenceLevel: "medium" as const,
      };
      
      const learningAdjustment = await storage.getConfidenceAdjustment(signalConditions);
      
      // Check if this setup should be filtered out (very poor historical performance)
      const learning = await storage.getLearningPerformance();
      const allTrades = await storage.getSimulatedTrades();
      const trades = allTrades.filter(t => t.status !== "open" && t.conditions);
      const hasEnoughData = trades.length >= learning.minTradesForLearning;
      
      // Filter out setups with <30% win rate (if we have enough data)
      let shouldFilter = false;
      if (hasEnoughData && learningAdjustment <= -15) {
        // Very poor setup - check if it's consistently losing
        const trendBucket = analysis.trend.strength < 40 ? "weak" :
                           analysis.trend.strength < 70 ? "moderate" : "strong";
        const setupKey = `${analysis.marketState}_${analysis.volatility}_${trendBucket}`;
        
        const worstSetup = learning.worstSetups.find(s => 
          s.description.includes(analysis.marketState) && 
          s.description.includes(analysis.volatility)
        );
        
        if (worstSetup && worstSetup.winRate < 50 && worstSetup.totalTrades >= 5) {
          shouldFilter = true;
        }
      }

      // Generate signal with learning adjustment
      const signal = generateSignal(analysis);
      if (signal) {
        // If setup should be filtered, set to stand_aside
        if (shouldFilter) {
          signal.direction = "stand_aside";
          signal.confidence = 0;
          signal.reasoning.push("FILTERED: This setup has <30% historical win rate - avoiding");
          res.json(signal);
          return;
        }
        
        // Apply learning adjustment to confidence
        signal.confidence = Math.max(30, Math.min(95, signal.confidence + learningAdjustment));
        
        // Add learning note to reasoning if adjustment applied
        if (learningAdjustment !== 0) {
          signal.reasoning.push(
            learningAdjustment > 0 
              ? `Learning boost: +${learningAdjustment}% (similar setups have performed well)`
              : `Learning penalty: ${learningAdjustment}% (similar setups have underperformed)`
          );
        }
        
        // === MICRO-SCALPER MOMENTUM CONFIRMATION ===
        const scalperMomentum = microScalperManager.getMomentumForInstrument(signal.instrument);
        if (scalperMomentum) {
          const momentumAligned = (signal.direction === "buy" && scalperMomentum.direction === "buy") ||
                                   (signal.direction === "sell" && scalperMomentum.direction === "sell");
          const momentumConflict = (signal.direction === "buy" && scalperMomentum.direction === "sell") ||
                                    (signal.direction === "sell" && scalperMomentum.direction === "buy");
          
          if (momentumAligned && scalperMomentum.strength >= 0.6) {
            const momentumBoost = Math.round(scalperMomentum.strength * 5);
            signal.confidence = Math.min(95, signal.confidence + momentumBoost);
            signal.reasoning.push(`Live momentum confirms ${signal.direction}: +${momentumBoost}% (${scalperMomentum.movePips.toFixed(1)} pip burst)`);
          } else if (momentumConflict && scalperMomentum.strength >= 0.8) {
            const momentumPenalty = Math.round(scalperMomentum.strength * 3);
            signal.confidence = Math.max(30, signal.confidence - momentumPenalty);
            signal.reasoning.push(`Live momentum opposes ${signal.direction}: -${momentumPenalty}% (${scalperMomentum.movePips.toFixed(1)} pip counter-move)`);
          }
        }
        
        // === PRICE-BASED DUPLICATE PREVENTION ===
        const existingCachedSignal = storage.getCachedSignal(signal.instrument as Instrument, signal.timeframe as Timeframe);
        const entryPrice = (signal.entryZone.low + signal.entryZone.high) / 2;
        const existingEntry = existingCachedSignal ? (existingCachedSignal.entryZone.low + existingCachedSignal.entryZone.high) / 2 : 0;
        const isMetal = signal.instrument === "XAUUSD" || signal.instrument === "XAGUSD";
        const minPriceDiff = signal.instrument === "XAUUSD" ? 5.0 : isMetal ? 0.3 : 0.003;
        const priceDiff = Math.abs(entryPrice - existingEntry);
        const signalAgeMs = existingCachedSignal ? Date.now() - new Date(existingCachedSignal.timestamp).getTime() : Infinity;
        const priceMovedEnough = priceDiff >= minPriceDiff;
        const isSameDirection = existingCachedSignal?.direction === signal.direction;
        
        // Determine if this is a NEW distinct signal (not duplicate)
        const isNewDistinctSignal = !existingCachedSignal || 
          signalAgeMs > 60 * 60 * 1000 || // 1 hour passed
          (priceMovedEnough && signalAgeMs > 15 * 60 * 1000) || // Price moved + 15 min
          (!isSameDirection && signalAgeMs > 15 * 60 * 1000); // Opposite direction + 15 min
        
        // Only update cache when this is a new distinct signal (prevents blocking scanner)
        if (isNewDistinctSignal) {
          storage.setCachedSignal(signal);
        }
        
        // Only save/execute if this is a new distinct signal
        if (isNewDistinctSignal && signal.direction !== "stand_aside") {
          if (!isForexMarketOpen()) {
            console.log(`[SignalScanner] Market closed (weekend) - skipping ${signal.instrument} ${signal.timeframe} ${signal.direction}`);
          } else {
          saveSignalToDatabase(signal);
          
          // Auto-create simulated trade if enabled (trade notification sent per-user inside)
          let manualUserTradeIds: Map<string, string> | undefined;
          if (storage.isSimulationEnabled()) {
            manualUserTradeIds = await createSimulatedTradeFromSignal(signal, analysis);
          }
          
          // Auto-execute on OANDA for ALL users with auto-trade enabled (multi-user)
          if (signal.confidence >= 70) {
            try {
              await autoExecuteForAllUsers(signal as TradeSignal, entryPrice, manualUserTradeIds);
            } catch (oandaError) {
              console.error("[OANDA Auto-Trade] Error:", oandaError);
            }
          }
          }
        }
      }

      res.json(signal);
    } catch (error) {
      console.error("Error generating signal:", error);
      res.status(500).json({ error: "Failed to generate signal" });
    }
  });

  // Get smart money / institutional analysis
  app.get("/api/smart-money/:instrument/:timeframe", async (req, res) => {
    try {
      const { instrument, timeframe } = req.params;
      
      if (!instruments.includes(instrument as Instrument)) {
        return res.status(400).json({ error: "Invalid instrument" });
      }
      if (!timeframes.includes(timeframe as Timeframe)) {
        return res.status(400).json({ error: "Invalid timeframe" });
      }
      
      const inst = instrument as Instrument;
      const tf = timeframe as Timeframe;
      const candles = storage.getCachedCandles(inst, tf);
      
      // Get current price from cached analysis for the selected timeframe
      const cachedAnalysis = storage.getCachedAnalysis(inst, tf);
      const currentPrice = cachedAnalysis?.currentPrice || 
        (inst === "XAUUSD" ? 5073 : inst === "XAGUSD" ? 32.50 : 1.05);
      
      const smartMoneyData = analyzeSmartMoney(inst, currentPrice, candles);
      
      res.json(smartMoneyData);
    } catch (error) {
      console.error("Error analyzing smart money:", error);
      res.status(500).json({ error: "Failed to analyze institutional levels" });
    }
  });

  app.post("/api/refresh", async (req, res) => {
    try {
      const now = new Date();
      storage.setLastRefreshTime(now);
      
      let pricesUpdated = 0;
      
      if (oandaService.isConfigured()) {
        try {
          const oandaPrices = await oandaService.getAllPrices([...instruments]);
          for (const inst of instruments) {
            const oPrice = oandaPrices[inst];
            if (oPrice && oPrice.mid > 0) {
              const cached = storage.getCachedAnalysis(inst, DEFAULT_TIMEFRAME);
              if (cached) {
                cached.currentPrice = oPrice.mid;
                storage.setCachedAnalysis(cached);
              }
              pricesUpdated++;
            }
          }
        } catch (e) {
          console.warn("[Refresh] OANDA price fetch failed:", e);
        }
      }
      
      if (pricesUpdated === 0 && twelveDataService.isActive()) {
        const refreshResult = await twelveDataService.refresh();
        const livePrices = twelveDataService.getAllPrices();
        for (const inst of instruments) {
          const livePrice = livePrices.find(p => p.instrument === inst);
          if (livePrice && livePrice.source === 'twelvedata') {
            const midPrice = (livePrice.bid + livePrice.ask) / 2;
            const cached = storage.getCachedAnalysis(inst, DEFAULT_TIMEFRAME);
            if (cached) {
              cached.currentPrice = midPrice;
              storage.setCachedAnalysis(cached);
            }
            pricesUpdated++;
          }
        }
      }

      res.json({ 
        success: true, 
        timestamp: now.toISOString(),
        pricesUpdated,
        source: pricesUpdated > 0 ? 'oanda' : 'none'
      });
    } catch (error) {
      console.error("Error refreshing data:", error);
      res.status(500).json({ error: "Failed to refresh data" });
    }
  });

  // Calculate position size with Zod validation
  app.post("/api/position-size", async (req, res) => {
    try {
      const validationResult = positionSizeInputSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid input", 
          details: validationResult.error.errors 
        });
      }

      const { accountBalance, riskPercent, stopLossPips, instrument } = validationResult.data;
      const takeProfitPips = req.body.takeProfitPips; // Optional field

      const pipValues: Record<string, number> = {
        XAUUSD: 0.1,
        XAGUSD: 0.01,
        EURUSD: 0.0001,
        GBPUSD: 0.0001,
        USDCHF: 0.0001,
        AUDUSD: 0.0001,
        NZDUSD: 0.0001,
        USDJPY: 0.01,
        USDCAD: 0.0001,
        EURGBP: 0.0001,
        EURJPY: 0.01,
        GBPJPY: 0.01,
      };

      const contractSizes: Record<string, number> = {
        XAUUSD: 100,
        XAGUSD: 5000,
        EURUSD: 100000,
        GBPUSD: 100000,
        USDCHF: 100000,
        AUDUSD: 100000,
        NZDUSD: 100000,
        USDJPY: 100000,
        USDCAD: 100000,
        EURGBP: 100000,
        EURJPY: 100000,
        GBPJPY: 100000,
      };

      const pipValue = pipValues[instrument] || 0.0001;
      const contractSize = contractSizes[instrument] || 100000;
      const gbpUsdRate = 1.27; // Approximate rate

      const riskAmount = accountBalance * (riskPercent / 100);
      const pipValueGBP = (pipValue * contractSize) / gbpUsdRate;
      const lotSize = Math.max(0.001, Math.floor((riskAmount / (stopLossPips * pipValueGBP)) * 1000) / 1000);
      const potentialLoss = lotSize * stopLossPips * pipValueGBP;
      const potentialProfit = takeProfitPips ? lotSize * takeProfitPips * pipValueGBP : undefined;

      res.json({
        lotSize,
        riskAmount,
        pipValue: pipValueGBP,
        potentialLoss,
        potentialProfit,
      });
    } catch (error) {
      console.error("Error calculating position size:", error);
      res.status(500).json({ error: "Failed to calculate position size" });
    }
  });

  // === PAPER ACCOUNT ROUTES ===
  
  app.get("/api/paper-account", async (req, res) => {
    try {
      const userId = getUserId(req);
      const account = await storage.getPaperAccount(userId || undefined);
      const trades = await storage.getSimulatedTrades();
      const userTrades = trades.filter((t: SimulatedTrade) => t.userId === userId);
      const closedTrades = userTrades.filter((t: SimulatedTrade) => t.status !== "open" && t.pnlMoney !== undefined);
      const totalReturn = account.currentBalance - account.startingBalance;
      const returnPercent = account.startingBalance > 0 ? (totalReturn / account.startingBalance) * 100 : 0;
      const openTrades = userTrades.filter((t: SimulatedTrade) => t.status === "open");
      
      res.json({
        ...account,
        totalReturn,
        returnPercent,
        closedTradeCount: closedTrades.length,
        openTradeCount: openTrades.length,
      });
    } catch (error) {
      console.error("Error getting paper account:", error);
      res.status(500).json({ error: "Failed to get paper account" });
    }
  });

  app.post("/api/paper-account/setup", async (req, res) => {
    try {
      const userId = getUserId(req);
      const uid = userId || undefined;
      const { startingBalance, currency, riskPercent } = req.body;
      
      if (riskPercent !== undefined && startingBalance === undefined) {
        const clampedRisk = Math.max(0.5, Math.min(5, riskPercent));
        await storage.updatePaperAccount({ riskPercent: clampedRisk }, uid);
        const account = await storage.getPaperAccount(uid);
        return res.json({ success: true, account });
      }
      
      if (!startingBalance || startingBalance < 10 || startingBalance > 1000000) {
        return res.status(400).json({ error: "Balance must be between 10 and 1,000,000" });
      }
      
      const validCurrencies = ["GBP", "USD", "EUR"];
      if (currency && !validCurrencies.includes(currency)) {
        return res.status(400).json({ error: "Currency must be GBP, USD, or EUR" });
      }
      
      await storage.resetPaperAccount(
        startingBalance, 
        currency || "GBP",
        uid
      );
      
      if (riskPercent !== undefined) {
        await storage.updatePaperAccount({ riskPercent: Math.max(0.5, Math.min(5, riskPercent)) }, uid);
      }
      
      const account = await storage.getPaperAccount(uid);
      res.json({ success: true, account });
    } catch (error) {
      console.error("Error setting up paper account:", error);
      res.status(500).json({ error: "Failed to setup paper account" });
    }
  });

  app.post("/api/paper-account/reset", async (req, res) => {
    try {
      const userId = getUserId(req);
      const uid = userId || undefined;
      const account = await storage.getPaperAccount(uid);
      await storage.resetPaperAccount(account.startingBalance, account.currency, uid);
      const updated = await storage.getPaperAccount(uid);
      res.json({ success: true, account: updated });
    } catch (error) {
      console.error("Error resetting paper account:", error);
      res.status(500).json({ error: "Failed to reset paper account" });
    }
  });

  // === SIMULATION ROUTES ===
  
  app.get("/api/simulation/stats", async (req, res) => {
    try {
      const userId = getUserId(req);
      const stats = await storage.getSimulationStats(userId || undefined);
      const enabled = storage.isSimulationEnabled();

      const allTrades = await storage.getSimulatedTrades(userId || undefined);
      const openAll = allTrades.filter(t => t.status === "open");
      const oandaLinkedOpen = openAll.filter(t => t.oandaTradeId);
      const paperOpen = openAll.filter(t => !t.oandaTradeId);

      res.json({
        enabled,
        stats,
        openBreakdown: {
          oandaLinked: oandaLinkedOpen.length,
          paper: paperOpen.length,
        },
      });
    } catch (error) {
      console.error("Error getting simulation stats:", error);
      res.status(500).json({ error: "Failed to get simulation stats" });
    }
  });

  // Get per-user performance dashboard - compares user stats to system stats
  app.get("/api/user/performance", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      // Get all simulated trades
      const allTrades = await storage.getSimulatedTrades();
      const userTrades = allTrades.filter(t => t.userId === userId);
      
      // Calculate user stats
      const userStats = calculatePerformanceStats(userTrades);
      
      // Calculate system stats (all trades)
      const systemStats = calculatePerformanceStats(allTrades);
      
      res.json({
        userId: userId.slice(0, 8) + "...",
        userStats,
        systemStats,
        comparison: {
          winRateDiff: userStats.winRate - systemStats.winRate,
          profitFactorDiff: userStats.profitFactor - systemStats.profitFactor,
          avgPipsDiff: userStats.avgPipsPerTrade - systemStats.avgPipsPerTrade,
        }
      });
    } catch (error) {
      console.error("Error fetching user performance:", error);
      res.status(500).json({ error: "Failed to fetch user performance" });
    }
  });

  // Get all simulated trades (filtered by user)
  app.get("/api/simulation/trades", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.json([]);
      }
      const trades = await storage.getSimulatedTrades(userId);
      res.json(trades);
    } catch (error) {
      console.error("Error getting simulated trades:", error);
      res.status(500).json({ error: "Failed to get simulated trades" });
    }
  });

  app.get("/api/simulation/trades/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const allTrades = await storage.getSimulatedTrades(userId);
      const trade = allTrades.find(t => t.id === req.params.id);
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }
      res.json(trade);
    } catch (error) {
      console.error("Error getting simulated trade:", error);
      res.status(500).json({ error: "Failed to get trade" });
    }
  });

  app.post("/api/simulation/trades/:id/execute-oanda", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const allTrades = await storage.getSimulatedTrades(userId);
      const trade = allTrades.find(t => t.id === req.params.id && t.status === "open");
      if (!trade) {
        return res.status(404).json({ error: "Trade not found or already closed" });
      }

      if (trade.oandaTradeId) {
        return res.status(400).json({ error: `Trade already executed on OANDA (ID: ${trade.oandaTradeId})` });
      }

      if (isUserPausedByGuardian(userId)) {
        return res.status(403).json({ error: "Daily loss limit reached. New trades paused until losses recover." });
      }

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds || !dbCreds.isConnected || !dbCreds.apiKey) {
        return res.status(400).json({ error: "OANDA not connected" });
      }

      const creds: OandaCredentials = {
        apiKey: dbCreds.apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live"
      };

      const existingTrades = await oandaGetOpenTrades(creds);
      const instrumentOanda = trade.instrument.replace("XAUUSD", "XAU_USD")
        .replace("XAGUSD", "XAG_USD")
        .replace("EURUSD", "EUR_USD").replace("GBPUSD", "GBP_USD")
        .replace("USDCHF", "USD_CHF").replace("AUDUSD", "AUD_USD")
        .replace("NZDUSD", "NZD_USD");
      const hasOpenTrade = existingTrades.some((t: any) => t.instrument === instrumentOanda);
      if (hasOpenTrade) {
        return res.status(400).json({ error: `Already have open ${trade.instrument} trade on OANDA` });
      }

      const account = await oandaGetAccountSummary(creds);
      const accountBalance = parseFloat(account.balance);
      
      const userSettings = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId)).limit(1);
      const riskPercent = userSettings[0]?.defaultRiskPercent || 1;
      const pipSize = PIP_VALUES[trade.instrument] || 0.0001;
      const slDistance = Math.abs(trade.entryPrice - trade.stopLoss);
      const slPips = slDistance / pipSize;

      let lotInfo = calculateLotSize(accountBalance, riskPercent, slPips, trade.instrument, account.currency || "USD", trade.entryPrice);
      if (lotInfo.skipped) {
        return res.status(400).json({ error: `Cannot size trade: ${lotInfo.skipReason}` });
      }

      const unitsPerLot = CONTRACT_SIZES[trade.instrument] || 100000;
      const slDist = Math.abs(trade.entryPrice - trade.stopLoss);
      let simTp = trade.takeProfit1 || (trade.direction === "buy" ? trade.entryPrice + slDist * 2 : trade.entryPrice - slDist * 2);
      let simSl = trade.stopLoss;
      
      const simMinSl = enforceMinimumSlDistance(trade.instrument, trade.entryPrice, simSl, simTp, trade.direction);
      if (simMinSl.widened) {
        simSl = simMinSl.stopLoss;
        simTp = simMinSl.takeProfit;
        const widenedSlDist = Math.abs(trade.entryPrice - simSl);
        const widenedSlPips = widenedSlDist / pipSize;
        lotInfo = calculateLotSize(accountBalance, riskPercent, widenedSlPips, trade.instrument, account.currency || "USD", trade.entryPrice);
        if (lotInfo.skipped) {
          return res.status(400).json({ error: `Cannot size trade after SL widening: ${lotInfo.skipReason}` });
        }
      }

      const maxUnits = unitsPerLot * 1;
      const rawUnits = Math.min(lotInfo.units, maxUnits);
      const units = trade.direction === "buy" ? rawUnits : -rawUnits;

      const result = await oandaPlaceMarketOrder(creds, trade.instrument, units, simSl, simTp);
      if (!result.success) {
        return res.status(500).json({ error: "Failed to place OANDA order" });
      }

      const lotSize = Math.round((Math.abs(units) / unitsPerLot) * 1000) / 1000;
      console.log(`[ManualExecute] User ${userId.slice(0, 8)}... placed ${trade.instrument} ${trade.direction} ${lotSize} lots on OANDA - Trade ID: ${result.tradeId}`);

      if (result.tradeId) {
        await storage.updateSimulatedTrade(trade.id, { oandaTradeId: result.tradeId });
      }

      res.json({ 
        success: true, 
        tradeId: result.tradeId, 
        lotSize,
        units: Math.abs(units),
        message: `${trade.direction.toUpperCase()} ${trade.instrument} ${lotSize} lots placed on OANDA`
      });
    } catch (error) {
      console.error("Error executing trade on OANDA:", error);
      res.status(500).json({ error: "Failed to execute trade on OANDA" });
    }
  });

  app.post("/api/simulation/trades/:id/close", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const { id } = req.params;
      const trades = await storage.getSimulatedTrades(userId);
      const trade = trades.find(t => t.id === id && t.status === "open");
      if (!trade) {
        return res.status(404).json({ error: "Trade not found or already closed" });
      }

      let currentPrice: number | null = null;
      if (oandaService.isConfigured()) {
        const prices = await oandaService.getAllPrices([trade.instrument]);
        if (prices[trade.instrument]) {
          currentPrice = trade.direction === "buy" ? prices[trade.instrument].bid : prices[trade.instrument].ask;
        }
      }
      if (!currentPrice) {
        const analysis = storage.getCachedAnalysis(trade.instrument, trade.timeframe);
        if (analysis) currentPrice = analysis.currentPrice;
      }
      if (!currentPrice) {
        return res.status(400).json({ error: "Cannot get current price" });
      }

      const pipSize = PIP_VALUES[trade.instrument] || 0.0001;
      const pnlPips = trade.direction === "buy"
        ? (currentPrice - trade.entryPrice) / pipSize
        : (trade.entryPrice - currentPrice) / pipSize;
      const slDist = Math.abs(trade.entryPrice - trade.stopLoss);
      const targetPips = slDist / pipSize;
      const pnlPercent = targetPips > 0 ? (pnlPips / targetPips) * 100 : 0;

      const acct = await storage.getPaperAccount(userId);
      const moneyPnl = trade.lotSize
        ? calculateMoneyPnL(pnlPips, trade.lotSize, trade.instrument, acct.currency, currentPrice)
        : undefined;

      await storage.updateSimulatedTrade(trade.id, {
        status: "manual_close",
        closedAt: new Date().toISOString(),
        closePrice: currentPrice,
        pnlPips: Math.round(pnlPips * 10) / 10,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
        pnlMoney: moneyPnl,
      });

      if (moneyPnl !== undefined) {
        const newBal = acct.currentBalance + moneyPnl;
        const newPk = Math.max(acct.peakBalance, newBal);
        const dd = newPk > 0 ? ((newPk - newBal) / newPk) * 100 : 0;
        await storage.updatePaperAccount({
          currentBalance: Math.round(newBal * 100) / 100,
          peakBalance: Math.round(newPk * 100) / 100,
          maxDrawdown: Math.round(Math.max(acct.maxDrawdown, dd) * 100) / 100,
        }, userId);
      }

      if (trade.oandaTradeId) {
        await closeLinkedOandaTrade(userId, trade.oandaTradeId, `manual close ${trade.instrument}`);
      }

      const sym = acct.currency === "GBP" ? "\u00a3" : acct.currency === "EUR" ? "\u20ac" : "$";
      console.log(`[TradeMonitor] Manual close: ${trade.instrument} ${trade.direction.toUpperCase()} | ${pnlPips.toFixed(1)} pips | ${moneyPnl !== undefined ? `${moneyPnl >= 0 ? '+' : ''}${sym}${moneyPnl.toFixed(2)}` : ''}`);

      res.json({
        success: true,
        pnlPips: Math.round(pnlPips * 10) / 10,
        pnlMoney: moneyPnl,
        closePrice: currentPrice,
      });
    } catch (error) {
      console.error("Error closing trade:", error);
      res.status(500).json({ error: "Failed to close trade" });
    }
  });

  // Toggle simulation on/off
  app.post("/api/simulation/toggle", async (req, res) => {
    try {
      const { enabled } = req.body;
      await storage.setSimulationEnabled(Boolean(enabled));
      res.json({ enabled: storage.isSimulationEnabled() });
    } catch (error) {
      console.error("Error toggling simulation:", error);
      res.status(500).json({ error: "Failed to toggle simulation" });
    }
  });

  // Update simulated trades based on current prices (called on refresh)
  app.post("/api/simulation/update", async (req, res) => {
    try {
      const openTrades = await storage.getOpenSimulatedTrades();
      let updated = 0;

      for (const trade of openTrades) {
        const analysis = storage.getCachedAnalysis(trade.instrument, trade.timeframe);
        if (!analysis) continue;

        const currentPrice = analysis.currentPrice;
        const result = checkTradeOutcome(trade, currentPrice);
        
        if (result.status !== "open") {
          await storage.updateSimulatedTrade(trade.id, {
            status: result.status,
            closedAt: new Date().toISOString(),
            closePrice: result.closePrice,
            pnlPips: result.pnlPips,
            pnlPercent: result.pnlPercent,
          });
          updated++;
        } else {
          // Update high/low tracking
          const highestPrice = Math.max(trade.highestPrice || trade.entryPrice, currentPrice);
          const lowestPrice = Math.min(trade.lowestPrice || trade.entryPrice, currentPrice);
          await storage.updateSimulatedTrade(trade.id, { highestPrice, lowestPrice });
        }
      }

      const remainingTrades = await storage.getOpenSimulatedTrades();
      res.json({ updated, openTrades: remainingTrades.length });
    } catch (error) {
      console.error("Error updating simulation:", error);
      res.status(500).json({ error: "Failed to update simulation" });
    }
  });

  // Execute a signal as a simulated trade (manual execution)
  app.post("/api/simulation/execute-signal", async (req, res) => {
    try {
      if (!isForexMarketOpen()) {
        return res.json({
          success: false,
          reason: "Forex market is closed (weekend). Trades cannot be opened until market reopens.",
        });
      }

      const {
        instrument,
        timeframe,
        direction,
        entryPrice,
        stopLoss,
        takeProfit1,
        takeProfit2,
        confidence,
        reasoning,
      } = req.body;

      // Validate required fields
      if (
        !instrument ||
        !timeframe ||
        !direction ||
        entryPrice === undefined ||
        stopLoss === undefined ||
        takeProfit1 === undefined ||
        confidence === undefined
      ) {
        return res.status(400).json({
          success: false,
          reason: "Missing required fields",
        });
      }

      const manualUserId = getUserId(req);
      const allOpenTrades = await storage.getOpenSimulatedTrades();
      const openTrades = manualUserId 
        ? allOpenTrades.filter((t) => t.userId === manualUserId)
        : allOpenTrades;

      const hasSameDirectionTrade = openTrades.some((t) => 
        t.instrument === instrument && t.direction === direction && t.timeframe === timeframe
      );
      if (hasSameDirectionTrade) {
        return res.json({
          success: false,
          reason: `Already have an open ${instrument} ${timeframe} ${direction} trade`,
        });
      }

      const hasSameTimeframeTrade = openTrades.some((t) => 
        t.instrument === instrument && t.timeframe === timeframe
      );
      if (hasSameTimeframeTrade) {
        return res.json({
          success: false,
          reason: `Already have an open ${instrument} ${timeframe} trade`,
        });
      }

      const userSettings = manualUserId ? await getUserSettings(manualUserId) : null;
      const maxPositions = userSettings?.maxOpenPositions ?? storage.getRiskManagement().maxOpenPositions;
      if (openTrades.length >= maxPositions) {
        return res.json({
          success: false,
          reason: `Max open positions (${maxPositions}) reached`,
        });
      }

      // Calculate lot size from paper account (per-user)
      const paperAccount = await storage.getPaperAccount(manualUserId || undefined);
      const slDistance = Math.abs(Number(entryPrice) - Number(stopLoss));
      const pipSize = PIP_VALUES[instrument] || 0.0001;
      const slPips = slDistance / pipSize;
      
      const lotInfo = calculateLotSize(
        paperAccount.currentBalance,
        paperAccount.riskPercent,
        slPips,
        instrument,
        paperAccount.currency,
        Number(entryPrice)
      );

      if (lotInfo.skipped) {
        return res.json({
          success: false,
          reason: `Trade risk too high for account: ${lotInfo.skipReason}`,
        });
      }

      // Create the simulated trade
      const trade: SimulatedTrade = {
        id: randomUUID(),
        userId: manualUserId || undefined,
        signalId: `${instrument}_${timeframe}_manual_${Date.now()}`,
        instrument: instrument as Instrument,
        timeframe: timeframe as Timeframe,
        direction: direction as "buy" | "sell" | "stand_aside",
        entryPrice: Number(entryPrice),
        stopLoss: Number(stopLoss),
        takeProfit1: Number(takeProfit1),
        takeProfit2: takeProfit2 !== undefined ? Number(takeProfit2) : undefined,
        status: "open",
        openedAt: new Date().toISOString(),
        highestPrice: Number(entryPrice),
        lowestPrice: Number(entryPrice),
        breakEvenApplied: false,
        halfProfitLocked: false,
        lotSize: lotInfo.lotSize,
      };

      // Save the trade
      await storage.addSimulatedTrade(trade);

      res.json({
        success: true,
        tradeId: trade.id,
      });
    } catch (error) {
      console.error("Error executing signal:", error);
      res.status(500).json({
        success: false,
        reason: "Failed to execute signal",
      });
    }
  });

  // Get learning performance insights
  app.get("/api/learning/performance", async (req, res) => {
    try {
      const performance = await storage.getLearningPerformance();
      res.json(performance);
    } catch (error) {
      console.error("Error fetching learning performance:", error);
      res.status(500).json({ error: "Failed to fetch learning performance" });
    }
  });

  // === INSTITUTIONAL DATA ROUTES ===

  // Get COT (Commitment of Traders) data
  app.get("/api/cot", (req, res) => {
    try {
      const instrument = req.query.instrument as Instrument | undefined;
      if (instrument) {
        const data = storage.getCOTData(instrument);
        res.json(data || null);
      } else {
        res.json(storage.getAllCOTData());
      }
    } catch (error) {
      console.error("Error getting COT data:", error);
      res.status(500).json({ error: "Failed to get COT data" });
    }
  });

  // Get retail sentiment data
  app.get("/api/sentiment", (req, res) => {
    try {
      const instrument = req.query.instrument as Instrument | undefined;
      if (instrument) {
        const data = storage.getRetailSentiment(instrument);
        res.json(data || null);
      } else {
        res.json(storage.getAllRetailSentiment());
      }
    } catch (error) {
      console.error("Error getting sentiment data:", error);
      res.status(500).json({ error: "Failed to get sentiment data" });
    }
  });

  // Get correlation data
  app.get("/api/correlations", (req, res) => {
    try {
      res.json(storage.getCorrelations());
    } catch (error) {
      console.error("Error getting correlation data:", error);
      res.status(500).json({ error: "Failed to get correlation data" });
    }
  });

  // === RISK MANAGEMENT ROUTES ===

  // Get risk management settings
  app.get("/api/risk-management", (req, res) => {
    try {
      res.json(storage.getRiskManagement());
    } catch (error) {
      console.error("Error getting risk management:", error);
      res.status(500).json({ error: "Failed to get risk management" });
    }
  });

  // Update risk management settings
  app.post("/api/risk-management", async (req, res) => {
    try {
      await storage.setRiskManagement(req.body);
      res.json(storage.getRiskManagement());
    } catch (error) {
      console.error("Error updating risk management:", error);
      res.status(500).json({ error: "Failed to update risk management" });
    }
  });

  // Get daily P/L
  app.get("/api/daily-pnl", async (req, res) => {
    try {
      const userId = getUserId(req);
      const allTrades = await storage.getSimulatedTrades(userId || undefined);
      const today = new Date().toISOString().split("T")[0];
      
      const todayClosedTrades = allTrades.filter(t => 
        t.status !== "open" && 
        t.closedAt && 
        t.closedAt.startsWith(today)
      );
      
      const todayPnlMoney = todayClosedTrades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
      const todayPnlPips = todayClosedTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
      
      const acct = await storage.getPaperAccount(userId || undefined);
      const startOfDayBalance = acct.currentBalance - todayPnlMoney;
      const pnlPercent = startOfDayBalance > 0 ? (todayPnlMoney / startOfDayBalance) * 100 : 0;
      
      const wins = todayClosedTrades.filter(t => (t.pnlPips || 0) > 0).length;
      const losses = todayClosedTrades.filter(t => (t.pnlPips || 0) <= 0).length;
      
      let consecutiveLosses = 0;
      for (let i = todayClosedTrades.length - 1; i >= 0; i--) {
        if ((todayClosedTrades[i].pnlPips || 0) <= 0) consecutiveLosses++;
        else break;
      }
      
      const riskSettings = storage.getRiskManagement();
      const pnlUserSettings = userId ? await getUserSettings(userId) : null;
      const userDailyLimit = pnlUserSettings?.dailyLossLimitPercent ?? riskSettings.dailyLossLimitPercent;
      const isLimitReached = pnlPercent <= -userDailyLimit;
      
      res.json({
        date: today,
        startingBalance: Math.round(startOfDayBalance * 100) / 100,
        currentPnL: Math.round(todayPnlMoney * 100) / 100,
        currentPnLPercent: Math.round(pnlPercent * 100) / 100,
        currentPnLPips: Math.round(todayPnlPips * 10) / 10,
        tradesExecuted: todayClosedTrades.length,
        wins,
        losses,
        consecutiveLosses,
        isLimitReached,
        isConsecutiveLossLockout: consecutiveLosses >= (riskSettings.consecutiveLossLimit || 5),
      });
    } catch (error) {
      console.error("Error getting daily P/L:", error);
      res.status(500).json({ error: "Failed to get daily P/L" });
    }
  });

  app.get("/api/daily-briefing", async (req, res) => {
    try {
      const userId = getUserId(req);
      const allTrades = await storage.getSimulatedTrades(userId || undefined);
      const today = new Date().toISOString().split("T")[0];

      const todayClosedTrades = allTrades.filter(t =>
        t.status !== "open" &&
        t.closedAt &&
        t.closedAt.startsWith(today)
      );
      const openTrades = allTrades.filter(t => t.status === "open");

      const todayPnlMoney = todayClosedTrades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
      const todayPnlPips = todayClosedTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
      const wins = todayClosedTrades.filter(t => (t.pnlPips || 0) > 0).length;
      const losses = todayClosedTrades.filter(t => (t.pnlPips || 0) <= 0).length;

      const acct = await storage.getPaperAccount(userId || undefined);
      const startOfDayBalance = acct.currentBalance - todayPnlMoney;
      const pnlPercent = startOfDayBalance > 0 ? (todayPnlMoney / startOfDayBalance) * 100 : 0;
      const totalReturn = acct.currentBalance - acct.startingBalance;
      const totalReturnPercent = acct.startingBalance > 0 ? (totalReturn / acct.startingBalance) * 100 : 0;

      let consecutiveLosses = 0;
      for (let i = todayClosedTrades.length - 1; i >= 0; i--) {
        if ((todayClosedTrades[i].pnlPips || 0) <= 0) consecutiveLosses++;
        else break;
      }

      const riskSettings = storage.getRiskManagement();
      const briefUserSettings = userId ? await getUserSettings(userId) : null;
      const userDailyLimit = briefUserSettings?.dailyLossLimitPercent ?? riskSettings.dailyLossLimitPercent;
      const isLimitReached = pnlPercent <= -userDailyLimit;
      const isConsecutiveLockout = consecutiveLosses >= (riskSettings.consecutiveLossLimit || 5);

      const instrumentPnl: Record<string, number> = {};
      todayClosedTrades.forEach(t => {
        const inst = t.instrument;
        instrumentPnl[inst] = (instrumentPnl[inst] || 0) + (t.pnlPips || 0);
      });
      let topInstrument: string | null = null;
      let topPips = 0;
      for (const [inst, pips] of Object.entries(instrumentPnl)) {
        if (pips > topPips) { topInstrument = inst; topPips = pips; }
      }

      let oanda: any = null;
      if (userId) {
        try {
          const dbCreds = await getUserOandaCredentials(userId);
          if (dbCreds?.isConnected && dbCreds.apiKey) {
            const creds: OandaCredentials = {
              apiKey: dbCreds.apiKey,
              accountId: dbCreds.accountId,
              isLive: dbCreds.environment === "live",
            };
            const account = await oandaGetAccountSummary(creds);
            const oandaTrades = await oandaGetOpenTrades(creds);
            oanda = {
              connected: true,
              environment: dbCreds.environment,
              balance: parseFloat(account.balance),
              currency: account.currency || "GBP",
              unrealizedPL: parseFloat(account.unrealizedPL || "0"),
              openTradeCount: oandaTrades.length,
            };
          }
        } catch (e) {
          oanda = { connected: false };
        }
      }

      const optimizerStatus = await autoOptimizer.getStatus();

      const allSignals = storage.getAllCachedSignals?.() || [];
      const todaySignals = allSignals.filter((s: any) =>
        s.timestamp?.startsWith?.(today) || s.generatedAt?.startsWith?.(today)
      );

      res.json({
        date: today,
        paper: {
          balance: Math.round(acct.currentBalance * 100) / 100,
          startingBalance: acct.startingBalance,
          currency: acct.currency || "GBP",
          totalReturn: Math.round(totalReturn * 100) / 100,
          totalReturnPercent: Math.round(totalReturnPercent * 100) / 100,
          dailyPnl: Math.round(todayPnlMoney * 100) / 100,
          dailyPnlPercent: Math.round(pnlPercent * 100) / 100,
          dailyPnlPips: Math.round(todayPnlPips * 10) / 10,
          openPositions: openTrades.length,
          todayTrades: todayClosedTrades.length,
          wins,
          losses,
        },
        oanda,
        risk: {
          dailyLossLimit: userDailyLimit,
          currentDailyLoss: Math.round(pnlPercent * 100) / 100,
          isLimitReached,
          consecutiveLosses,
          isConsecutiveLockout,
        },
        optimizer: {
          activeProfiles: optimizerStatus.activeProfiles,
          totalProfiles: optimizerStatus.totalProfiles,
          isRunning: optimizerStatus.isRunning,
        },
        signals: {
          activeCount: todaySignals.length,
        },
        topInstrument: topInstrument ? { instrument: topInstrument, pips: Math.round(topPips * 10) / 10 } : null,
      });
    } catch (error) {
      console.error("Error getting daily briefing:", error);
      res.status(500).json({ error: "Failed to get daily briefing" });
    }
  });

  app.get("/api/risk-management/limit-check", async (req, res) => {
    try {
      const userId = getUserId(req);
      const riskSettings = storage.getRiskManagement();
      let openTrades = await storage.getOpenSimulatedTrades(userId || undefined);
      
      if (userId) {
        try {
          const lcDbCreds = await getUserOandaCredentials(userId);
          if (lcDbCreds?.isConnected && lcDbCreds.apiKey) {
            const lcCreds: OandaCredentials = {
              apiKey: lcDbCreds.apiKey,
              accountId: lcDbCreds.accountId,
              isLive: lcDbCreds.environment === "live",
            };
            const lcOandaTrades = await oandaGetOpenTrades(lcCreds);
            const lcOandaIds = new Set(lcOandaTrades.map((t: any) => t.id));
            const staleTrades = openTrades.filter(t => t.oandaTradeId && !lcOandaIds.has(t.oandaTradeId));
            if (staleTrades.length > 0) {
              for (const st of staleTrades) {
                try {
                  const td = await oandaGetTradeDetails(lcCreds, st.oandaTradeId!);
                  let cp: number | null = td?.closePrice ?? null;
                  if (!cp) {
                    const a = storage.getCachedAnalysis(st.instrument, st.timeframe);
                    if (a) cp = a.currentPrice;
                  }
                  if (cp) {
                    const ps = st.instrument === "XAUUSD" ? 0.1 : st.instrument === "XAGUSD" ? 0.01 : st.instrument.includes("JPY") ? 0.01 : 0.0001;
                    const pp = st.direction === "buy" ? (cp - st.entryPrice) / ps : (st.entryPrice - cp) / ps;
                    const sd = Math.abs(st.entryPrice - st.stopLoss);
                    const tp = sd / ps;
                    const pct = tp > 0 ? (pp / tp) * 100 : 0;
                    const ac = await storage.getPaperAccount(userId);
                    const mp = st.lotSize ? calculateMoneyPnL(pp, st.lotSize, st.instrument, ac.currency, cp) : undefined;
                    await storage.updateSimulatedTrade(st.id, {
                      status: "manual_close",
                      closedAt: new Date().toISOString(),
                      closePrice: cp,
                      pnlPips: Math.round(pp * 10) / 10,
                      pnlPercent: Math.round(pct * 100) / 100,
                      pnlMoney: mp,
                    });
                    if (mp !== undefined) {
                      const nb = ac.currentBalance + mp;
                      const pk = Math.max(ac.peakBalance, nb);
                      const dd = pk > 0 ? ((pk - nb) / pk) * 100 : 0;
                      await storage.updatePaperAccount({
                        currentBalance: Math.round(nb * 100) / 100,
                        peakBalance: Math.round(pk * 100) / 100,
                        maxDrawdown: Math.round(Math.max(ac.maxDrawdown, dd) * 100) / 100,
                      }, userId);
                    }
                    console.log(`[LimitCheck] Fast-sync closed stale sim trade ${st.id.slice(0, 8)} (${st.instrument}) - OANDA trade gone`);
                    deductCommissionIfApplicable(userId, st.id, mp, st.instrument).catch(() => {});
                  }
                } catch {}
              }
              openTrades = await storage.getOpenSimulatedTrades(userId);
            }
          }
        } catch {}
      }

      const allTrades = await storage.getSimulatedTrades(userId || undefined);
      const today = new Date().toISOString().split("T")[0];
      const todayClosed = allTrades.filter(t => t.status !== "open" && t.closedAt && t.closedAt.startsWith(today));
      const todayPnlMoney = todayClosed.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
      const acct = await storage.getPaperAccount(userId || undefined);
      const startBal = acct.currentBalance - todayPnlMoney;
      const pnlPercent = startBal > 0 ? (todayPnlMoney / startBal) * 100 : 0;
      
      let consecutiveLosses = 0;
      for (let i = todayClosed.length - 1; i >= 0; i--) {
        if ((todayClosed[i].pnlPips || 0) <= 0) consecutiveLosses++;
        else break;
      }
      
      const riskUserId = getUserId(req);
      const riskUserSettings = riskUserId ? await getUserSettings(riskUserId) : null;
      const userMaxPositions = riskUserSettings?.maxOpenPositions ?? riskSettings.maxOpenPositions;
      const userDailyLossLimit = riskUserSettings?.dailyLossLimitPercent ?? riskSettings.dailyLossLimitPercent;
      const userConsecutiveLossLimit = riskSettings.consecutiveLossLimit || 5;

      const dailyLimitReached = pnlPercent <= -userDailyLossLimit;
      const consecutiveLossLockout = consecutiveLosses >= userConsecutiveLossLimit;
      const manualLock = storage.isTradingLocked();
      const isLocked = dailyLimitReached || consecutiveLossLockout || manualLock.locked;
      const lockReason = manualLock.locked ? manualLock.reason : dailyLimitReached ? `Daily loss limit reached (${userDailyLossLimit}%)` : consecutiveLossLockout ? `${consecutiveLosses} consecutive losses` : undefined;

      res.json({
        dailyLimitReached,
        maxPositionsReached: openTrades.length >= userMaxPositions,
        openPositions: openTrades.length,
        maxPositions: userMaxPositions,
        dailyPnLPercent: Math.round(pnlPercent * 100) / 100,
        dailyLimit: userDailyLossLimit,
        consecutiveLosses,
        consecutiveLossLimit: userConsecutiveLossLimit,
        consecutiveLossLockout,
        tradingLocked: isLocked,
        lockoutReason: lockReason,
        minAccountBalance: riskSettings.minAccountBalance,
      });
    } catch (error) {
      console.error("Error checking risk limits:", error);
      res.status(500).json({ error: "Failed to check risk limits" });
    }
  });

  // Reset consecutive loss counter (manual override - only resets consecutive losses, not daily limit)
  app.post("/api/risk-management/reset-lockout", (req, res) => {
    try {
      const dailyPnL = storage.getDailyPnL();
      
      // Can only reset consecutive losses, not daily loss limit
      if (dailyPnL.isLimitReached) {
        return res.status(400).json({ 
          success: false, 
          error: "Cannot reset - daily loss limit reached. Trading will resume tomorrow.",
          dailyLimitReached: true,
        });
      }
      
      storage.resetConsecutiveLosses();
      res.json({ success: true, message: "Consecutive loss lockout reset - you may resume trading" });
    } catch (error) {
      console.error("Error resetting lockout:", error);
      res.status(500).json({ error: "Failed to reset lockout" });
    }
  });

  // Get live prices - OANDA PRIMARY, Twelve Data secondary
  app.get("/api/prices/live", async (req, res) => {
    try {
      // PRIORITY 1: Use OANDA real-time prices (most accurate when connected)
      if (oandaService.isConfigured()) {
        const oandaPrices = await oandaService.getAllPrices([...instruments]);
        if (Object.keys(oandaPrices).length > 0) {
          const prices = instruments.map(inst => {
            const oPrice = oandaPrices[inst];
            if (oPrice) {
              return {
                instrument: inst,
                bid: oPrice.bid,
                ask: oPrice.ask,
                timestamp: new Date(),
                source: 'oanda' as const,
              };
            }
            // Fallback for missing instruments
            return null;
          }).filter(p => p !== null);
          
          if (prices.length > 0) {
            res.json(prices);
            return;
          }
        }
      }
      
      // PRIORITY 2: Try Twelve Data (if credits available)
      if (twelveDataService.isActive()) {
        const prices = twelveDataService.getAllPrices();
        if (prices.length > 0) {
          res.json(prices);
          return;
        }
      }
      
      // PRIORITY 3: Fallback with CORRECT base prices (as of Feb 2026)
      const basePrices: Record<string, number> = {
        "XAUUSD": 2860,  // Actual gold price ~$2860/oz
        "XAGUSD": 32.50, // Silver ~$32.50/oz
        "EURUSD": 1.0380,
        "GBPUSD": 1.2520,
        "USDCHF": 0.9010,
        "AUDUSD": 0.6310,
        "NZDUSD": 0.5680,
      };
      
      const fallbackPrices = instruments.map(inst => {
        const basePrice = basePrices[inst] || 1.0;
        const spread = inst === "XAUUSD" ? 0.30 : inst === "XAGUSD" ? 0.03 : 0.00015;
        return {
          instrument: inst,
          bid: basePrice - spread / 2,
          ask: basePrice + spread / 2,
          timestamp: new Date(),
          source: 'fallback' as const,
        };
      });
      
      res.json(fallbackPrices);
    } catch (error) {
      console.error("Error getting live prices:", error);
      res.status(500).json({ error: "Failed to get live prices" });
    }
  });

  app.post("/api/prices/refresh", async (req, res) => {
    try {
      if (oandaService.isConfigured()) {
        const oandaPrices = await oandaService.getAllPrices([...instruments]);
        const count = Object.keys(oandaPrices).length;
        if (count > 0) {
          return res.json({ success: true, message: `OANDA live prices refreshed (${count} instruments)` });
        }
      }
      const result = await twelveDataService.refresh();
      res.json(result);
    } catch (error) {
      console.error("Error refreshing prices:", error);
      res.status(500).json({ error: "Failed to refresh prices" });
    }
  });

  // Cache status endpoint - shows how old data is
  app.get("/api/cache/status", (req, res) => {
    try {
      const cacheAgeMinutes = twelveDataService.getCacheAge();
      const isCacheValid = twelveDataService.isCacheValid();
      res.json({
        pricesCacheAgeMinutes: cacheAgeMinutes,
        pricesCacheValid: isCacheValid,
        mode: 'on-demand',
        message: cacheAgeMinutes === -1 
          ? 'No data cached yet - click refresh to fetch' 
          : `Data is ${cacheAgeMinutes} minutes old (valid for 4 hours)`
      });
    } catch (error) {
      console.error("Error getting cache status:", error);
      res.status(500).json({ error: "Failed to get cache status" });
    }
  });

  // === WHALE ZONE & ADVANCED INSTITUTIONAL DATA ===
  
  // Get whale zone data (order blocks, liquidity hunts, stop clusters)
  app.get("/api/whale-zone/:instrument/:timeframe", (req, res) => {
    try {
      const { instrument, timeframe } = req.params as { instrument: Instrument; timeframe: Timeframe };
      const analysis = storage.getCachedAnalysis(instrument, timeframe);
      const currentPrice = analysis?.currentPrice || 0;
      
      // Generate enhanced whale zone data
      const whaleData = generateWhaleZoneData(instrument, currentPrice);
      res.json(whaleData);
    } catch (error) {
      console.error("Error getting whale zone data:", error);
      res.status(500).json({ error: "Failed to get whale zone data" });
    }
  });
  
  // Get upcoming economic events
  app.get("/api/economic-events", (req, res) => {
    try {
      const events = generateEconomicEvents();
      res.json(events);
    } catch (error) {
      console.error("Error getting economic events:", error);
      res.status(500).json({ error: "Failed to get economic events" });
    }
  });
  
  // Check news blackout status for an instrument
  app.get("/api/news-blackout/:instrument", (req, res) => {
    try {
      const { instrument } = req.params as { instrument: Instrument };
      const riskSettings = storage.getRiskManagement();
      const blackoutMinutes = riskSettings.newsBlackoutMinutes;
      
      const events = generateEconomicEvents();
      const now = new Date();
      
      // Check if any high-impact event affecting this instrument is within blackout window
      const isBlackout = events.some(event => {
        if (event.impact !== "high") return false;
        if (!event.affectedPairs.includes(instrument)) return false;
        
        const eventTime = new Date(event.dateTime);
        const diffMinutes = Math.abs(eventTime.getTime() - now.getTime()) / (1000 * 60);
        return diffMinutes <= blackoutMinutes;
      });
      
      const nextHighImpact = events
        .filter(e => e.impact === "high" && e.affectedPairs.includes(instrument))
        .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())[0];
      
      res.json({
        isBlackout,
        blackoutMinutes,
        nextHighImpactEvent: nextHighImpact || null,
        instrument,
      });
    } catch (error) {
      console.error("Error checking news blackout:", error);
      res.status(500).json({ error: "Failed to check news blackout" });
    }
  });
  
  // Get current trading session info with filter recommendation
  app.get("/api/session-filter", (req, res) => {
    try {
      const riskSettings = storage.getRiskManagement();
      const now = new Date();
      const utcHour = now.getUTCHours();
      
      // Determine current session
      let currentSession: "asian" | "london" | "new_york" | "closed" = "closed";
      if (utcHour >= 23 || utcHour < 8) currentSession = "asian";
      else if (utcHour >= 7 && utcHour < 16) currentSession = "london";
      else if (utcHour >= 13 && utcHour < 22) currentSession = "new_york";
      
      const isPreferredSession = riskSettings.preferredSessions.includes(currentSession);
      const shouldTrade = !riskSettings.sessionFilterEnabled || isPreferredSession;
      
      // Session quality based on typical volatility
      const sessionQuality = {
        asian: { volatility: "low", recommendation: "Avoid breakout trades, range trading preferred" },
        london: { volatility: "high", recommendation: "Best for trend trades and breakouts" },
        new_york: { volatility: "high", recommendation: "Good momentum, watch for reversals at overlap" },
        closed: { volatility: "very_low", recommendation: "Weekend - markets closed" },
      };
      
      res.json({
        currentSession,
        isPreferredSession,
        shouldTrade,
        filterEnabled: riskSettings.sessionFilterEnabled,
        preferredSessions: riskSettings.preferredSessions,
        ...sessionQuality[currentSession],
      });
    } catch (error) {
      console.error("Error getting session filter:", error);
      res.status(500).json({ error: "Failed to get session filter" });
    }
  });

  // Historical data endpoint
  app.get("/api/historical/:instrument/:timeframe", async (req, res) => {
    try {
      const instrument = req.params.instrument as Instrument;
      const timeframe = req.params.timeframe as Timeframe;
      const outputSize = parseInt(req.query.size as string) || 100;
      
      if (!instruments.includes(instrument)) {
        return res.status(400).json({ error: "Invalid instrument" });
      }
      
      const result = await historicalDataService.getHistoricalData(instrument, timeframe, outputSize);
      res.json(result);
    } catch (error) {
      console.error("Error fetching historical data:", error);
      res.status(500).json({ error: "Failed to fetch historical data" });
    }
  });

  // Pattern recognition endpoint
  app.get("/api/patterns/:instrument/:timeframe", async (req, res) => {
    try {
      const instrument = req.params.instrument as Instrument;
      const timeframe = req.params.timeframe as Timeframe;
      
      if (!instruments.includes(instrument)) {
        return res.status(400).json({ error: "Invalid instrument" });
      }
      
      const historicalData = await historicalDataService.getHistoricalData(instrument, timeframe, 100);
      const patterns = patternRecognitionService.detectPatterns(historicalData.data);
      const fibonacci = patternRecognitionService.calculateFibonacciLevels(historicalData.data);
      const elliottWave = patternRecognitionService.detectElliottWave(historicalData.data);
      
      res.json({
        instrument,
        timeframe,
        patterns,
        fibonacci,
        elliottWave,
        dataSource: historicalData.source,
      });
    } catch (error) {
      console.error("Error detecting patterns:", error);
      res.status(500).json({ error: "Failed to detect patterns" });
    }
  });

  // Backtesting endpoint
  app.get("/api/backtest/:instrument/:timeframe", async (req, res) => {
    try {
      const instrument = req.params.instrument as Instrument;
      const timeframe = req.params.timeframe as Timeframe;
      
      if (!instruments.includes(instrument)) {
        return res.status(400).json({ error: "Invalid instrument" });
      }
      
      const historicalData = await historicalDataService.getHistoricalData(instrument, timeframe, 500);
      const signalGenerator = backtestingEngine.createDefaultSignalGenerator(instrument, timeframe);
      const result = await backtestingEngine.runBacktest(
        instrument, 
        timeframe, 
        historicalData.data,
        signalGenerator
      );
      
      res.json({
        ...result,
        dataSource: historicalData.source,
      });
    } catch (error) {
      console.error("Error running backtest:", error);
      res.status(500).json({ error: "Failed to run backtest" });
    }
  });

  // Divergence and Smart Money Concepts endpoint
  app.get("/api/divergence/:instrument/:timeframe", async (req, res) => {
    try {
      const instrument = req.params.instrument as Instrument;
      const timeframe = req.params.timeframe as Timeframe;
      
      if (!instruments.includes(instrument)) {
        return res.status(400).json({ error: "Invalid instrument" });
      }
      
      if (!timeframes.includes(timeframe)) {
        return res.status(400).json({ error: "Invalid timeframe" });
      }
      
      const historicalData = await historicalDataService.getHistoricalData(instrument, timeframe, 100);
      const divergences = divergenceDetectionService.detectDivergences(historicalData.data);
      const smartMoney = divergenceDetectionService.detectSmartMoneyConcepts(historicalData.data);
      
      res.json({
        instrument,
        timeframe,
        divergences,
        smartMoneyConcepts: smartMoney,
        dataSource: historicalData.source,
      });
    } catch (error) {
      console.error("Error detecting divergences:", error);
      res.status(500).json({ error: "Failed to detect divergences" });
    }
  });

  // MT5 signal export endpoint
  app.get("/api/mt5-export/:instrument/:timeframe", async (req, res) => {
    try {
      const instrument = req.params.instrument as Instrument;
      const timeframe = req.params.timeframe as Timeframe;
      
      if (!instruments.includes(instrument)) {
        return res.status(400).json({ error: "Invalid instrument" });
      }
      
      const analysis = generateMockAnalysis(instrument, timeframe, true);
      const signal = await generateSignal(analysis);
      
      if (!signal || signal.direction === 'stand_aside') {
        return res.json({
          hasSignal: false,
          message: "No trade signal at this time",
        });
      }
      
      // Format for MT5 EA consumption
      const entryPrice = (signal.entryZone.low + signal.entryZone.high) / 2;
      const mt5Signal = {
        hasSignal: true,
        symbol: instrument,
        timeframe: timeframe,
        direction: signal.direction,
        entryPrice: entryPrice,
        entryRangeMin: signal.entryZone.low,
        entryRangeMax: signal.entryZone.high,
        stopLoss: signal.stopLoss,
        takeProfit1: signal.takeProfit1,
        takeProfit2: signal.takeProfit2 || signal.takeProfit1,
        takeProfit3: signal.takeProfit2 ? signal.takeProfit2 * 1.5 - signal.takeProfit1 * 0.5 : signal.takeProfit1,
        confidence: signal.confidence,
        reason: signal.reasoning.join(', '),
        generatedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4 hours
      };
      
      res.json(mt5Signal);
    } catch (error) {
      console.error("Error generating MT5 signal:", error);
      res.status(500).json({ error: "Failed to generate MT5 signal" });
    }
  });

  // Initialize Twelve Data REST API for real-time prices
  if (process.env.TWELVE_DATA_API_KEY) {
    console.log("[Server] Starting Twelve Data price service...");
    twelveDataService.connect().then(connected => {
      if (connected) {
        console.log("[Server] Twelve Data connected - real prices active (updates every 10s)");
      } else {
        console.log("[Server] Twelve Data connection failed - using fallback prices");
      }
    });
  } else {
    console.log("[Server] No TWELVE_DATA_API_KEY set - live prices disabled. Get a free key at twelvedata.com");
  }

  // Initialize OANDA from environment variables
  oandaService.initFromEnv().catch(err => {
    console.error("[OANDA] Auto-init error:", err);
  });

  // Micro-scalper manager is initialized per-user on demand

  // === BATCH BACKTESTING ROUTES ===

  // Get stored data status - shows what historical data we have
  app.get("/api/batch-backtest/data-status", async (_req, res) => {
    const status = batchBacktestingService.getStoredDataStatus();
    res.json(status);
  });

  // Bulk download historical data for all pairs/timeframes
  // Uses 36 API calls total (6 pairs x 6 timeframes)
  app.post("/api/batch-backtest/bulk-download", async (_req, res) => {
    const results: Array<{ instrument: string; timeframe: string; status: string; candleCount?: number }> = [];
    let successCount = 0;
    let failCount = 0;

    for (const instrument of instruments) {
      for (const timeframe of timeframes) {
        try {
          // Fetch maximum candles (5000) for comprehensive backtesting
          const result = await historicalDataService.getHistoricalData(
            instrument as Instrument, 
            timeframe as Timeframe,
            5000 // Max candles for thorough backtesting
          );

          if (result && result.data && result.data.length > 0) {
            // Convert OHLCV format to Candle format
            const candles = result.data.map(d => ({
              timestamp: d.timestamp.toISOString(),
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
              volume: d.volume,
            }));
            
            batchBacktestingService.storeHistoricalData(
              instrument as Instrument,
              timeframe as Timeframe,
              candles,
              result.source
            );
            results.push({ instrument, timeframe, status: "success", candleCount: candles.length });
            successCount++;
          } else {
            results.push({ instrument, timeframe, status: "no_data" });
            failCount++;
          }
        } catch (error) {
          console.error(`[BatchBacktest] Error fetching ${instrument}/${timeframe}:`, error);
          results.push({ instrument, timeframe, status: "error" });
          failCount++;
        }
      }
    }

    res.json({
      message: `Bulk download complete: ${successCount} successful, ${failCount} failed`,
      totalApiCalls: instruments.length * timeframes.length,
      results,
    });
  });

  // Run batch backtests using stored data (0 API calls)
  app.post("/api/batch-backtest/run", async (req, res) => {
    const { testsPerPair, instrumentFilter, timeframeFilter } = req.body;

    const status = batchBacktestingService.getStoredDataStatus();
    if (status.totalStored === 0) {
      return res.status(400).json({
        error: "No historical data stored. Run bulk-download first.",
        dataStatus: status,
      });
    }

    const result = batchBacktestingService.runBatchBacktest({
      testsPerPair: testsPerPair || 10,
      instrumentFilter: instrumentFilter?.length ? instrumentFilter : undefined,
      timeframeFilter: timeframeFilter?.length ? timeframeFilter : undefined,
    });

    res.json(result);
  });

  // Get latest backtest results
  app.get("/api/batch-backtest/results", async (_req, res) => {
    const results = batchBacktestingService.getLatestResults();
    res.json(results);
  });

  // Store data from existing historical cache
  app.post("/api/batch-backtest/store-cached", async (_req, res) => {
    let storedCount = 0;
    
    for (const instrument of instruments) {
      for (const timeframe of timeframes) {
        const cached = storage.getCachedCandles(instrument as Instrument, timeframe as Timeframe);
        if (cached && cached.length > 0) {
          batchBacktestingService.storeHistoricalData(
            instrument as Instrument,
            timeframe as Timeframe,
            cached,
            "cached"
          );
          storedCount++;
        }
      }
    }

    const status = batchBacktestingService.getStoredDataStatus();
    res.json({
      message: `Stored ${storedCount} datasets from cache`,
      dataStatus: status,
    });
  });

  function getInstrumentWinRatesFromRealityCheck(): Map<string, { winRate: number; totalTrades: number }> {
    const rcStats = getRealityCheckStats();
    const result = new Map<string, { winRate: number; totalTrades: number }>();

    const instrumentAgg = new Map<string, { totalWR: number; totalDataPoints: number; count: number }>();
    for (const [key, stats] of rcStats) {
      const instrument = key.split("_")[0];
      if (!instrumentAgg.has(instrument)) instrumentAgg.set(instrument, { totalWR: 0, totalDataPoints: 0, count: 0 });
      const agg = instrumentAgg.get(instrument)!;
      const dataPoints = Math.max(stats.signalTotal, stats.tradeTotal);
      agg.totalWR += stats.combinedWR * dataPoints;
      agg.totalDataPoints += dataPoints;
      agg.count++;
    }

    for (const [instrument, agg] of instrumentAgg) {
      result.set(instrument, {
        winRate: agg.totalDataPoints > 0 ? Math.round(agg.totalWR / agg.totalDataPoints) : 50,
        totalTrades: agg.totalDataPoints,
      });
    }

    return result;
  }

  app.get("/api/signals/active", async (_req, res) => {
    try {
      const cachedSignals = storage.getAllCachedSignals();
      const activeSignals = cachedSignals.filter(s => {
        if (s.direction === "stand_aside") return false;
        if (s.confidence < 55) return false;
        const signalAge = Date.now() - new Date(s.timestamp).getTime();
        const maxAge = 4 * 60 * 60 * 1000;
        if (signalAge > maxAge) return false;
        return true;
      });

      const winRates = getInstrumentWinRatesFromRealityCheck();

      const rankedSignals = activeSignals.map(s => {
        const wr = winRates.get(s.instrument) || { winRate: 50, totalTrades: 0 };
        const confidenceScore = (s.confidence / 100) * 40;
        const winRateScore = (wr.winRate / 100) * 40;
        const rrScore = Math.min((s.riskRewardRatio || 0) / 5, 1) * 20;
        const signalScore = Math.round(confidenceScore + winRateScore + rrScore);
        return {
          ...s,
          pairWinRate: wr.winRate,
          pairTotalTrades: wr.totalTrades,
          signalScore,
          isTopPick: false,
        };
      });

      rankedSignals.sort((a, b) => b.signalScore - a.signalScore);

      if (rankedSignals.length > 0) {
        rankedSignals[0].isTopPick = true;
      }

      res.json({ signals: rankedSignals });
    } catch (error) {
      console.error("Error fetching active signals:", error);
      res.json({ signals: [] });
    }
  });

  // Get performance data for Performance page (filtered by user)
  app.get("/api/performance", async (req, res) => {
    try {
      const userId = getUserId(req);
      const allTrades = await storage.getSimulatedTrades();
      const trades = userId ? allTrades.filter(t => t.userId === userId) : [];
      const closedTrades = trades.filter(t => t.status !== "open");
      
      const wins = closedTrades.filter(t => (t.pnlPips || 0) > 0);
      const losses = closedTrades.filter(t => (t.pnlPips || 0) <= 0);
      
      const totalPips = closedTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
      const winPips = wins.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
      const lossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pnlPips || 0), 0));
      
      const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
      const profitFactor = lossPips > 0 ? winPips / lossPips : winPips > 0 ? 999 : 0;
      
      // Group by instrument
      const byInstrument: Record<string, { trades: number; winRate: number; pips: number }> = {};
      for (const inst of instruments) {
        const instTrades = closedTrades.filter(t => t.instrument === inst);
        const instWins = instTrades.filter(t => (t.pnlPips || 0) > 0);
        const instPips = instTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
        if (instTrades.length > 0) {
          byInstrument[inst] = {
            trades: instTrades.length,
            winRate: (instWins.length / instTrades.length) * 100,
            pips: instPips,
          };
        }
      }
      
      // Group by timeframe
      const byTimeframe: Record<string, { trades: number; winRate: number; pips: number; totalMoney: number }> = {};
      for (const tf of timeframes) {
        const tfTrades = closedTrades.filter(t => t.timeframe === tf);
        const tfWins = tfTrades.filter(t => (t.pnlPips || 0) > 0);
        if (tfTrades.length > 0) {
          byTimeframe[tf] = {
            trades: tfTrades.length,
            winRate: (tfWins.length / tfTrades.length) * 100,
            pips: tfTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0),
            totalMoney: tfTrades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0),
          };
        }
      }
      
      // Group by pair + timeframe combo
      const byPairTimeframe: Array<{
        instrument: string;
        timeframe: string;
        trades: number;
        wins: number;
        losses: number;
        winRate: number;
        totalPips: number;
        avgPips: number;
        totalMoney: number;
        avgMoney: number;
      }> = [];
      for (const inst of instruments) {
        for (const tf of timeframes) {
          const combo = closedTrades.filter(t => t.instrument === inst && t.timeframe === tf);
          if (combo.length > 0) {
            const comboWins = combo.filter(t => (t.pnlPips || 0) > 0);
            const comboPips = combo.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
            const comboMoney = combo.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
            byPairTimeframe.push({
              instrument: inst,
              timeframe: tf,
              trades: combo.length,
              wins: comboWins.length,
              losses: combo.length - comboWins.length,
              winRate: (comboWins.length / combo.length) * 100,
              totalPips: comboPips,
              avgPips: comboPips / combo.length,
              totalMoney: comboMoney,
              avgMoney: comboMoney / combo.length,
            });
          }
        }
      }
      byPairTimeframe.sort((a, b) => b.trades - a.trades || b.winRate - a.winRate);
      
      // Find best/worst instruments
      const instEntries = Object.entries(byInstrument);
      const bestInstrument = instEntries.length > 0 
        ? instEntries.reduce((best, curr) => curr[1].winRate > best[1].winRate ? curr : best)
        : null;
      const worstInstrument = instEntries.length > 0
        ? instEntries.reduce((worst, curr) => curr[1].winRate < worst[1].winRate ? curr : worst)
        : null;
      
      // Recent trades
      const recentTrades = closedTrades
        .sort((a, b) => new Date(b.closedAt || 0).getTime() - new Date(a.closedAt || 0).getTime())
        .slice(0, 20)
        .map(t => ({
          id: t.id,
          instrument: t.instrument,
          direction: t.direction.toUpperCase(),
          result: (t.pnlPips || 0) > 0 ? "WIN" : "LOSS",
          pips: t.pnlPips || 0,
          timestamp: t.closedAt || t.openedAt,
        }));

      // Get user currency
      const userSettings = userId ? await getUserSettings(userId) : null;
      const currency = userSettings?.paperCurrency || "GBP";
      const currencySymbol = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";

      // Account balance for % calculations
      const startingBalance = userSettings?.paperStartingBalance || 500;
      const currentBalance = userSettings?.paperCurrentBalance || startingBalance;
      const totalReturn = currentBalance - startingBalance;
      const totalReturnPct = startingBalance > 0 ? (totalReturn / startingBalance) * 100 : 0;

      // Daily P&L breakdown (last 30 days) with running balance for % calc
      const dailyPnl: Array<{
        date: string;
        trades: number;
        wins: number;
        losses: number;
        winRate: number;
        pips: number;
        pnl: number;
        pnlPercent: number;
      }> = [];
      const dailyMap = new Map<string, typeof closedTrades>();
      for (const t of closedTrades) {
        const rawDate = t.closedAt || t.openedAt;
        if (!rawDate) continue;
        const d = new Date(rawDate).toISOString().slice(0, 10);
        if (!d || d === "Inval") continue;
        if (!dailyMap.has(d)) dailyMap.set(d, []);
        dailyMap.get(d)!.push(t);
      }
      const sortedDaysAsc = Array.from(dailyMap.keys()).sort((a, b) => a.localeCompare(b));
      let runningBalance = startingBalance;
      const dailyPnlMap = new Map<string, typeof dailyPnl[0]>();
      for (const day of sortedDaysAsc) {
        const dayTrades = dailyMap.get(day)!;
        const dayWins = dayTrades.filter(t => (t.pnlPips || 0) > 0);
        const dayPips = dayTrades.reduce((s, t) => s + (t.pnlPips || 0), 0);
        const dayPnl = dayTrades.reduce((s, t) => s + (t.pnlMoney || 0), 0);
        const startOfDayBal = runningBalance;
        const pnlPercent = startOfDayBal > 0 ? (dayPnl / startOfDayBal) * 100 : 0;
        runningBalance += dayPnl;
        const entry = {
          date: day,
          trades: dayTrades.length,
          wins: dayWins.length,
          losses: dayTrades.length - dayWins.length,
          winRate: dayTrades.length > 0 ? (dayWins.length / dayTrades.length) * 100 : 0,
          pips: Math.round(dayPips * 10) / 10,
          pnl: Math.round(dayPnl * 100) / 100,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
        };
        dailyPnlMap.set(day, entry);
      }
      const sortedDays = sortedDaysAsc.reverse().slice(0, 30);
      for (const day of sortedDays) {
        dailyPnl.push(dailyPnlMap.get(day)!);
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const todayData = dailyPnl.find(d => d.date === todayStr);
      const avgDailyPnl = dailyPnl.length > 0 ? dailyPnl.reduce((s, d) => s + d.pnl, 0) / dailyPnl.length : 0;
      const avgDailyPips = dailyPnl.length > 0 ? dailyPnl.reduce((s, d) => s + d.pips, 0) / dailyPnl.length : 0;
      const avgDailyPct = dailyPnl.length > 0 ? dailyPnl.reduce((s, d) => s + d.pnlPercent, 0) / dailyPnl.length : 0;
      const profitDays = dailyPnl.filter(d => d.pnl > 0).length;
      const lossDays = dailyPnl.filter(d => d.pnl < 0).length;
      
      res.json({
        totalTrades: closedTrades.length,
        wins: wins.length,
        losses: losses.length,
        winRate,
        profitFactor,
        totalPips,
        bestInstrument: bestInstrument ? { name: bestInstrument[0], winRate: bestInstrument[1].winRate } : null,
        worstInstrument: worstInstrument ? { name: worstInstrument[0], winRate: worstInstrument[1].winRate } : null,
        byInstrument,
        byTimeframe,
        byPairTimeframe,
        recentTrades,
        dailyPnl,
        todayPnl: todayData || { date: todayStr, trades: 0, wins: 0, losses: 0, winRate: 0, pips: 0, pnl: 0, pnlPercent: 0 },
        avgDailyPnl: Math.round(avgDailyPnl * 100) / 100,
        avgDailyPips: Math.round(avgDailyPips * 10) / 10,
        avgDailyPct: Math.round(avgDailyPct * 100) / 100,
        profitDays,
        lossDays,
        tradingDays: dailyPnl.length,
        currency,
        currencySymbol,
        accountBalance: Math.round(currentBalance * 100) / 100,
        totalReturnPct: Math.round(totalReturnPct * 100) / 100,
      });
    } catch (error) {
      console.error("Error fetching performance:", error);
      res.json({
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        profitFactor: 0,
        totalPips: 0,
        bestInstrument: null,
        worstInstrument: null,
        byInstrument: {},
        byTimeframe: {},
        byPairTimeframe: [],
        recentTrades: [],
      });
    }
  });

  app.get("/api/quiz/progress", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.json({ totalScore: 0, bestStreak: 0, quizAnswered: 0, candleAnswered: 0, tradeAnswered: 0 });
      const [progress] = await db.select().from(quizProgress).where(eq(quizProgress.userId, userId)).limit(1);
      return res.json(progress || { totalScore: 0, bestStreak: 0, quizAnswered: 0, candleAnswered: 0, tradeAnswered: 0 });
    } catch (err) {
      return res.json({ totalScore: 0, bestStreak: 0, quizAnswered: 0, candleAnswered: 0, tradeAnswered: 0 });
    }
  });

  app.post("/api/quiz/progress", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { scoreToAdd, streak, mode } = req.body;
      const modeField = mode === "candles" ? "candleAnswered" : mode === "simulator" ? "tradeAnswered" : "quizAnswered";

      const [existing] = await db.select().from(quizProgress).where(eq(quizProgress.userId, userId)).limit(1);
      if (existing) {
        const updates: Record<string, any> = {
          totalScore: existing.totalScore + (scoreToAdd || 0),
          bestStreak: Math.max(existing.bestStreak, streak || 0),
          updatedAt: new Date().toISOString(),
        };
        updates[modeField] = (existing as any)[modeField] + 1;
        await db.update(quizProgress).set(updates).where(eq(quizProgress.userId, userId));
      } else {
        const insert: Record<string, any> = {
          userId,
          totalScore: scoreToAdd || 0,
          bestStreak: streak || 0,
          updatedAt: new Date().toISOString(),
        };
        insert[modeField] = 1;
        await db.insert(quizProgress).values(insert as any);
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("[Quiz] Error saving progress:", err);
      return res.status(500).json({ error: "Failed to save progress" });
    }
  });

  app.get("/api/quiz/leaderboard", async (req, res) => {
    try {
      const currentUserId = getUserId(req);
      const allProgress = await db.select().from(quizProgress);
      if (!allProgress.length) return res.json([]);

      const allUsers = await db.select().from(users);
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      const allSettings = await db.select().from(userSettingsTable);
      const settingsMap = new Map(allSettings.map(s => [s.userId, s]));
      const optedOut = new Set(allSettings.filter(s => s.showOnLeaderboard === false).map(s => s.userId));

      const entries = allProgress
        .filter(p => p.totalScore > 0 && !optedOut.has(p.userId))
        .map(p => {
          const user = userMap.get(p.userId);
          const settings = settingsMap.get(p.userId);
          const customName = settings?.displayName;
          const authName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
          const displayName = customName || (authName && authName !== 'John Doe' ? authName : `Player ${p.userId.slice(0, 4)}`);
          return {
            displayName,
            profileImage: user?.profileImageUrl || null,
            totalScore: p.totalScore,
            bestStreak: p.bestStreak,
            quizAnswered: p.quizAnswered,
            candleAnswered: p.candleAnswered,
            tradeAnswered: p.tradeAnswered,
            totalAnswered: p.quizAnswered + p.candleAnswered + p.tradeAnswered,
            isCurrentUser: p.userId === currentUserId,
          };
        })
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 20);

      res.json(entries);
    } catch (err) {
      console.error("[Quiz] Leaderboard error:", err);
      res.json([]);
    }
  });

  // Cross-user performance leaderboard
  app.get("/api/leaderboard", async (req, res) => {
    try {
      const currentUserId = getUserId(req);
      const allTrades = await storage.getSimulatedTrades();
      const closedTrades = allTrades.filter(t => t.status !== "open" && t.pnlPips !== null && t.pnlPips !== undefined);
      
      const userIds = new Set<string>();
      closedTrades.forEach(t => { if (t.userId) userIds.add(t.userId); });
      
      const allUsers = await db.select().from(users);
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      
      const allSettings = await db.select().from(userSettingsTable);
      const settingsMap = new Map(allSettings.map(s => [s.userId, s]));
      
      const optedOutUserIds = new Set(
        allSettings.filter(s => s.showOnLeaderboard === false).map(s => s.userId)
      );
      
      const leaderboardEntries = Array.from(userIds)
        .filter(userId => !optedOutUserIds.has(userId))
        .map(userId => {
        const userTrades = closedTrades.filter(t => t.userId === userId);
        const wins = userTrades.filter(t => (t.pnlPips || 0) > 0);
        const losses = userTrades.filter(t => (t.pnlPips || 0) <= 0);
        const totalPips = userTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
        const totalPnl = userTrades.reduce((sum, t) => sum + (Number(t.pnlMoney) || 0), 0);
        const winPips = wins.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
        const lossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pnlPips || 0), 0));
        const winRate = userTrades.length > 0 ? (wins.length / userTrades.length) * 100 : 0;
        const profitFactor = lossPips > 0 ? winPips / lossPips : (winPips > 0 ? 999 : 0);
        
        const user = userMap.get(userId);
        const settings = settingsMap.get(userId);
        const startingBalance = settings?.paperStartingBalance || 500;
        const currentBalance = settings?.paperCurrentBalance || startingBalance;
        const returnPct = startingBalance > 0 ? ((currentBalance - startingBalance) / startingBalance) * 100 : 0;
        
        const customName = settings?.displayName;
        const authName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
        const displayName = customName || (authName && authName !== 'John Doe' ? authName : `Trader ${userId.slice(0, 4)}`);
        const profileImage = user?.profileImageUrl || null;
        
        return {
          odId: userId.slice(0, 4) + "***",
          displayName,
          profileImage,
          totalTrades: userTrades.length,
          wins: wins.length,
          losses: losses.length,
          winRate: Math.round(winRate * 10) / 10,
          profitFactor: Math.round(profitFactor * 100) / 100,
          totalPips: Math.round(totalPips * 10) / 10,
          totalPnl: Math.round(totalPnl * 100) / 100,
          returnPct: Math.round(returnPct * 10) / 10,
          currency: settings?.paperCurrency || "GBP",
          isCurrentUser: userId === currentUserId,
        };
      });
      
      leaderboardEntries.sort((a, b) => b.returnPct - a.returnPct);
      leaderboardEntries.forEach((entry, i) => { (entry as any).rank = i + 1; });
      
      const systemTotalTrades = closedTrades.length;
      const systemWins = closedTrades.filter(t => (t.pnlPips || 0) > 0).length;
      const systemTotalPips = closedTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
      const systemTotalPnl = closedTrades.reduce((sum, t) => sum + (Number(t.pnlMoney) || 0), 0);
      
      const instrumentCounts: Record<string, number> = {};
      closedTrades.forEach(t => {
        instrumentCounts[t.instrument] = (instrumentCounts[t.instrument] || 0) + 1;
      });
      const bestInstrument = Object.entries(instrumentCounts).sort((a, b) => b[1] - a[1])[0];
      
      res.json({
        leaderboard: leaderboardEntries,
        systemStats: {
          totalUsers: userIds.size,
          totalTrades: systemTotalTrades,
          totalWins: systemWins,
          overallWinRate: systemTotalTrades > 0 ? Math.round((systemWins / systemTotalTrades) * 1000) / 10 : 0,
          totalPips: Math.round(systemTotalPips * 10) / 10,
          totalPnl: Math.round(systemTotalPnl * 100) / 100,
          mostTradedInstrument: bestInstrument ? bestInstrument[0] : "N/A",
        },
      });
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  });

  // Micro-scalper leaderboard
  app.get("/api/scalper/leaderboard", async (req, res) => {
    try {
      const currentUserId = getUserId(req);
      const allScalperTrades = await db.select().from(microScalperTradesTable);
      const closedTrades = allScalperTrades.filter(t => t.status === "closed" && t.pnlPips !== null);
      
      const scalperUserIds = new Set<string>();
      closedTrades.forEach(t => { if (t.userId) scalperUserIds.add(t.userId); });
      
      const allUsers = await db.select().from(users);
      const userMap = new Map(allUsers.map(u => [u.id, u]));
      
      const allSettings = await db.select().from(userSettingsTable);
      const optedOutUserIds = new Set(
        allSettings.filter(s => s.showOnLeaderboard === false).map(s => s.userId)
      );
      
      const scalperSettings = await db.select().from(microScalperSettingsTable);
      const scalperSettingsMap = new Map(scalperSettings.map(s => [s.userId, s]));
      
      const entries = Array.from(scalperUserIds)
        .filter(userId => !optedOutUserIds.has(userId))
        .map(userId => {
          const trades = closedTrades.filter(t => t.userId === userId);
          const wins = trades.filter(t => (t.pnlPips || 0) > 0);
          const losses = trades.filter(t => (t.pnlPips || 0) <= 0);
          const totalPips = trades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
          const totalPnl = trades.reduce((sum, t) => sum + (Number(t.pnlMoney) || 0), 0);
          const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
          const winPips = wins.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
          const lossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pnlPips || 0), 0));
          const profitFactor = lossPips > 0 ? winPips / lossPips : (winPips > 0 ? 999 : 0);
          
          const ss = scalperSettingsMap.get(userId);
          const startBal = ss?.startingBalance || 500;
          const curBal = ss?.currentBalance || startBal;
          const returnPct = startBal > 0 ? ((curBal - startBal) / startBal) * 100 : 0;
          
          const user = userMap.get(userId);
          const sett = allSettings.find(s => s.userId === userId);
          const customName = sett?.displayName;
          const authName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';
          const displayName = customName || (authName && authName !== 'John Doe' ? authName : `Scalper ${userId.slice(0, 4)}`);
          
          return {
            odId: userId.slice(0, 4) + "***",
            displayName,
            profileImage: user?.profileImageUrl || null,
            totalTrades: trades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: Math.round(winRate * 10) / 10,
            profitFactor: Math.round(profitFactor * 100) / 100,
            totalPips: Math.round(totalPips * 10) / 10,
            totalPnl: Math.round(totalPnl * 100) / 100,
            returnPct: Math.round(returnPct * 10) / 10,
            currency: ss?.currency || "GBP",
            isCurrentUser: userId === currentUserId,
          };
        });
      
      entries.sort((a, b) => b.returnPct - a.returnPct);
      entries.forEach((entry, i) => { (entry as any).rank = i + 1; });
      
      res.json({
        leaderboard: entries,
        systemStats: {
          totalScalpers: scalperUserIds.size,
          totalTrades: closedTrades.length,
          totalWins: closedTrades.filter(t => (t.pnlPips || 0) > 0).length,
          overallWinRate: closedTrades.length > 0 ? Math.round((closedTrades.filter(t => (t.pnlPips || 0) > 0).length / closedTrades.length) * 1000) / 10 : 0,
          totalPips: Math.round(closedTrades.reduce((s, t) => s + (t.pnlPips || 0), 0) * 10) / 10,
        },
      });
    } catch (error) {
      console.error("Error fetching scalper leaderboard:", error);
      res.status(500).json({ error: "Failed to fetch scalper leaderboard" });
    }
  });

  // Register persistent journal and signal history routes
  registerJournalRoutes(app);

  // Start automatic trade monitoring (runs every 30 seconds)
  startTradeMonitor();
  
  // Start background signal scanner (generates signals automatically)
  startBackgroundSignalScanner();

  setTimeout(async () => {
    try {
      const pendingSignals = await db.select()
        .from(signalHistoryTable)
        .where(isNull(signalHistoryTable.outcome));
      
      if (pendingSignals.length === 0) {
        console.log("[Backfill] No pending signals to reconcile");
        return;
      }

      const closedTrades = await db.select()
        .from(simulatedTradesTable)
        .where(ne(simulatedTradesTable.status, "open"));

      let updated = 0;
      for (const signal of pendingSignals) {
        if (!signal.generatedAt || signal.direction === "stand_aside") continue;
        const sigTime = new Date(signal.generatedAt).getTime();
        const tfWindowMap: Record<string, number> = { "1m": 2*60*1000, "5m": 5*60*1000, "15m": 15*60*1000, "1h": 60*60*1000, "4h": 4*60*60*1000 };
        const windowMs = tfWindowMap[signal.timeframe || ""] || 15 * 60 * 1000;

        const candidates = closedTrades.filter(t =>
          t.instrument === signal.instrument &&
          t.timeframe === signal.timeframe &&
          t.direction === signal.direction &&
          t.closePrice &&
          Math.abs(new Date(t.openedAt).getTime() - sigTime) <= windowMs
        );

        const match = candidates.length > 0
          ? candidates.reduce((best, t) => {
              const delta = Math.abs(new Date(t.openedAt).getTime() - sigTime);
              const bestDelta = Math.abs(new Date(best.openedAt).getTime() - sigTime);
              return delta < bestDelta ? t : best;
            })
          : null;

        if (match && match.closePrice) {
          const pnlPips = match.pnlPips ?? 0;
          let outcome: string;
          if (match.status === "tp_hit") {
            outcome = "tp1_hit";
          } else if (match.status === "sl_hit") {
            outcome = "sl_hit";
          } else {
            outcome = pnlPips > 0 ? "managed_close" : pnlPips < -1 ? "sl_hit" : "expired";
          }

          await db.update(signalHistoryTable)
            .set({
              outcome,
              outcomePrice: match.closePrice,
              outcomeTime: match.closedAt || new Date().toISOString(),
            })
            .where(eq(signalHistoryTable.id, signal.id));
          updated++;
        }
      }

      console.log(`[Backfill] Reconciled ${updated}/${pendingSignals.length} pending signals with closed trades`);
    } catch (error) {
      console.error("[Backfill] Error reconciling signals:", error);
    }
  }, 5000);

  // Auto-restart micro-scalper for users who had it enabled (delayed to allow server to fully start)
  setTimeout(async () => {
    try {
      await microScalperManager.autoRestartEnabled();
    } catch (error) {
      console.error("[MicroScalper] Auto-restart failed:", error);
    }
  }, 10000);

  // One-time fix: correct inflated P&L on historical trades that used OANDA realizedPL
  setTimeout(async () => {
    try {
      const fixes = [
        { id: "b22072a9-2fdf-4626-96cb-572ee59dbde7", userId: "53443452", correctPnl: 19.59, oldPnl: 267.56 },
        { id: "50639542-938f-4b8c-a59b-5a67170b4341", userId: "53443452", correctPnl: 83.60, oldPnl: 313.9 },
        { id: "ff419435-4674-449a-a863-63a01380e49b", userId: "54479382", correctPnl: 19.62, oldPnl: 262.2565 },
        { id: "5f8e5551-67ba-4ae2-8506-de1c5c43b900", userId: "54479382", correctPnl: 3.51, oldPnl: 119.8091 },
      ];
      
      let totalFixedTim = 0;
      let totalFixedUser2 = 0;
      
      for (const fix of fixes) {
        const result = await db.select({ pnlMoney: simulatedTradesTable.pnlMoney })
          .from(simulatedTradesTable)
          .where(eq(simulatedTradesTable.id, fix.id))
          .limit(1);
        if (result.length === 0) continue;
        const currentPnl = result[0].pnlMoney ?? 0;
        if (Math.abs(currentPnl - fix.oldPnl) > 0.01) {
          console.log(`[DataFix] Trade ${fix.id.slice(0,8)} already corrected (current: ${currentPnl})`);
          continue;
        }
        
        await db.update(simulatedTradesTable)
          .set({ pnlMoney: fix.correctPnl })
          .where(eq(simulatedTradesTable.id, fix.id));
        const diff = fix.oldPnl - fix.correctPnl;
        if (fix.userId === "53443452") totalFixedTim += diff;
        else totalFixedUser2 += diff;
        console.log(`[DataFix] Fixed trade ${fix.id.slice(0,8)}: £${fix.oldPnl} -> £${fix.correctPnl} (removed £${diff.toFixed(2)})`);
      }
      
      if (totalFixedTim > 0) {
        const acct = await storage.getPaperAccount("53443452");
        const newBal = Math.round((acct.currentBalance - totalFixedTim) * 100) / 100;
        const newPk = Math.round((acct.peakBalance - totalFixedTim) * 100) / 100;
        await storage.updatePaperAccount({ currentBalance: newBal, peakBalance: newPk }, "53443452");
        console.log(`[DataFix] Tim balance adjusted: -£${totalFixedTim.toFixed(2)} -> new balance: £${newBal}`);
      }
      if (totalFixedUser2 > 0) {
        const acct = await storage.getPaperAccount("54479382");
        const newBal = Math.round((acct.currentBalance - totalFixedUser2) * 100) / 100;
        const newPk = Math.round((acct.peakBalance - totalFixedUser2) * 100) / 100;
        await storage.updatePaperAccount({ currentBalance: newBal, peakBalance: newPk }, "54479382");
        console.log(`[DataFix] User2 balance adjusted: -£${totalFixedUser2.toFixed(2)} -> new balance: £${newBal}`);
      }
      
      if (totalFixedTim === 0 && totalFixedUser2 === 0) {
        console.log("[DataFix] All trades already corrected, no changes needed");
      }
    } catch (error) {
      console.error("[DataFix] Error fixing inflated trades:", error);
    }
  }, 5000);

  return httpServer;
}

// Automatic trade monitoring - checks open trades every 30 seconds
async function closeWeekendTrades() {
  try {
    const openTrades = await storage.getOpenSimulatedTrades();
    if (openTrades.length === 0) return;
    
    let closedCount = 0;
    for (const trade of openTrades) {
      const openedAt = new Date(trade.openedAt);
      const openDay = openedAt.getUTCDay();
      const openHour = openedAt.getUTCHours();
      const isWeekendTrade = openDay === 6 || 
        (openDay === 0 && openHour < 22) ||
        (openDay === 5 && openHour >= 22);
      
      if (isWeekendTrade || !isForexMarketOpen()) {
        await storage.updateSimulatedTrade(trade.id, {
          status: "manual_close",
          closePrice: trade.entryPrice,
          closedAt: new Date().toISOString(),
          pnlPips: 0,
          pnlPercent: 0,
          pnlMoney: 0,
        });
        closedCount++;
        console.log(`[WeekendCleanup] Closed invalid trade ${trade.id} (${trade.instrument} ${trade.timeframe}) for user ${trade.userId}`);
      }
    }
    if (closedCount > 0) {
      console.log(`[WeekendCleanup] Closed ${closedCount} trades that were opened during market closure`);
    }
  } catch (err) {
    console.error("[WeekendCleanup] Error:", err);
  }
}

const lossCooldowns: Map<string, { lastLossAt: number; consecutiveLosses: number }> = new Map();

const recordSignalLoss = (instrument: string, timeframe: string, direction: string) => {
  const key = `${instrument}_${timeframe}_${direction}`;
  const existing = lossCooldowns.get(key);
  lossCooldowns.set(key, {
    lastLossAt: Date.now(),
    consecutiveLosses: (existing?.consecutiveLosses || 0) + 1,
  });
};

const recordSignalWin = (instrument: string, timeframe: string, direction: string) => {
  const key = `${instrument}_${timeframe}_${direction}`;
  lossCooldowns.delete(key);
};

const isSignalOnCooldown = (instrument: string, timeframe: string, direction: string): { blocked: boolean; reason: string } => {
  const key = `${instrument}_${timeframe}_${direction}`;
  const cd = lossCooldowns.get(key);
  if (!cd) return { blocked: false, reason: "" };

  const elapsed = Date.now() - cd.lastLossAt;
  const THIRTY_MIN = 30 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  if (cd.consecutiveLosses >= 3 && elapsed < ONE_HOUR) {
    return { blocked: true, reason: `3+ consecutive losses (${cd.consecutiveLosses}) — 1h cooldown (${Math.round((ONE_HOUR - elapsed) / 60000)}m left)` };
  }
  if (elapsed < THIRTY_MIN) {
    return { blocked: true, reason: `loss cooldown (${Math.round((THIRTY_MIN - elapsed) / 60000)}m left)` };
  }

  return { blocked: false, reason: "" };
};

const initLossCooldownsFromHistory = async () => {
  try {
    const recentTrades = await db
      .select()
      .from(simulatedTradesTable)
      .where(
        and(
          ne(simulatedTradesTable.status, "open"),
          isNotNull(simulatedTradesTable.closedAt)
        )
      )
      .orderBy(desc(simulatedTradesTable.closedAt))
      .limit(200);

    const seen = new Set<string>();
    const ownerTrades = recentTrades.filter(t => t.userId === "kKEj9v");
    for (const trade of ownerTrades) {
      const key = `${trade.instrument}_${trade.timeframe}_${trade.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if ((trade.pnlPips || 0) < 0) {
        const closedAt = trade.closedAt ? new Date(trade.closedAt).getTime() : 0;
        const elapsed = Date.now() - closedAt;
        if (elapsed < 60 * 60 * 1000) {
          let consecutive = 0;
          for (const t2 of ownerTrades) {
            if (t2.instrument === trade.instrument && t2.timeframe === trade.timeframe && t2.direction === trade.direction) {
              if ((t2.pnlPips || 0) < 0) consecutive++;
              else break;
            }
          }
          lossCooldowns.set(key, { lastLossAt: closedAt, consecutiveLosses: consecutive });
        }
      }
    }
    if (lossCooldowns.size > 0) {
      console.log(`[SignalScanner] Initialized ${lossCooldowns.size} loss cooldowns from trade history`);
    }
  } catch (err) {
    console.warn("[SignalScanner] Could not initialize loss cooldowns:", err);
  }
};

function startTradeMonitor() {
  console.log("[TradeMonitor] Starting automatic trade monitoring (30s interval)");
  
  closeWeekendTrades();
  
  const monitorTrades = async () => {
    try {
      if (!isForexMarketOpen()) {
        return;
      }
      
      const openTrades = await storage.getOpenSimulatedTrades();
      if (openTrades.length === 0) return;

      let closedCount = 0;
      
      const oandaLinkedTrades = openTrades.filter(t => t.oandaTradeId && t.userId);
      if (oandaLinkedTrades.length > 0) {
        const userTradesMap = new Map<string, typeof oandaLinkedTrades>();
        for (const t of oandaLinkedTrades) {
          const uid = t.userId!;
          if (!userTradesMap.has(uid)) userTradesMap.set(uid, []);
          userTradesMap.get(uid)!.push(t);
        }
        
        for (const [userId, userTrades] of Array.from(userTradesMap.entries())) {
          try {
            const dbCreds = await getUserOandaCredentials(userId);
            if (!dbCreds || !dbCreds.isConnected || !dbCreds.apiKey) continue;
            
            const creds: OandaCredentials = {
              apiKey: dbCreds.apiKey,
              accountId: dbCreds.accountId,
              isLive: dbCreds.environment === "live",
            };
            
            const oandaOpenTrades = await oandaGetOpenTrades(creds);
            const oandaOpenIds = new Set(oandaOpenTrades.map((t: any) => t.id));
            
            for (const simTrade of userTrades) {
              if (!oandaOpenIds.has(simTrade.oandaTradeId!)) {
                const tradeDetails = await oandaGetTradeDetails(creds, simTrade.oandaTradeId!);
                
                let closePrice: number | null = tradeDetails?.closePrice ?? null;
                let moneyPnl: number | undefined = undefined;
                
                if (!closePrice) {
                  if (oandaService.isConfigured()) {
                    const prices = await oandaService.getAllPrices([simTrade.instrument]);
                    if (prices[simTrade.instrument]) {
                      closePrice = prices[simTrade.instrument].mid;
                    }
                  }
                  if (!closePrice) {
                    const analysis = storage.getCachedAnalysis(simTrade.instrument, simTrade.timeframe);
                    if (analysis) closePrice = analysis.currentPrice;
                  }
                }
                if (!closePrice) continue;
                
                const pipSize = simTrade.instrument === "XAUUSD" ? 0.1 : simTrade.instrument === "XAGUSD" ? 0.01 : 
                  simTrade.instrument.includes("JPY") ? 0.01 : 0.0001;
                const pnlPips = simTrade.direction === "buy"
                  ? (closePrice - simTrade.entryPrice) / pipSize
                  : (simTrade.entryPrice - closePrice) / pipSize;
                const slDist = Math.abs(simTrade.entryPrice - simTrade.stopLoss);
                const targetPips = slDist / pipSize;
                const pnlPercent = targetPips > 0 ? (pnlPips / targetPips) * 100 : 0;
                
                const acct = await storage.getPaperAccount(userId);
                if (moneyPnl === undefined && simTrade.lotSize) {
                  moneyPnl = calculateMoneyPnL(pnlPips, simTrade.lotSize, simTrade.instrument, acct.currency, closePrice);
                }
                
                await storage.updateSimulatedTrade(simTrade.id, {
                  status: "manual_close",
                  closedAt: new Date().toISOString(),
                  closePrice,
                  pnlPips: Math.round(pnlPips * 10) / 10,
                  pnlPercent: Math.round(pnlPercent * 100) / 100,
                  pnlMoney: moneyPnl,
                });
                
                if (moneyPnl !== undefined) {
                  const newBal = acct.currentBalance + moneyPnl;
                  const newPk = Math.max(acct.peakBalance, newBal);
                  const dd = newPk > 0 ? ((newPk - newBal) / newPk) * 100 : 0;
                  await storage.updatePaperAccount({
                    currentBalance: Math.round(newBal * 100) / 100,
                    peakBalance: Math.round(newPk * 100) / 100,
                    maxDrawdown: Math.round(Math.max(acct.maxDrawdown, dd) * 100) / 100,
                  }, userId);
                }
                
                closedCount++;
                const moneyStr = moneyPnl !== undefined ? ` | ${moneyPnl >= 0 ? '+' : ''}${acct.currency === 'GBP' ? '£' : acct.currency === 'EUR' ? '€' : '$'}${moneyPnl.toFixed(2)}` : '';
                console.log(`[TradeMonitor] OANDA sync: ${simTrade.instrument} manually closed on OANDA | ${pnlPips.toFixed(1)} pips${moneyStr}`);
                
                deductCommissionIfApplicable(userId, simTrade.id, moneyPnl, simTrade.instrument).catch(() => {});
                pushNotificationService.sendTradeNotification(userId, simTrade.instrument, simTrade.direction, 'closed', pnlPips).catch(() => {});
              }
            }
          } catch (e) {
            console.error(`[TradeMonitor] OANDA sync check failed for user ${userId}:`, e);
          }
        }
      }
      
      // Reverse sync: close OANDA trades for recently-closed simulated trades (safety net)
      const allTrades = await storage.getSimulatedTrades();
      const recentlyClosedWithOanda = allTrades.filter(t => 
        t.status !== "open" && t.oandaTradeId && t.userId &&
        t.closedAt && (Date.now() - new Date(t.closedAt).getTime()) < 48 * 60 * 60 * 1000 // last 48 hours
      );
      if (recentlyClosedWithOanda.length > 0) {
        const rcUserMap = new Map<string, typeof recentlyClosedWithOanda>();
        for (const t of recentlyClosedWithOanda) {
          const uid = t.userId!;
          if (!rcUserMap.has(uid)) rcUserMap.set(uid, []);
          rcUserMap.get(uid)!.push(t);
        }
        for (const [userId, userTrades] of Array.from(rcUserMap.entries())) {
          try {
            const dbCreds = await getUserOandaCredentials(userId);
            if (!dbCreds || !dbCreds.isConnected || !dbCreds.apiKey) continue;
            const creds: OandaCredentials = {
              apiKey: dbCreds.apiKey,
              accountId: dbCreds.accountId,
              isLive: dbCreds.environment === "live",
            };
            const oandaOpenTrades = await oandaGetOpenTrades(creds);
            const oandaOpenIds = new Set(oandaOpenTrades.map((t: any) => t.id));
            for (const simTrade of userTrades) {
              if (oandaOpenIds.has(simTrade.oandaTradeId!)) {
                console.log(`[TradeMonitor] Reverse sync: Closing orphaned OANDA trade ${simTrade.oandaTradeId} for closed ${simTrade.instrument} (${simTrade.status})`);
                await closeLinkedOandaTrade(userId, simTrade.oandaTradeId!, `reverse-sync ${simTrade.instrument} ${simTrade.status}`);
              }
            }
          } catch (e) {
            console.error(`[TradeMonitor] Reverse sync failed for user ${userId}:`, e);
          }
        }
      }

      const stillOpenTrades = await storage.getOpenSimulatedTrades();
      
      for (const trade of stillOpenTrades) {
        // Get current price from OANDA (most accurate)
        let currentPrice: number | null = null;
        
        if (oandaService.isConfigured()) {
          const prices = await oandaService.getAllPrices([trade.instrument]);
          if (prices[trade.instrument]) {
            currentPrice = prices[trade.instrument].mid;
          }
        }
        
        // Fallback to cached analysis
        if (!currentPrice) {
          const analysis = storage.getCachedAnalysis(trade.instrument, trade.timeframe);
          if (analysis) {
            currentPrice = analysis.currentPrice;
          }
        }
        
        if (!currentPrice) continue;

        const result = checkTradeOutcome(trade, currentPrice);
        
        if (result.status !== "open") {
          // Calculate monetary P&L using the trade owner's paper account
          const acct = await storage.getPaperAccount(trade.userId || undefined);
          const moneyPnl = trade.lotSize 
            ? calculateMoneyPnL(result.pnlPips || 0, trade.lotSize, trade.instrument, acct.currency, currentPrice)
            : undefined;
          
          // Trade hit SL or TP - close it
          await storage.updateSimulatedTrade(trade.id, {
            status: result.status,
            closedAt: new Date().toISOString(),
            closePrice: result.closePrice,
            pnlPips: result.pnlPips,
            pnlPercent: result.pnlPercent,
            pnlMoney: moneyPnl,
          });
          
          // Update paper account balance for the trade owner
          if (moneyPnl !== undefined) {
            const newBalance = acct.currentBalance + moneyPnl;
            const newPeak = Math.max(acct.peakBalance, newBalance);
            const drawdown = newPeak > 0 ? ((newPeak - newBalance) / newPeak) * 100 : 0;
            const newMaxDrawdown = Math.max(acct.maxDrawdown, drawdown);
            await storage.updatePaperAccount({
              currentBalance: Math.round(newBalance * 100) / 100,
              peakBalance: Math.round(newPeak * 100) / 100,
              maxDrawdown: Math.round(newMaxDrawdown * 100) / 100,
            }, trade.userId || undefined);
            console.log(`[PaperAccount] Balance: ${acct.currency} ${newBalance.toFixed(2)} (${moneyPnl >= 0 ? '+' : ''}${moneyPnl.toFixed(2)})`);
          }
          
          closedCount++;
          deductCommissionIfApplicable(trade.userId, trade.id, moneyPnl, trade.instrument).catch(() => {});
          const isActualWin = (result.pnlPips ?? 0) > 0;
          const outcome = result.status === "sl_hit" 
            ? (isActualWin ? "WIN (Trailing SL)" : result.pnlPips === 0 ? "BREAK-EVEN (SL)" : "LOSS (SL hit)")
            : "WIN (TP hit)";
          const moneyStr = moneyPnl !== undefined ? ` | ${moneyPnl >= 0 ? '+' : ''}${moneyPnl.toFixed(2)}` : '';
          console.log(`[TradeMonitor] ${trade.instrument} ${trade.direction.toUpperCase()} closed: ${outcome} | ${result.pnlPips?.toFixed(1)} pips${moneyStr}`);
          
          if (isActualWin) {
            recordSignalWin(trade.instrument, trade.timeframe, trade.direction);
          } else if ((result.pnlPips ?? 0) < 0) {
            recordSignalLoss(trade.instrument, trade.timeframe, trade.direction);
          }
          
          strategyIntelligence.recordTradeResult(trade.instrument, trade.timeframe, result.pnlPips ?? 0, trade.openedAt);
          updateSignalOutcome(trade.instrument, trade.timeframe, trade.direction, trade.openedAt, currentPrice, result.pnlPips ?? 0, "natural").catch(() => {});
          
          if (trade.userId) {
            const notifOutcome = result.status === "sl_hit" ? "sl_hit" as const : "tp_hit" as const;
            pushNotificationService.sendTradeNotification(trade.userId, trade.instrument, trade.direction, notifOutcome, result.pnlPips).catch(() => {});
          }
          
          if (trade.oandaTradeId) {
            await closeLinkedOandaTrade(trade.userId ?? null, trade.oandaTradeId, `${result.status} ${trade.instrument}`);
          }
        } else {
          const highestPrice = Math.max(trade.highestPrice || trade.entryPrice, currentPrice);
          const lowestPrice = Math.min(trade.lowestPrice || trade.entryPrice, currentPrice);
          
          const isMetal = trade.instrument === "XAUUSD" || trade.instrument === "XAGUSD";
          const pipSize = PIP_VALUES[trade.instrument] || 0.0001;
          const slDistance = Math.abs(trade.entryPrice - trade.stopLoss);
          const currentProfit = trade.direction === "buy" 
            ? (currentPrice - trade.entryPrice) / pipSize
            : (trade.entryPrice - currentPrice) / pipSize;
          const targetPips = slDistance / pipSize;
          
          let newStopLoss = trade.stopLoss;
          let trailingApplied = false;
          let isHalfProfitLocked = trade.halfProfitLocked || false;
          
          const beThresholdMap: Record<string, number> = { "1m": 0.25, "5m": 0.25, "15m": 0.20, "1h": 0.20, "4h": 0.18 };
          const beThreshold = beThresholdMap[trade.timeframe] || 0.20;
          
          const earlyLockTrigger = isMetal ? 0.45 : 0.40;
          const earlyLockPct = isMetal ? 0.10 : 0.15;
          const midLockTrigger = isMetal ? 0.65 : 0.60;
          const midLockPct = isMetal ? 0.30 : 0.40;
          const fullLockPct = isMetal ? 0.55 : 0.70;
          
          const atrMultMap: Record<string, number> = { "1m": 1.0, "5m": 1.0, "15m": 1.2, "1h": 1.2, "4h": 1.5 };
          const atrMult = (atrMultMap[trade.timeframe] || 1.2) + (isMetal ? 0.2 : 0);
          
          if (currentProfit >= targetPips * beThreshold && !trade.breakEvenApplied) {
            newStopLoss = trade.entryPrice;
            trailingApplied = true;
            console.log(`[TradeMonitor] ${trade.instrument} ${trade.timeframe} trailing SL -> break-even at ${(beThreshold*100).toFixed(0)}% (profit: ${currentProfit.toFixed(1)} pips)`);
            
            if (trade.oandaTradeId) {
              await modifyOandaTrailingStop(trade.userId ?? null, trade.oandaTradeId, newStopLoss, trade.instrument);
            }
          }
          else if (currentProfit >= targetPips && trade.breakEvenApplied && !isHalfProfitLocked) {
            const lockProfit = targetPips * fullLockPct * pipSize;
            newStopLoss = trade.direction === "buy" 
              ? trade.entryPrice + lockProfit 
              : trade.entryPrice - lockProfit;
            trailingApplied = true;
            isHalfProfitLocked = true;
            console.log(`[TradeMonitor] ${trade.instrument} ${trade.timeframe} trailing SL -> ${(fullLockPct*100).toFixed(0)}% full profit lock (${currentProfit.toFixed(1)} pips)`);
            
            if (trade.oandaTradeId) {
              await modifyOandaTrailingStop(trade.userId ?? null, trade.oandaTradeId, newStopLoss, trade.instrument);
            }
          }
          else if (currentProfit >= targetPips * midLockTrigger && currentProfit < targetPips && trade.breakEvenApplied && !isHalfProfitLocked) {
            const lockProfit = targetPips * midLockPct * pipSize;
            newStopLoss = trade.direction === "buy" 
              ? trade.entryPrice + lockProfit 
              : trade.entryPrice - lockProfit;
            trailingApplied = true;
            console.log(`[TradeMonitor] ${trade.instrument} ${trade.timeframe} trailing SL -> ${(midLockPct*100).toFixed(0)}% profit lock at ${(midLockTrigger*100).toFixed(0)}% target (${currentProfit.toFixed(1)} pips)`);
            
            if (trade.oandaTradeId) {
              await modifyOandaTrailingStop(trade.userId ?? null, trade.oandaTradeId, newStopLoss, trade.instrument);
            }
          }
          else if (currentProfit >= targetPips * earlyLockTrigger && currentProfit < targetPips * midLockTrigger && trade.breakEvenApplied && !isHalfProfitLocked) {
            const lockProfit = targetPips * earlyLockPct * pipSize;
            newStopLoss = trade.direction === "buy" 
              ? trade.entryPrice + lockProfit 
              : trade.entryPrice - lockProfit;
            trailingApplied = true;
            console.log(`[TradeMonitor] ${trade.instrument} ${trade.timeframe} trailing SL -> ${(earlyLockPct*100).toFixed(0)}% early profit lock at ${(earlyLockTrigger*100).toFixed(0)}% target (${currentProfit.toFixed(1)} pips)`);
            
            if (trade.oandaTradeId) {
              await modifyOandaTrailingStop(trade.userId ?? null, trade.oandaTradeId, newStopLoss, trade.instrument);
            }
          }
          
          if (trailingApplied && trade.stopLoss !== null) {
            if (trade.direction === "buy" && newStopLoss < trade.stopLoss) {
              newStopLoss = trade.stopLoss;
              trailingApplied = false;
            } else if (trade.direction === "sell" && newStopLoss > trade.stopLoss) {
              newStopLoss = trade.stopLoss;
              trailingApplied = false;
            }
          }
          
          if (isHalfProfitLocked) {
            const atrEstimate = slDistance * atrMult;
            let atrTrailSL: number;
            if (trade.direction === "buy") {
              atrTrailSL = highestPrice - atrEstimate;
              if (atrTrailSL > newStopLoss) {
                newStopLoss = atrTrailSL;
                console.log(`[TradeMonitor] ${trade.instrument} ATR trailing SL -> ${newStopLoss.toFixed(5)} (${atrMult.toFixed(1)}x)`);
                if (trade.oandaTradeId) {
                  await modifyOandaTrailingStop(trade.userId ?? null, trade.oandaTradeId, newStopLoss, trade.instrument);
                }
              }
            } else {
              atrTrailSL = lowestPrice + atrEstimate;
              if (atrTrailSL < newStopLoss) {
                newStopLoss = atrTrailSL;
                console.log(`[TradeMonitor] ${trade.instrument} ATR trailing SL -> ${newStopLoss.toFixed(5)} (${atrMult.toFixed(1)}x)`);
                if (trade.oandaTradeId) {
                  await modifyOandaTrailingStop(trade.userId ?? null, trade.oandaTradeId, newStopLoss, trade.instrument);
                }
              }
            }
          }
          
          const openedAt = new Date(trade.openedAt).getTime();
          const hoursOpen = (Date.now() - openedAt) / (1000 * 60 * 60);
          
          const stagnationHoursMap: Record<string, number> = {
            "1m": 0.5, "5m": 1.5, "15m": 3, "1h": 6, "4h": 12,
          };
          const maxDurationHoursMap: Record<string, number> = {
            "1m": 3, "5m": 4, "15m": 6, "1h": 12, "4h": 24,
          };
          const stagnationHours = stagnationHoursMap[trade.timeframe] || 8;
          const maxDurationHours = maxDurationHoursMap[trade.timeframe] || 12;
          const is1mTrade = trade.timeframe === "1m";
          const stagnationThreshold = is1mTrade ? 0.08 : isMetal ? 0.12 : 0.15;
          
          if (hoursOpen >= maxDurationHours) {
            const pnlPips = currentProfit;
            const pnlPercent = (pnlPips / targetPips) * 100;
            
            // Calculate monetary P&L for expired trade
            const acct2 = await storage.getPaperAccount(trade.userId || undefined);
            const moneyPnl2 = trade.lotSize 
              ? calculateMoneyPnL(pnlPips, trade.lotSize, trade.instrument, acct2.currency, currentPrice)
              : undefined;
            
            await storage.updateSimulatedTrade(trade.id, {
              status: "expired",
              closedAt: new Date().toISOString(),
              closePrice: currentPrice,
              pnlPips,
              pnlPercent,
              pnlMoney: moneyPnl2,
            });
            
            if (moneyPnl2 !== undefined) {
              const newBal = acct2.currentBalance + moneyPnl2;
              const newPk = Math.max(acct2.peakBalance, newBal);
              const dd = newPk > 0 ? ((newPk - newBal) / newPk) * 100 : 0;
              await storage.updatePaperAccount({
                currentBalance: Math.round(newBal * 100) / 100,
                peakBalance: Math.round(newPk * 100) / 100,
                maxDrawdown: Math.round(Math.max(acct2.maxDrawdown, dd) * 100) / 100,
              }, trade.userId || undefined);
            }
            
            closedCount++;
            deductCommissionIfApplicable(trade.userId, trade.id, moneyPnl2, trade.instrument).catch(() => {});
            console.log(`[TradeMonitor] ${trade.instrument} ${trade.timeframe} MAX DURATION exit after ${hoursOpen.toFixed(1)}h | ${pnlPips.toFixed(1)} pips`);
            
            if (pnlPips > 0) {
              recordSignalWin(trade.instrument, trade.timeframe, trade.direction);
            } else if (pnlPips < 0) {
              recordSignalLoss(trade.instrument, trade.timeframe, trade.direction);
            }
            
            updateSignalOutcome(trade.instrument, trade.timeframe, trade.direction, trade.openedAt, currentPrice, pnlPips).catch(() => {});
            
            if (trade.userId) {
              pushNotificationService.sendTradeNotification(trade.userId, trade.instrument, trade.direction, 'expired', pnlPips).catch(() => {});
            }
            
            if (trade.oandaTradeId) {
              await closeLinkedOandaTrade(trade.userId ?? null, trade.oandaTradeId, `max-duration ${trade.instrument}`);
            }
            continue;
          }
          
          const effectiveStagnationHours = currentProfit > 0 && currentProfit < targetPips * 0.25
            ? stagnationHours * 1.5
            : stagnationHours;
          
          if (hoursOpen >= effectiveStagnationHours && !trade.breakEvenApplied && currentProfit > 0) {
            const maxMove = trade.direction === "buy"
              ? (highestPrice - trade.entryPrice) / pipSize
              : (trade.entryPrice - lowestPrice) / pipSize;
            
            const shouldExit = currentProfit >= targetPips * 0.25 
              ? maxMove < targetPips * stagnationThreshold
              : maxMove < targetPips * stagnationThreshold;
            
            if (shouldExit) {
              const pnlPips = currentProfit;
              const pnlPercent = (pnlPips / targetPips) * 100;
              
              const acct3 = await storage.getPaperAccount(trade.userId || undefined);
              const moneyPnl3 = trade.lotSize 
                ? calculateMoneyPnL(pnlPips, trade.lotSize, trade.instrument, acct3.currency, currentPrice)
                : undefined;
              
              await storage.updateSimulatedTrade(trade.id, {
                status: "expired",
                closedAt: new Date().toISOString(),
                closePrice: currentPrice,
                pnlPips,
                pnlPercent,
                pnlMoney: moneyPnl3,
              });
              
              if (moneyPnl3 !== undefined) {
                const newBal = acct3.currentBalance + moneyPnl3;
                const newPk = Math.max(acct3.peakBalance, newBal);
                const dd = newPk > 0 ? ((newPk - newBal) / newPk) * 100 : 0;
                await storage.updatePaperAccount({
                  currentBalance: Math.round(newBal * 100) / 100,
                  peakBalance: Math.round(newPk * 100) / 100,
                  maxDrawdown: Math.round(Math.max(acct3.maxDrawdown, dd) * 100) / 100,
                }, trade.userId || undefined);
              }
              
              closedCount++;
              deductCommissionIfApplicable(trade.userId, trade.id, moneyPnl3, trade.instrument).catch(() => {});
              console.log(`[TradeMonitor] ${trade.instrument} ${trade.timeframe} stagnation exit after ${hoursOpen.toFixed(1)}h | ${pnlPips.toFixed(1)} pips`);
              
              if (pnlPips > 0) {
                recordSignalWin(trade.instrument, trade.timeframe, trade.direction);
              } else if (pnlPips < 0) {
                recordSignalLoss(trade.instrument, trade.timeframe, trade.direction);
              }
              
              updateSignalOutcome(trade.instrument, trade.timeframe, trade.direction, trade.openedAt, currentPrice, pnlPips).catch(() => {});
              
              if (trade.userId) {
                pushNotificationService.sendTradeNotification(trade.userId, trade.instrument, trade.direction, 'expired', pnlPips).catch(() => {});
              }
              
              if (trade.oandaTradeId) {
                await closeLinkedOandaTrade(trade.userId ?? null, trade.oandaTradeId, `stagnation ${trade.instrument}`);
              }
              continue;
            }
          }
          
          await storage.updateSimulatedTrade(trade.id, { 
            highestPrice, 
            lowestPrice,
            stopLoss: newStopLoss,
            breakEvenApplied: trailingApplied || trade.breakEvenApplied,
            halfProfitLocked: isHalfProfitLocked,
          });
        }
      }

      if (closedCount > 0) {
        console.log(`[TradeMonitor] Closed ${closedCount} trade(s) - Learning system updated`);
      }
    } catch (error) {
      console.error("[TradeMonitor] Error monitoring trades:", error);
    }
  };

  // Run immediately once, then every 30 seconds
  monitorTrades();
  setInterval(monitorTrades, 30000);
}

// Background signal scanner - generates signals automatically every 60 seconds
function startBackgroundSignalScanner() {
  console.log("[SignalScanner] Starting background signal scanner (60s interval)");
  
  // Helper function to check news blackout for an instrument
  const isNewsBlackout = (inst: Instrument): boolean => {
    const riskSettings = storage.getRiskManagement();
    const blackoutMinutes = riskSettings.newsBlackoutMinutes;
    if (blackoutMinutes <= 0) return false;
    
    const events = generateEconomicEvents();
    const now = new Date();
    
    return events.some(event => {
      if (event.impact !== "high") return false;
      if (!event.affectedPairs.includes(inst)) return false;
      
      const eventTime = new Date(event.dateTime);
      const diffMinutes = Math.abs(eventTime.getTime() - now.getTime()) / (1000 * 60);
      return diffMinutes <= blackoutMinutes;
    });
  };
  
  // Helper function to check session filter (instrument-aware)
  const isSessionAllowedForInstrument = (instrument: Instrument): boolean => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    
    let currentSession: "asian" | "asian_london_overlap" | "london" | "new_york" | "closed" = "closed";
    if (utcHour >= 0 && utcHour < 5) currentSession = "asian";
    else if (utcHour >= 5 && utcHour < 8) currentSession = "asian_london_overlap";
    else if (utcHour >= 8 && utcHour < 16) currentSession = "london";
    else if (utcHour >= 13 && utcHour < 22) currentSession = "new_york";
    else currentSession = "closed";
    
    const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
    if (!isMetal && currentSession === "asian") {
      return false;
    }
    
    // Respect user's session filter preference
    const riskSettings = storage.getRiskManagement();
    if (riskSettings.sessionFilterEnabled) {
      return riskSettings.preferredSessions.includes(currentSession);
    }
    
    return true;
  };
  
  // Legacy function for backward compatibility
  const isSessionAllowed = (): boolean => {
    return isSessionAllowedForInstrument("EURUSD"); // Default check
  };

  initLossCooldownsFromHistory();
  
  const scanForSignals = async () => {
    if (!isForexMarketOpen()) {
      return;
    }
    
    // Only scan if simulation/auto-trading is enabled
    if (!storage.isSimulationEnabled()) {
      return;
    }
    
    const dailyPnL = storage.getDailyPnL();
    const riskSettings = storage.getRiskManagement();
    const tradingLocked = storage.isTradingLocked();
    
    if (tradingLocked.locked) {
      console.log(`[SignalScanner] Trading locked: ${tradingLocked.reason}`);
      return;
    }
    
    if (dailyPnL.isLimitReached) {
      console.log("[SignalScanner] Daily loss limit reached - skipping scan");
      return;
    }
    
    const approvedPairs = getApprovedInstrumentTimeframes();
    console.log(`[SignalScanner] Scanning ALL instruments on key timeframes (${approvedPairs.length} optimizer-approved pairs: ${approvedPairs.join(', ')})`);
    let signalsGenerated = 0;
    let tradesExecuted = 0;
    let skippedBlackout = 0;
    let skippedSession = 0;
    let scannedCount = 0;
    
    const scanTimeframes: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];
    
    let oandaPriceMap: Record<string, number> = {};
    if (oandaService.isConfigured()) {
      try {
        const prices = await oandaService.getAllPrices([...instruments]);
        for (const inst of instruments) {
          if (prices[inst] && prices[inst].mid > 0) {
            oandaPriceMap[inst] = prices[inst].mid;
          }
        }
      } catch (e) {
        console.warn("[SignalScanner] Failed to fetch OANDA prices, using candle close prices");
      }
    }
    
    for (const inst of instruments) {
      if (!isSessionAllowedForInstrument(inst)) {
        skippedSession++;
        continue;
      }
      
      if (isNewsBlackout(inst)) {
        skippedBlackout++;
        continue;
      }
      
      for (const tf of scanTimeframes) {
        try {
          const isApproved = isInstrumentApprovedForTrading(inst, tf);
          
          if (tf === "1m" && !isApproved) {
            continue;
          }
          
          if (!isApproved && isInstrumentRejected(inst, tf)) {
            continue;
          }
          
          const rcStats = getRealityCheckStatsForCombo(inst, tf);
          if (rcStats) {
            const rcDataPoints = Math.max(rcStats.signalTotal, rcStats.tradeTotal);
            if (rcDataPoints >= rcStats.minThreshold && rcStats.combinedWR < 40) {
              continue;
            }
          }
          
          scannedCount++;
          
          const histResult = await historicalDataService.getHistoricalData(inst, tf, 100);
          if (!histResult.data || histResult.data.length < 50) {
            continue;
          }
          if (histResult.source === 'generated') {
            continue;
          }
          
          const currentPrice = oandaPriceMap[inst] || null;
          
          // Filter candles with valid timestamps only
          const validData = histResult.data.filter((d: any) => d.timestamp);
          if (validData.length < 50) continue;
          
          const candles = validData.map((d: any) => ({
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            timestamp: d.timestamp,
            volume: d.volume || 0,
          }));
          
          const analysis = analyzeMarket(inst, tf, candles, currentPrice ?? candles[candles.length - 1]?.close);
          if (currentPrice) {
            analysis.currentPrice = currentPrice;
          }
          storage.setCachedAnalysis(analysis);
          storage.setCachedCandles(inst, tf, candles);
          
          const signal = generateSignal(analysis, candles);
          
          if (!signal || signal.direction === "stand_aside") {
            if (analysis.trend.strength >= 50 || analysis.marketState === "high_risk" || analysis.marketState === "no_trade") {
              console.log(`[SignalScanner] ${inst}/${tf}: No signal (trend=${analysis.trend.direction} str=${analysis.trend.strength}, vol=${analysis.volatility}, state=${analysis.marketState}${isApproved ? '' : ' [not approved]'})`);
            }
            continue;
          }
          
          const approvedLabel = isApproved ? "APPROVED" : "UNIVERSAL";
          
          {
            // Apply learning adjustment (same as /api/signal)
            const signalConditions = {
              trendStrength: analysis.trend.strength,
              trendDirection: analysis.trend.direction,
              volatility: analysis.volatility,
              marketState: analysis.marketState,
              nearSupport: analysis.supportLevels.some(s => 
                Math.abs(analysis.currentPrice - s.price) / analysis.currentPrice < 0.003
              ),
              nearResistance: analysis.resistanceLevels.some(r => 
                Math.abs(analysis.currentPrice - r.price) / analysis.currentPrice < 0.003
              ),
              confidenceLevel: "medium" as const,
            };
            const learningAdjustment = await storage.getConfidenceAdjustment(signalConditions);
            
            // Check if this setup should be filtered out (poor historical performance)
            const learning = await storage.getLearningPerformance();
            const allTrades = await storage.getSimulatedTrades();
            const closedTrades = allTrades.filter(t => t.status !== "open" && t.conditions);
            const hasEnoughData = closedTrades.length >= learning.minTradesForLearning;
            
            if (hasEnoughData && learningAdjustment <= -15) {
              const worstSetup = learning.worstSetups.find(s => 
                s.description.includes(analysis.marketState) && 
                s.description.includes(analysis.volatility)
              );
              
              if (worstSetup && worstSetup.winRate < 50 && worstSetup.totalTrades >= 5) {
                console.log(`[SignalScanner] Filtered out ${inst}/${tf} - poor historical performance`);
                continue;
              }
            }
            
            signal.confidence = Math.max(30, Math.min(95, signal.confidence + learningAdjustment));
            
            // Add learning notes to reasoning (same as /api/signal)
            if (learningAdjustment !== 0) {
              signal.reasoning.push(
                learningAdjustment > 0 
                  ? `Learning boost: +${learningAdjustment}% (similar setups have performed well)`
                  : `Learning penalty: ${learningAdjustment}% (similar setups have underperformed)`
              );
            }
            
            // === MICRO-SCALPER MOMENTUM CONFIRMATION ===
            const scanMomentum = microScalperManager.getMomentumForInstrument(inst);
            if (scanMomentum) {
              const mAligned = (signal.direction === "buy" && scanMomentum.direction === "buy") ||
                               (signal.direction === "sell" && scanMomentum.direction === "sell");
              const mConflict = (signal.direction === "buy" && scanMomentum.direction === "sell") ||
                                (signal.direction === "sell" && scanMomentum.direction === "buy");
              
              if (mAligned && scanMomentum.strength >= 0.6) {
                const mBoost = Math.round(scanMomentum.strength * 5);
                signal.confidence = Math.min(95, signal.confidence + mBoost);
                signal.reasoning.push(`Live momentum confirms ${signal.direction}: +${mBoost}% (${scanMomentum.movePips.toFixed(1)} pip burst)`);
              } else if (mConflict && scanMomentum.strength >= 0.8) {
                const mPenalty = Math.round(scanMomentum.strength * 3);
                signal.confidence = Math.max(30, signal.confidence - mPenalty);
                signal.reasoning.push(`Live momentum opposes ${signal.direction}: -${mPenalty}% (${scanMomentum.movePips.toFixed(1)} pip counter-move)`);
              }
            }
            
            const cooldownCheck = isSignalOnCooldown(inst, tf, signal.direction);
            if (cooldownCheck.blocked) {
              console.log(`[SignalScanner] ${inst}/${tf} ${signal.direction}: BLOCKED — ${cooldownCheck.reason}`);
              continue;
            }

            // === POWERFUL PRICE-BASED DUPLICATE PREVENTION ===
            // Prevent near-identical trades (same price area within short time)
            const entryPrice = (signal.entryZone.low + signal.entryZone.high) / 2;
            const existingSignal = storage.getCachedSignal(inst, tf);
            const signalAge = existingSignal 
              ? Date.now() - new Date(existingSignal.timestamp).getTime()
              : Infinity;
            
            // Price difference thresholds: 50 pips for Gold, 30 pips for forex
            const isMetalInst = inst === "XAUUSD" || inst === "XAGUSD";
            const minPriceDiff = inst === "XAUUSD" ? 5.0 : isMetalInst ? 0.3 : 0.003;
            const existingEntry = existingSignal ? (existingSignal.entryZone.low + existingSignal.entryZone.high) / 2 : 0;
            const priceDiff = Math.abs(entryPrice - existingEntry);
            const priceMovedEnough = priceDiff >= minPriceDiff;
            
            // Skip if price is too close to recent signal OR same direction within 1 hour
            const isSameDirection = existingSignal?.direction === signal.direction;
            const oneHourAgo = 60 * 60 * 1000;
            
            // Allow trade if: (1) no recent signal, OR (2) price moved enough, OR (3) opposite direction after 15 min
            const shouldTrade = signalAge > oneHourAgo || 
                               (priceMovedEnough && signalAge > 15 * 60 * 1000) ||
                               (!isSameDirection && signalAge > 15 * 60 * 1000);
            
            const minConfidenceForTrade = isApproved ? 55 : 70;
            
            if (signal.confidence < minConfidenceForTrade) {
              console.log(`[SignalScanner] ${inst}/${tf} [${approvedLabel}]: Signal below min confidence (${signal.confidence}% < ${minConfidenceForTrade}%)`);
              continue;
            }
            
            if (shouldTrade) {
              if (!isForexMarketOpen()) {
                console.log(`[SignalScanner] Market closed (weekend) - skipping ${inst} ${tf} ${signal.direction}`);
                continue;
              }
              
              const siDecision = strategyIntelligence.evaluateSignal(signal, analysis);
              if (!siDecision.allowed) {
                console.log(`[SignalScanner] ${inst}/${tf} AI FILTERED: ${siDecision.reason}`);
                continue;
              }
              if (siDecision.adjustedConfidence !== undefined) {
                signal.confidence = siDecision.adjustedConfidence;
                signal.reasoning.push(`AI Strategy: ${siDecision.reason}`);
              }
              
              storage.setCachedSignal(signal);
              saveSignalToDatabase(signal);
              signalsGenerated++;
              
              console.log(`[SignalScanner] NEW SIGNAL [${approvedLabel}]: ${inst} ${tf} - ${signal.direction.toUpperCase()} (${signal.confidence}% confidence)`);
              
              // Auto-create simulated trade (trade notification sent per-user inside)
              const scanUserTradeIds = await createSimulatedTradeFromSignal(signal, analysis);
              
              const scanEntryPrice = (signal.entryZone.low + signal.entryZone.high) / 2;
              if (signal.confidence >= 60 && isApproved) {
                autoExecuteForAllUsers(signal, scanEntryPrice, scanUserTradeIds).then(()=> {
                  tradesExecuted++;
                }).catch(err => 
                  console.error("[SignalScanner] User auto-execute error:", err)
                );
              } else if (signal.confidence >= 80 && !isApproved) {
                console.log(`[SignalScanner] ${inst}/${tf} [UNIVERSAL]: High confidence ${signal.confidence}% - auto-executing on OANDA`);
                autoExecuteForAllUsers(signal, scanEntryPrice, scanUserTradeIds).then(()=> {
                  tradesExecuted++;
                }).catch(err => 
                  console.error("[SignalScanner] User auto-execute error:", err)
                );
              } else if (signal.confidence >= 60 && !isApproved) {
                console.log(`[SignalScanner] ${inst}/${tf} [UNIVERSAL]: ${signal.confidence}% confidence - simulated only (need 80%+ for OANDA)`);
              }
            }
          }
        } catch (error) {
          console.warn(`[SignalScanner] Error scanning ${inst}/${tf}:`, error instanceof Error ? error.message : "Unknown error");
        }
      }
    }
    
    const skipInfo = [];
    if (skippedSession > 0) skipInfo.push(`${skippedSession} instruments skipped (session filter)`);
    if (skippedBlackout > 0) skipInfo.push(`${skippedBlackout} instruments skipped (news blackout)`);
    console.log(`[SignalScanner] Scan complete - ${scannedCount} combos checked, ${signalsGenerated} signals, ${tradesExecuted} trades executed${skipInfo.length > 0 ? ` [${skipInfo.join(', ')}]` : ''}`);
  };
  
  // Wait 30 seconds after startup, then scan every 60 seconds
  setTimeout(() => {
    scanForSignals();
    setInterval(scanForSignals, 60 * 1000); // Every 60 seconds
  }, 30000);

  // Start Telegram bot if token is configured
  setTimeout(() => {
    startTelegramBot();
  }, 5000);
}

// Generate whale zone data with order blocks, liquidity hunts, and stop clusters
function generateWhaleZoneData(instrument: Instrument, currentPrice: number): WhaleZoneData {
  const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
  const pipSize = PIP_VALUES[instrument] || 0.0001;
  const roundLevel = instrument === "XAUUSD" ? 10 : isMetal ? 1 : 0.01;
  
  // Find nearby round numbers for institutional levels
  const institutionalLevels: InstitutionalLevel[] = [];
  const basePrice = Math.round(currentPrice / roundLevel) * roundLevel;
  
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const price = basePrice + (i * roundLevel);
    institutionalLevels.push({
      price,
      type: "psychological",
      label: `${i > 0 ? "Resistance" : "Support"} ${Math.abs(i)}`,
      significance: Math.abs(i) === 1 ? "critical" : Math.abs(i) === 2 ? "major" : "minor",
    });
  }
  
  // Generate order blocks
  const orderBlocks: OrderBlock[] = [
    {
      price: currentPrice - (20 * pipSize * (isMetal ? 100 : 1)),
      type: "bullish",
      strength: 75,
      priceHigh: currentPrice - (15 * pipSize * (isMetal ? 100 : 1)),
      priceLow: currentPrice - (25 * pipSize * (isMetal ? 100 : 1)),
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      stillValid: true,
    },
    {
      price: currentPrice + (25 * pipSize * (isMetal ? 100 : 1)),
      type: "bearish",
      strength: 68,
      priceHigh: currentPrice + (30 * pipSize * (isMetal ? 100 : 1)),
      priceLow: currentPrice + (20 * pipSize * (isMetal ? 100 : 1)),
      timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      stillValid: true,
    },
  ];
  
  // Generate recent liquidity hunts
  const recentLiquidityHunts: LiquidityHunt[] = [
    {
      type: "stop_hunt_down",
      price: currentPrice - (15 * pipSize * (isMetal ? 100 : 1)),
      description: "Quick spike below support to grab stops, then reversal",
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      significance: "moderate",
    },
  ];
  
  // Estimate stop clusters based on recent swing points
  const estimatedStopClusters = [
    {
      price: currentPrice - (30 * pipSize * (isMetal ? 100 : 1)),
      side: "below" as const,
      estimatedVolume: "high" as const,
    },
    {
      price: currentPrice + (35 * pipSize * (isMetal ? 100 : 1)),
      side: "above" as const,
      estimatedVolume: "medium" as const,
    },
  ];
  
  // Determine whale activity based on order flow simulation
  const whaleActivity = Math.random() > 0.6 ? "accumulating" : Math.random() > 0.5 ? "distributing" : "neutral";
  
  return {
    institutionalLevels,
    orderBlocks,
    recentLiquidityHunts,
    estimatedStopClusters,
    whaleActivity: whaleActivity as "accumulating" | "distributing" | "neutral",
  };
}

// Generate economic calendar events
function generateEconomicEvents(): EconomicEvent[] {
  const now = Date.now();
  
  return [
    {
      id: "1",
      title: "Non-Farm Payrolls",
      country: "USD",
      impact: "high",
      dateTime: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
      forecast: "180K",
      previous: "175K",
      affectedPairs: ["EURUSD", "GBPUSD", "XAUUSD", "USDCHF", "AUDUSD", "NZDUSD"],
    },
    {
      id: "2",
      title: "ECB Interest Rate Decision",
      country: "EUR",
      impact: "high",
      dateTime: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
      forecast: "4.25%",
      previous: "4.50%",
      affectedPairs: ["EURUSD"],
    },
    {
      id: "3",
      title: "UK GDP (QoQ)",
      country: "GBP",
      impact: "medium",
      dateTime: new Date(now + 1 * 24 * 60 * 60 * 1000).toISOString(),
      forecast: "0.3%",
      previous: "0.1%",
      affectedPairs: ["GBPUSD"],
    },
    {
      id: "4",
      title: "US CPI (YoY)",
      country: "USD",
      impact: "high",
      dateTime: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
      forecast: "3.2%",
      previous: "3.4%",
      affectedPairs: ["EURUSD", "GBPUSD", "XAUUSD", "USDCHF", "AUDUSD", "NZDUSD"],
    },
    {
      id: "5",
      title: "RBA Interest Rate Decision",
      country: "AUD",
      impact: "high",
      dateTime: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString(),
      forecast: "4.35%",
      previous: "4.35%",
      affectedPairs: ["AUDUSD", "NZDUSD"],
    },
    {
      id: "6",
      title: "FOMC Meeting Minutes",
      country: "USD",
      impact: "high",
      dateTime: new Date(now + 6 * 24 * 60 * 60 * 1000).toISOString(),
      forecast: "",
      previous: "",
      affectedPairs: ["EURUSD", "GBPUSD", "XAUUSD", "USDCHF", "AUDUSD", "NZDUSD"],
    },
  ];
}

// Helper function to create a simulated trade from a signal with conditions for learning
// Creates a separate trade for EACH registered user for proper multi-user isolation
async function createSimulatedTradeFromSignal(signal: TradeSignal, analysis?: MarketAnalysis): Promise<Map<string, string>> {
  const userTradeIds = new Map<string, string>();
  if (!isForexMarketOpen()) {
    console.log(`[TradeExecution] Market closed - blocking simulated trade for ${signal.instrument}`);
    return userTradeIds;
  }
  
  const entryPrice = (signal.entryZone.low + signal.entryZone.high) / 2;
  
  let conditions: SignalConditions | undefined;
  if (analysis) {
    const nearSupport = analysis.supportLevels.some(s => 
      Math.abs(analysis.currentPrice - s.price) / analysis.currentPrice < 0.003
    );
    const nearResistance = analysis.resistanceLevels.some(r => 
      Math.abs(analysis.currentPrice - r.price) / analysis.currentPrice < 0.003
    );
    
    conditions = {
      trendStrength: analysis.trend.strength,
      trendDirection: analysis.trend.direction,
      volatility: analysis.volatility,
      marketState: analysis.marketState,
      nearSupport,
      nearResistance,
      confidenceLevel: signal.confidence < 60 ? "low" : signal.confidence < 75 ? "medium" : "high",
    };
  }

  const allUsers = await db.select().from(userSettingsTable);
  const realUsers = allUsers.filter(u => u.userId && u.userId !== "" && !u.userId.startsWith("test-"));
  
  if (realUsers.length === 0) {
    console.log(`[SignalScanner] No registered users found, skipping trade creation`);
    return userTradeIds;
  }

  for (const userRecord of realUsers) {
    const userId = userRecord.userId!;
    
    const userInstruments = userRecord.simulationInstruments as string[] | null;
    if (userInstruments && userInstruments.length > 0 && !userInstruments.includes(signal.instrument)) {
      continue;
    }

    const userTimeframes = userRecord.simulationTimeframes as string[] | null;
    if (userTimeframes && userTimeframes.length > 0 && !userTimeframes.includes(signal.timeframe)) {
      console.log(`[SignalScanner] Skipped ${signal.instrument} ${signal.timeframe} for user ${userId.slice(0,8)} - timeframe filtered out`);
      continue;
    }

    const existingTrades = await storage.getSimulatedTrades();
    
    const userOpenTrades = existingTrades.filter(t => t.userId === userId && t.status === "open");
    const userMaxPositions = userRecord.maxOpenPositions ?? storage.getRiskManagement().maxOpenPositions;
    if (userOpenTrades.length >= userMaxPositions) {
      console.log(`[SignalScanner] Skipped ${signal.instrument} ${signal.timeframe} for user ${userId.slice(0,8)} - max positions (${userMaxPositions}) reached (${userOpenTrades.length} open)`);
      continue;
    }

    const sameInstrumentOpen = userOpenTrades.filter(t => t.instrument === signal.instrument);
    if (sameInstrumentOpen.length >= 1) {
      console.log(`[SignalScanner] Skipped ${signal.instrument} ${signal.timeframe} for user ${userId.slice(0,8)} - already has ${sameInstrumentOpen.length} open ${signal.instrument} trade(s)`);
      continue;
    }

    const recentUserTrades = existingTrades.filter(t => 
      t.userId === userId && 
      t.instrument === signal.instrument && 
      t.status !== "open" && 
      t.pnlPips !== null &&
      t.closedAt && new Date(t.closedAt).getTime() > Date.now() - 14 * 24 * 60 * 60 * 1000
    );
    if (recentUserTrades.length >= 10) {
      const winCount = recentUserTrades.filter(t => (t.pnlPips ?? 0) > 0).length;
      const winRate = winCount / recentUserTrades.length;
      if (winRate < 0.4) {
        console.log(`[SignalScanner] BLOCKED ${signal.instrument} for user ${userId.slice(0,8)} — ${(winRate * 100).toFixed(0)}% win rate over last ${recentUserTrades.length} trades (below 40% threshold)`);
        continue;
      }
    }

    const conflictingTrade = existingTrades.find(t =>
      t.instrument === signal.instrument &&
      t.status === "open" &&
      t.userId === userId &&
      t.direction !== signal.direction
    );
    if (conflictingTrade) {
      console.log(`[SignalScanner] ${signal.instrument} ${signal.timeframe} ${signal.direction} - opposite direction ${conflictingTrade.direction} open on paper (allowing for OANDA)`);
    }

    const existingOpenTrade = existingTrades.find(t => 
      t.instrument === signal.instrument && 
      t.timeframe === signal.timeframe &&
      t.status === "open" &&
      t.userId === userId
    );
    
    if (existingOpenTrade) {
      const openedAt = new Date(existingOpenTrade.openedAt).getTime();
      const hoursOpen = (Date.now() - openedAt) / (1000 * 60 * 60);
      const pipSize = PIP_VALUES[existingOpenTrade.instrument] || 0.0001;
      const currentProfit = existingOpenTrade.direction === "buy"
        ? (entryPrice - existingOpenTrade.entryPrice) / pipSize
        : (existingOpenTrade.entryPrice - entryPrice) / pipSize;
      const targetPips = Math.abs(existingOpenTrade.entryPrice - existingOpenTrade.stopLoss) / pipSize;
      const progressPct = currentProfit / targetPips;
      
      const minHoursMap: Record<string, number> = { "1m": 0.25, "5m": 1, "15m": 2, "1h": 4, "4h": 8 };
      const minHoursBeforeReplace = minHoursMap[existingOpenTrade.timeframe] || 4;
      
      const isStagnant = hoursOpen >= minHoursBeforeReplace && progressPct < 0.25 && !existingOpenTrade.breakEvenApplied;
      
      if (!isStagnant) continue;
      
      const pnlPips = currentProfit;
      const pnlPercent = (pnlPips / targetPips) * 100;
      
      const replaceAcct = await storage.getPaperAccount(userId);
      const replaceMoneyPnl = existingOpenTrade.lotSize
        ? calculateMoneyPnL(pnlPips, existingOpenTrade.lotSize, existingOpenTrade.instrument, replaceAcct.currency, entryPrice)
        : undefined;
      
      await storage.updateSimulatedTrade(existingOpenTrade.id, {
        status: "expired",
        closedAt: new Date().toISOString(),
        closePrice: entryPrice,
        pnlPips,
        pnlPercent,
        pnlMoney: replaceMoneyPnl,
      });
      
      if (replaceMoneyPnl !== undefined) {
        const newBal = replaceAcct.currentBalance + replaceMoneyPnl;
        const newPk = Math.max(replaceAcct.peakBalance, newBal);
        const dd = newPk > 0 ? ((newPk - newBal) / newPk) * 100 : 0;
        await storage.updatePaperAccount({
          currentBalance: Math.round(newBal * 100) / 100,
          peakBalance: Math.round(newPk * 100) / 100,
          maxDrawdown: Math.round(Math.max(replaceAcct.maxDrawdown, dd) * 100) / 100,
        }, userId);
      }
      
      const replMoneyStr = replaceMoneyPnl !== undefined ? ` | ${replaceMoneyPnl >= 0 ? '+' : ''}${replaceAcct.currency === 'GBP' ? '£' : replaceAcct.currency === 'EUR' ? '€' : '$'}${replaceMoneyPnl.toFixed(2)}` : '';
      console.log(`[TradeReplace] ${existingOpenTrade.instrument} ${existingOpenTrade.timeframe} replaced for user ${userId.slice(0,8)} after ${hoursOpen.toFixed(1)}h (progress: ${(progressPct * 100).toFixed(0)}%) | ${pnlPips.toFixed(1)} pips${replMoneyStr} -> new ${signal.direction} signal`);
      
      if (existingOpenTrade.oandaTradeId) {
        await closeLinkedOandaTrade(existingOpenTrade.userId ?? null, existingOpenTrade.oandaTradeId, `replaced ${existingOpenTrade.instrument}`);
      }
    }

    const userAcct = await storage.getPaperAccount(userId);
    const scanSlDist = Math.abs(entryPrice - signal.stopLoss);
    const scanPipSize = PIP_VALUES[signal.instrument] || 0.0001;
    const scanSlPips = scanSlDist / scanPipSize;

    const maxSlPipsMap: Record<string, number> = { "1m": 15, "5m": 30, "15m": 50, "1h": 100, "4h": 200, "1D": 500, "1W": 1000, "1M": 2000 };
    let maxSlPips = maxSlPipsMap[signal.timeframe] || 100;
    if (signal.instrument === "XAUUSD") maxSlPips *= 10;
    else if (signal.instrument === "XAGUSD") maxSlPips *= 5;
    if (scanSlPips > maxSlPips) {
      console.log(`[SignalScanner] BLOCKED trade for user ${userId.slice(0,8)}: ${signal.instrument} ${signal.timeframe} ${signal.direction} — SL ${scanSlPips.toFixed(1)} pips exceeds max ${maxSlPips} pips for ${signal.timeframe}`);
      continue;
    }
    const scanLotInfo = calculateLotSize(
      userAcct.currentBalance,
      userAcct.riskPercent,
      scanSlPips,
      signal.instrument,
      userAcct.currency,
      entryPrice
    );

    if (scanLotInfo.skipped) {
      console.log(`[SignalScanner] Skipped trade for user ${userId.slice(0,8)}: ${signal.instrument} ${signal.direction} - ${scanLotInfo.skipReason}`);
      continue;
    }

    let finalLotSize = scanLotInfo.lotSize;
    const boostThreshold = userRecord.confidenceBoostThreshold as number | null;
    const boostMultiplier = userRecord.confidenceBoostMultiplier as number | null;
    if (boostThreshold && boostMultiplier && signal.confidence >= boostThreshold) {
      const boostedLot = Math.round(finalLotSize * boostMultiplier * 1000) / 1000;
      const maxRiskLot = Math.round(finalLotSize * 3 * 1000) / 1000;
      finalLotSize = Math.min(boostedLot, maxRiskLot);
      console.log(`[SignalScanner] Confidence boost for user ${userId.slice(0,8)}: ${signal.confidence}% >= ${boostThreshold}% -> ${boostMultiplier}x lot (${scanLotInfo.lotSize} -> ${finalLotSize})`);
    }

    const trade: SimulatedTrade = {
      id: randomUUID(),
      signalId: `${signal.instrument}_${signal.timeframe}_${signal.timestamp}`,
      instrument: signal.instrument,
      timeframe: signal.timeframe,
      direction: signal.direction,
      entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      status: "open",
      openedAt: new Date().toISOString(),
      highestPrice: entryPrice,
      lowestPrice: entryPrice,
      conditions,
      breakEvenApplied: false,
      halfProfitLocked: false,
      lotSize: finalLotSize,
      userId,
    };
    
    await storage.addSimulatedTrade(trade);
    userTradeIds.set(userId, trade.id);
    const boostLabel = finalLotSize !== scanLotInfo.lotSize ? ` (boosted from ${scanLotInfo.lotSize})` : '';
    console.log(`[SignalScanner] Created trade for user ${userId.slice(0,8)}: ${signal.instrument} ${signal.timeframe} ${signal.direction} | lots=${finalLotSize}${boostLabel}`);
    
    const simTpDist = Math.abs(signal.takeProfit1 - entryPrice) / (PIP_VALUES[signal.instrument] || 0.0001);
    const simSlDist = Math.abs(signal.stopLoss - entryPrice) / (PIP_VALUES[signal.instrument] || 0.0001);
    const simPotentialProfit = calculateMoneyPnL(simTpDist, finalLotSize, signal.instrument, userAcct.currency, entryPrice);
    const simPotentialLoss = calculateMoneyPnL(simSlDist, finalLotSize, signal.instrument, userAcct.currency, entryPrice);
    const simCurrSym = userAcct.currency === "USD" ? "$" : userAcct.currency === "EUR" ? "€" : "£";
    const simProfitStr = isFinite(simPotentialProfit) ? `${simCurrSym}${Math.abs(simPotentialProfit).toFixed(2)}` : "calculating";
    const simLossStr = isFinite(simPotentialLoss) ? `${simCurrSym}${Math.abs(simPotentialLoss).toFixed(2)}` : "calculating";
    
    pushNotificationService.sendTradeNotification(
      userId, signal.instrument, signal.direction, 'opened', undefined,
      `${signal.timeframe} ${signal.direction.toUpperCase()} @ ${entryPrice.toFixed(signal.instrument.includes("XA") ? 2 : 5)} | ${signal.confidence}% | Profit: ${simProfitStr} | Risk: ${simLossStr}`,
      trade.id
    ).catch((err) => { console.error(`[PushNotifications] Failed trade notification for user ${userId.slice(0,8)}:`, err?.message || err); });
  }
  return userTradeIds;
}

// Check if a trade has hit TP or SL
function checkTradeOutcome(trade: SimulatedTrade, currentPrice: number): {
  status: SimulatedTrade["status"];
  closePrice?: number;
  pnlPips?: number;
  pnlPercent?: number;
} {
  const isMetal = trade.instrument === "XAUUSD" || trade.instrument === "XAGUSD";
  const pipSize = PIP_VALUES[trade.instrument] || 0.0001;
  const isBuy = trade.direction === "buy";

  // For buy trades: price needs to go up to TP, down to SL
  // For sell trades: price needs to go down to TP, up to SL
  
  let hitTP1 = false;
  let hitTP2 = false;
  let hitSL = false;

  if (isBuy) {
    hitTP1 = currentPrice >= trade.takeProfit1;
    hitTP2 = trade.takeProfit2 ? currentPrice >= trade.takeProfit2 : false;
    hitSL = currentPrice <= trade.stopLoss;
  } else {
    hitTP1 = currentPrice <= trade.takeProfit1;
    hitTP2 = trade.takeProfit2 ? currentPrice <= trade.takeProfit2 : false;
    hitSL = currentPrice >= trade.stopLoss;
  }

  if (hitSL) {
    const pnlPips = isBuy 
      ? (trade.stopLoss - trade.entryPrice) / pipSize
      : (trade.entryPrice - trade.stopLoss) / pipSize;
    return {
      status: "sl_hit",
      closePrice: trade.stopLoss,
      pnlPips,
      pnlPercent: (pnlPips * pipSize / trade.entryPrice) * 100,
    };
  }

  if (hitTP2 && trade.takeProfit2) {
    const pnlPips = isBuy
      ? (trade.takeProfit2 - trade.entryPrice) / pipSize
      : (trade.entryPrice - trade.takeProfit2) / pipSize;
    return {
      status: "tp2_hit",
      closePrice: trade.takeProfit2,
      pnlPips,
      pnlPercent: (pnlPips * pipSize / trade.entryPrice) * 100,
    };
  }

  if (hitTP1) {
    const pnlPips = isBuy
      ? (trade.takeProfit1 - trade.entryPrice) / pipSize
      : (trade.entryPrice - trade.takeProfit1) / pipSize;
    return {
      status: "tp1_hit",
      closePrice: trade.takeProfit1,
      pnlPips,
      pnlPercent: (pnlPips * pipSize / trade.entryPrice) * 100,
    };
  }

  return { status: "open" };
}

// ============================================================
// PERSISTENT TRADE JOURNAL ROUTES
// ============================================================

export function registerJournalRoutes(app: Express) {
  // Get all trades from journal (newest first) - filtered by user
  app.get("/api/journal", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.json([]);
      }
      
      const trades = await db
        .select()
        .from(tradeJournalTable)
        .where(eq(tradeJournalTable.userId, userId))
        .orderBy(desc(tradeJournalTable.entryTime));
      res.json(trades);
    } catch (error) {
      console.error("Error fetching trade journal:", error);
      res.status(500).json({ error: "Failed to fetch trade journal" });
    }
  });

  // Get journal statistics - filtered by user
  app.get("/api/journal/stats", async (req, res) => {
    try {
      const userId = getUserId(req);
      
      if (!userId) {
        return res.json({ totalTrades: 0, closedTrades: 0, winRate: 0, totalPnL: 0, totalPips: 0, avgPnL: 0, profitFactor: 0, openTrades: 0 });
      }
      
      const trades = await db
        .select()
        .from(tradeJournalTable)
        .where(eq(tradeJournalTable.userId, userId));
        
      type Trade = typeof trades[number];
      const closedTrades = trades.filter((t: Trade) => t.status === "closed");
      const wins = closedTrades.filter((t: Trade) => t.outcome === "win");
      const losses = closedTrades.filter((t: Trade) => t.outcome === "loss");
      
      const totalPnL = closedTrades.reduce((sum: number, t: Trade) => sum + (t.pnlGBP || 0), 0);
      const totalPips = closedTrades.reduce((sum: number, t: Trade) => sum + (t.pnlPips || 0), 0);
      const winPnL = wins.reduce((sum: number, t: Trade) => sum + (t.pnlGBP || 0), 0);
      const lossPnL = Math.abs(losses.reduce((sum: number, t: Trade) => sum + (t.pnlGBP || 0), 0));
      
      res.json({
        totalTrades: trades.length,
        closedTrades: closedTrades.length,
        openTrades: trades.filter((t: Trade) => t.status === "open").length,
        wins: wins.length,
        losses: losses.length,
        winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
        totalPnLGBP: totalPnL,
        totalPnLPips: totalPips,
        profitFactor: lossPnL > 0 ? winPnL / lossPnL : winPnL > 0 ? Infinity : 0,
        avgWinGBP: wins.length > 0 ? winPnL / wins.length : 0,
        avgLossGBP: losses.length > 0 ? lossPnL / losses.length : 0,
      });
    } catch (error) {
      console.error("Error fetching journal stats:", error);
      res.status(500).json({ error: "Failed to fetch journal stats" });
    }
  });

  // Add a new trade to journal (with userId)
  app.post("/api/journal", async (req, res) => {
    try {
      const userId = getUserId(req);
      const validatedData = insertTradeJournalSchema.parse({ ...req.body, userId });
      const [newTrade] = await db.insert(tradeJournalTable).values(validatedData).returning();
      
      if (userId) {
        await logUserAction(userId, "journal_add", { instrument: newTrade.instrument, direction: newTrade.direction }, req);
      }
      
      res.json(newTrade);
    } catch (error) {
      console.error("Error adding trade to journal:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid trade data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to add trade to journal" });
      }
    }
  });

  // Update a trade (e.g., close it) - only own trades
  app.patch("/api/journal/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const updates = req.body;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const [updated] = await db
        .update(tradeJournalTable)
        .set(updates)
        .where(
          and(
            eq(tradeJournalTable.id, id),
            eq(tradeJournalTable.userId, userId)
          )
        )
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Trade not found" });
      }
      
      if (userId) {
        await logUserAction(userId, "journal_update", { tradeId: id, updates }, req);
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating trade:", error);
      res.status(500).json({ error: "Failed to update trade" });
    }
  });

  // Delete a trade - only own trades
  app.delete("/api/journal/:id", async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      await db.delete(tradeJournalTable).where(
        and(
          eq(tradeJournalTable.id, id),
          eq(tradeJournalTable.userId, userId)
        )
      );
      
      if (userId) {
        await logUserAction(userId, "journal_delete", { tradeId: id }, req);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting trade:", error);
      res.status(500).json({ error: "Failed to delete trade" });
    }
  });

  // ============================================================
  // USER SETTINGS ROUTES (Per-User)
  // ============================================================

  // Get user's settings
  app.get("/api/user/settings", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }
      
      const settings = await getUserSettings(userId);
      res.json(settings);
    } catch (error) {
      console.error("Error fetching user settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // Update user's settings
  app.patch("/api/user/settings", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }
      
      const allowedFields = [
        "autoExecuteEnabled", "simulationEnabled", "dailyLossLimitPercent",
        "maxOpenPositions", "correlationWarningEnabled", "sessionFilterEnabled",
        "preferredSessions", "newsBlackoutMinutes", "consecutiveLossLimit",
        "minAccountBalance", "defaultRiskPercent", "maxDailyTrades",
        "showOnLeaderboard", "simulationInstruments", "simulationTimeframes",
        "oandaInstruments", "oandaTimeframes",
        "telegramEnabled", "telegramChatId", "telegramAutoExecute", "telegramRiskPercent", "telegramAccountType",
        "confidenceBoostThreshold", "confidenceBoostMultiplier", "displayName",
        "maxAutoExecuteRiskPercent",
      ];
      const raw = req.body;
      const updates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (key in raw) updates[key] = raw[key];
      }
      
      if ("maxAutoExecuteRiskPercent" in updates) {
        const val = Number(updates.maxAutoExecuteRiskPercent);
        if (isNaN(val) || val < 0 || val > 10) {
          return res.status(400).json({ error: "Max risk must be between 0 and 10" });
        }
        updates.maxAutoExecuteRiskPercent = val;
      }

      // Ensure user has settings row
      await getUserSettings(userId);
      
      const [updated] = await db
        .update(userSettingsTable)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(eq(userSettingsTable.userId, userId))
        .returning();
      
      await logUserAction(userId, "settings_update", { updates }, req);
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating user settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Get user onboarding status
  app.get("/api/user/onboarding-status", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.json({ completed: true });
      }
      const settings = await getUserSettings(userId);
      res.json({ completed: settings.onboardingCompleted });
    } catch (error) {
      res.json({ completed: true });
    }
  });

  // Complete onboarding
  app.post("/api/user/onboarding-complete", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }
      await getUserSettings(userId);
      await db.update(userSettingsTable)
        .set({ onboardingCompleted: true, updatedAt: new Date().toISOString() })
        .where(eq(userSettingsTable.userId, userId));
      await logUserAction(userId, "onboarding_complete", {}, req);
      res.json({ success: true });
    } catch (error) {
      console.error("Error completing onboarding:", error);
      res.status(500).json({ error: "Failed to complete onboarding" });
    }
  });

  // ============================================================
  // AUTOMATED REPORTS (Daily/Weekly P&L)
  // ============================================================

  // Get daily report for a specific date (or today)
  app.get("/api/reports/daily", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const allTrades = await storage.getSimulatedTrades();
      const userTrades = allTrades.filter(t => t.userId === userId);
      const closedTrades = userTrades.filter(t => t.status !== "open" && t.closedAt);

      const dayTrades = closedTrades.filter(t => {
        const closed = t.closedAt ? t.closedAt.slice(0, 10) : "";
        return closed === dateStr;
      });

      const wins = dayTrades.filter(t => (t.pnlPips || 0) > 0).length;
      const losses = dayTrades.filter(t => (t.pnlPips || 0) < 0).length;
      const breakevens = dayTrades.filter(t => (t.pnlPips || 0) === 0).length;
      const totalPips = dayTrades.reduce((s, t) => s + (t.pnlPips || 0), 0);
      const totalPnl = dayTrades.reduce((s, t) => s + (t.pnlMoney || 0), 0);
      const winRate = dayTrades.length > 0 ? Math.round((wins / dayTrades.length) * 100) : 0;

      const byInstrument: Record<string, { trades: number; pips: number; pnl: number; wins: number }> = {};
      for (const t of dayTrades) {
        if (!byInstrument[t.instrument]) byInstrument[t.instrument] = { trades: 0, pips: 0, pnl: 0, wins: 0 };
        byInstrument[t.instrument].trades++;
        byInstrument[t.instrument].pips += t.pnlPips || 0;
        byInstrument[t.instrument].pnl += t.pnlMoney || 0;
        if ((t.pnlPips || 0) > 0) byInstrument[t.instrument].wins++;
      }

      const bestInstrument = Object.entries(byInstrument).sort((a, b) => b[1].pips - a[1].pips)[0];
      const worstInstrument = Object.entries(byInstrument).sort((a, b) => a[1].pips - b[1].pips)[0];

      res.json({
        date: dateStr,
        totalTrades: dayTrades.length,
        wins,
        losses,
        breakevens,
        winRate,
        totalPips: Math.round(totalPips * 10) / 10,
        totalPnl: Math.round(totalPnl * 100) / 100,
        byInstrument,
        bestInstrument: bestInstrument ? { name: bestInstrument[0], pips: Math.round(bestInstrument[1].pips * 10) / 10 } : null,
        worstInstrument: worstInstrument ? { name: worstInstrument[0], pips: Math.round(worstInstrument[1].pips * 10) / 10 } : null,
        trades: dayTrades.map(t => ({
          instrument: t.instrument,
          direction: t.direction,
          timeframe: t.timeframe,
          pnlPips: Math.round((t.pnlPips || 0) * 10) / 10,
          pnlMoney: Math.round((t.pnlMoney || 0) * 100) / 100,
          status: t.status,
          openedAt: t.openedAt,
          closedAt: t.closedAt,
        })),
      });
    } catch (error) {
      console.error("Error generating daily report:", error);
      res.status(500).json({ error: "Failed to generate daily report" });
    }
  });

  // Get weekly report
  app.get("/api/reports/weekly", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const now = new Date();
      const weekStart = new Date(now);
      const dayOfWeek = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString().slice(0, 10);

      const allTrades = await storage.getSimulatedTrades();
      const userTrades = allTrades.filter(t => t.userId === userId);
      const closedTrades = userTrades.filter(t => t.status !== "open" && t.closedAt);

      const weekTrades = closedTrades.filter(t => {
        const closed = t.closedAt ? t.closedAt.slice(0, 10) : "";
        return closed >= weekStartStr;
      });

      const wins = weekTrades.filter(t => (t.pnlPips || 0) > 0).length;
      const losses = weekTrades.filter(t => (t.pnlPips || 0) < 0).length;
      const totalPips = weekTrades.reduce((s, t) => s + (t.pnlPips || 0), 0);
      const totalPnl = weekTrades.reduce((s, t) => s + (t.pnlMoney || 0), 0);
      const winRate = weekTrades.length > 0 ? Math.round((wins / weekTrades.length) * 100) : 0;

      const grossWin = weekTrades.filter(t => (t.pnlPips || 0) > 0).reduce((s, t) => s + (t.pnlPips || 0), 0);
      const grossLoss = Math.abs(weekTrades.filter(t => (t.pnlPips || 0) < 0).reduce((s, t) => s + (t.pnlPips || 0), 0));
      const profitFactor = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 999 : 0;

      const byInstrument: Record<string, { trades: number; pips: number; pnl: number; wins: number; losses: number }> = {};
      for (const t of weekTrades) {
        if (!byInstrument[t.instrument]) byInstrument[t.instrument] = { trades: 0, pips: 0, pnl: 0, wins: 0, losses: 0 };
        byInstrument[t.instrument].trades++;
        byInstrument[t.instrument].pips += t.pnlPips || 0;
        byInstrument[t.instrument].pnl += t.pnlMoney || 0;
        if ((t.pnlPips || 0) > 0) byInstrument[t.instrument].wins++;
        else byInstrument[t.instrument].losses++;
      }

      const dailyBreakdown: Record<string, { trades: number; pips: number; pnl: number; wins: number }> = {};
      for (const t of weekTrades) {
        const day = t.closedAt ? t.closedAt.slice(0, 10) : "";
        if (!dailyBreakdown[day]) dailyBreakdown[day] = { trades: 0, pips: 0, pnl: 0, wins: 0 };
        dailyBreakdown[day].trades++;
        dailyBreakdown[day].pips += t.pnlPips || 0;
        dailyBreakdown[day].pnl += t.pnlMoney || 0;
        if ((t.pnlPips || 0) > 0) dailyBreakdown[day].wins++;
      }

      const bestInstrument = Object.entries(byInstrument).sort((a, b) => b[1].pips - a[1].pips)[0];
      const worstInstrument = Object.entries(byInstrument).sort((a, b) => a[1].pips - b[1].pips)[0];

      const settings = await getUserSettings(userId);

      res.json({
        weekStart: weekStartStr,
        weekEnd: now.toISOString().slice(0, 10),
        totalTrades: weekTrades.length,
        wins,
        losses,
        winRate,
        totalPips: Math.round(totalPips * 10) / 10,
        totalPnl: Math.round(totalPnl * 100) / 100,
        profitFactor,
        byInstrument,
        dailyBreakdown,
        bestInstrument: bestInstrument ? { name: bestInstrument[0], pips: Math.round(bestInstrument[1].pips * 10) / 10 } : null,
        worstInstrument: worstInstrument ? { name: worstInstrument[0], pips: Math.round(worstInstrument[1].pips * 10) / 10 } : null,
        accountBalance: settings.paperCurrentBalance,
        accountCurrency: settings.paperCurrency,
        returnPercent: settings.paperStartingBalance > 0 
          ? Math.round(((settings.paperCurrentBalance - settings.paperStartingBalance) / settings.paperStartingBalance) * 10000) / 100
          : 0,
      });
    } catch (error) {
      console.error("Error generating weekly report:", error);
      res.status(500).json({ error: "Failed to generate weekly report" });
    }
  });

  // Get equity curve data (balance snapshots over time)
  app.get("/api/reports/equity-curve", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const allTrades = await storage.getSimulatedTrades();
      const userTrades = allTrades.filter(t => t.userId === userId);
      const closedTrades = userTrades
        .filter(t => t.status !== "open" && t.closedAt && t.pnlMoney !== undefined)
        .sort((a, b) => (a.closedAt || "").localeCompare(b.closedAt || ""));

      const settings = await getUserSettings(userId);
      const startingBalance = settings.paperStartingBalance;

      const equityPoints: { date: string; balance: number; pnl: number; trade: string; pips: number }[] = [];
      let runningBalance = startingBalance;

      equityPoints.push({
        date: closedTrades[0]?.openedAt || new Date().toISOString(),
        balance: startingBalance,
        pnl: 0,
        trade: "Starting Balance",
        pips: 0,
      });

      for (const trade of closedTrades) {
        runningBalance += trade.pnlMoney || 0;
        equityPoints.push({
          date: trade.closedAt || "",
          balance: Math.round(runningBalance * 100) / 100,
          pnl: Math.round((trade.pnlMoney || 0) * 100) / 100,
          trade: `${trade.direction.toUpperCase()} ${trade.instrument}`,
          pips: Math.round((trade.pnlPips || 0) * 10) / 10,
        });
      }

      const peak = Math.max(...equityPoints.map(p => p.balance));
      const trough = Math.min(...equityPoints.map(p => p.balance));
      const maxDrawdown = peak > 0 ? Math.round(((peak - trough) / peak) * 10000) / 100 : 0;

      res.json({
        equityPoints,
        currentBalance: Math.round(runningBalance * 100) / 100,
        startingBalance,
        totalReturn: Math.round((runningBalance - startingBalance) * 100) / 100,
        returnPercent: startingBalance > 0 ? Math.round(((runningBalance - startingBalance) / startingBalance) * 10000) / 100 : 0,
        peakBalance: Math.round(peak * 100) / 100,
        maxDrawdown,
        currency: settings.paperCurrency,
        totalTrades: closedTrades.length,
      });
    } catch (error) {
      console.error("Error generating equity curve:", error);
      res.status(500).json({ error: "Failed to generate equity curve" });
    }
  });

  // Get list of available daily report dates
  app.get("/api/reports/dates", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const allTrades = await storage.getSimulatedTrades();
      const userTrades = allTrades.filter(t => t.userId === userId);
      const closedTrades = userTrades.filter(t => t.status !== "open" && t.closedAt);

      const dates = new Set<string>();
      for (const t of closedTrades) {
        if (t.closedAt) dates.add(t.closedAt.slice(0, 10));
      }

      const sortedDates = Array.from(dates).sort().reverse();
      res.json({ dates: sortedDates });
    } catch (error) {
      res.status(500).json({ error: "Failed to get report dates" });
    }
  });

  // Get user's audit log
  app.get("/api/user/audit-log", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }
      
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await db
        .select()
        .from(userAuditLogTable)
        .where(eq(userAuditLogTable.userId, userId))
        .orderBy(desc(userAuditLogTable.createdAt))
        .limit(limit);
      
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit log:", error);
      res.status(500).json({ error: "Failed to fetch audit log" });
    }
  });

  // ============================================================
  // PERSISTENT SIGNAL HISTORY ROUTES
  // ============================================================

  app.get("/api/signals/daily", async (req, res) => {
    try {
      const dateStr = (req.query.date as string) || new Date().toISOString().split("T")[0];
      const dayStart = `${dateStr}T00:00:00`;
      const dayEnd = `${dateStr}T23:59:59`;

      const signals = await db.select()
        .from(signalHistoryTable)
        .where(
          and(
            gte(signalHistoryTable.generatedAt, dayStart),
            lte(signalHistoryTable.generatedAt, dayEnd)
          )
        )
        .orderBy(desc(signalHistoryTable.generatedAt));

      for (const sig of signals) {
        if (sig.outcome || sig.direction === "stand_aside") continue;
        try {
          const analysis = storage.getCachedAnalysis(sig.instrument as Instrument, sig.timeframe as Timeframe);
          if (!analysis) continue;
          const currentPrice = analysis.currentPrice;
          const pipSize = sig.instrument === "XAUUSD" ? 0.1 : sig.instrument === "XAGUSD" ? 0.01 : sig.instrument.includes("JPY") ? 0.01 : 0.0001;

          if (sig.direction === "buy") {
            if (currentPrice >= sig.takeProfit1) {
              await db.update(signalHistoryTable).set({ outcome: "tp1_hit", outcomePrice: currentPrice, outcomeTime: new Date().toISOString() }).where(eq(signalHistoryTable.id, sig.id));
              sig.outcome = "tp1_hit"; sig.outcomePrice = currentPrice;
            } else if (currentPrice <= sig.stopLoss) {
              await db.update(signalHistoryTable).set({ outcome: "sl_hit", outcomePrice: currentPrice, outcomeTime: new Date().toISOString() }).where(eq(signalHistoryTable.id, sig.id));
              sig.outcome = "sl_hit"; sig.outcomePrice = currentPrice;
            }
          } else if (sig.direction === "sell") {
            if (currentPrice <= sig.takeProfit1) {
              await db.update(signalHistoryTable).set({ outcome: "tp1_hit", outcomePrice: currentPrice, outcomeTime: new Date().toISOString() }).where(eq(signalHistoryTable.id, sig.id));
              sig.outcome = "tp1_hit"; sig.outcomePrice = currentPrice;
            } else if (currentPrice >= sig.stopLoss) {
              await db.update(signalHistoryTable).set({ outcome: "sl_hit", outcomePrice: currentPrice, outcomeTime: new Date().toISOString() }).where(eq(signalHistoryTable.id, sig.id));
              sig.outcome = "sl_hit"; sig.outcomePrice = currentPrice;
            }
          }
        } catch {}
      }

      const withOutcome = signals.filter(s => s.outcome && s.direction !== "stand_aside");
      const actionable = signals.filter(s => s.direction !== "stand_aside");
      const wins = withOutcome.filter(s => s.outcome === "tp1_hit" || s.outcome === "tp2_hit" || s.outcome === "managed_close");
      const losses = withOutcome.filter(s => s.outcome === "sl_hit");
      const pending = actionable.filter(s => !s.outcome);

      let totalPips = 0;
      for (const s of withOutcome) {
        if (!s.outcomePrice) continue;
        const ps = s.instrument === "XAUUSD" ? 0.1 : s.instrument === "XAGUSD" ? 0.01 : s.instrument.includes("JPY") ? 0.01 : 0.0001;
        const entryMid = (s.entryLow + s.entryHigh) / 2;
        const pips = s.direction === "buy" ? (s.outcomePrice - entryMid) / ps : (entryMid - s.outcomePrice) / ps;
        totalPips += pips;
      }

      res.json({
        date: dateStr,
        signals,
        stats: {
          total: actionable.length,
          wins: wins.length,
          losses: losses.length,
          pending: pending.length,
          winRate: withOutcome.length > 0 ? Math.round((wins.length / withOutcome.length) * 100) : 0,
          totalPips: Math.round(totalPips * 10) / 10,
        }
      });
    } catch (error) {
      console.error("Error fetching daily signals:", error);
      res.status(500).json({ error: "Failed to fetch daily signals" });
    }
  });

  // Get signal history (newest first)
  app.get("/api/signals/history", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const signals = await db
        .select()
        .from(signalHistoryTable)
        .orderBy(desc(signalHistoryTable.generatedAt))
        .limit(limit);
      res.json(signals);
    } catch (error) {
      console.error("Error fetching signal history:", error);
      res.status(500).json({ error: "Failed to fetch signal history" });
    }
  });

  // Get signal history stats
  app.get("/api/signals/history/stats", async (req, res) => {
    try {
      const signals = await db.select().from(signalHistoryTable);
      type Signal = typeof signals[number];
      const withOutcome = signals.filter((s: Signal) => s.outcome);
      const wins = withOutcome.filter((s: Signal) => s.outcome === "tp1_hit" || s.outcome === "tp2_hit" || s.outcome === "managed_close");
      const losses = withOutcome.filter((s: Signal) => s.outcome === "sl_hit");

      const calcPips = (s: Signal): number => {
        if (!s.outcomePrice || !s.entryLow || !s.entryHigh) return 0;
        const entryMid = (s.entryLow + s.entryHigh) / 2;
        const isMetal = s.instrument === "XAUUSD" || s.instrument === "XAGUSD";
        const isJpy = s.instrument?.includes("JPY");
        const pipMultiplier = isMetal ? 10 : isJpy ? 100 : 10000;
        const rawPips = (s.outcomePrice - entryMid) * pipMultiplier;
        return s.direction === "sell" ? -rawPips : rawPips;
      };

      const buildInstrumentStats = (instSignals: Signal[], instWins: Signal[], instLosses: Signal[]) => {
        const pipsArr = instSignals.filter((s: Signal) => s.outcome && s.outcome !== "expired").map(calcPips);
        const totalPips = pipsArr.reduce((sum, p) => sum + p, 0);
        const avgPips = pipsArr.length > 0 ? totalPips / pipsArr.length : 0;
        const bestPips = pipsArr.length > 0 ? Math.max(...pipsArr) : 0;
        const worstPips = pipsArr.length > 0 ? Math.min(...pipsArr) : 0;
        const wr = instSignals.length > 0 ? (instWins.length / instSignals.length) * 100 : 0;
        let rating = "New";
        if (instSignals.length >= 5) {
          if (wr >= 70) rating = "Excellent";
          else if (wr >= 55) rating = "Good";
          else if (wr >= 40) rating = "Average";
          else rating = "Poor";
        }
        return {
          total: instSignals.length,
          wins: instWins.length,
          losses: instLosses.length,
          winRate: Math.round(wr * 10) / 10,
          totalPips: Math.round(totalPips * 10) / 10,
          avgPips: Math.round(avgPips * 10) / 10,
          bestPips: Math.round(bestPips * 10) / 10,
          worstPips: Math.round(worstPips * 10) / 10,
          rating,
        };
      };

      const byInstrument: Record<string, any> = {};
      for (const inst of instruments) {
        const instSignals = withOutcome.filter((s: Signal) => s.instrument === inst);
        if (instSignals.length === 0) continue;
        const instWins = instSignals.filter((s: Signal) => s.outcome === "tp1_hit" || s.outcome === "tp2_hit" || s.outcome === "managed_close");
        const instLosses = instSignals.filter((s: Signal) => s.outcome === "sl_hit");
        const stats = buildInstrumentStats(instSignals, instWins, instLosses);

        const timeframes = [...new Set(instSignals.map((s: Signal) => s.timeframe))];
        const byTimeframe: Record<string, any> = {};
        for (const tf of timeframes) {
          if (!tf) continue;
          const tfSignals = instSignals.filter((s: Signal) => s.timeframe === tf);
          const tfWins = tfSignals.filter((s: Signal) => s.outcome === "tp1_hit" || s.outcome === "tp2_hit" || s.outcome === "managed_close");
          const tfLosses = tfSignals.filter((s: Signal) => s.outcome === "sl_hit");
          byTimeframe[tf] = buildInstrumentStats(tfSignals, tfWins, tfLosses);
        }

        byInstrument[inst] = { ...stats, byTimeframe };
      }

      const allPips = withOutcome.filter((s: Signal) => s.outcome && s.outcome !== "expired").map(calcPips);
      
      res.json({
        totalSignals: signals.length,
        signalsWithOutcome: withOutcome.length,
        pendingSignals: signals.filter((s: Signal) => !s.outcome).length,
        wins: wins.length,
        losses: losses.length,
        winRate: withOutcome.length > 0 ? Math.round((wins.length / withOutcome.length) * 1000) / 10 : 0,
        totalPips: Math.round(allPips.reduce((s, p) => s + p, 0) * 10) / 10,
        byInstrument,
      });
    } catch (error) {
      console.error("Error fetching signal stats:", error);
      res.status(500).json({ error: "Failed to fetch signal stats" });
    }
  });

  // Save a signal to history
  app.post("/api/signals/history", async (req, res) => {
    try {
      const validatedData = insertSignalHistorySchema.parse(req.body);
      const [newSignal] = await db.insert(signalHistoryTable).values(validatedData).returning();
      res.json(newSignal);
    } catch (error) {
      console.error("Error saving signal to history:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid signal data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to save signal" });
      }
    }
  });

  // Update signal outcome
  app.patch("/api/signals/history/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const [updated] = await db
        .update(signalHistoryTable)
        .set(updates)
        .where(eq(signalHistoryTable.id, id))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Signal not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating signal:", error);
      res.status(500).json({ error: "Failed to update signal" });
    }
  });

  // === PUSH NOTIFICATION ENDPOINTS ===
  
  // Get VAPID public key for subscription
  app.get("/api/push/vapid-key", (req, res) => {
    const publicKey = pushNotificationService.getPublicKey();
    if (!publicKey) {
      return res.status(503).json({ 
        error: "Push notifications not configured",
        configured: false 
      });
    }
    res.json({ publicKey, configured: true });
  });

  // Subscribe to push notifications
  const pushSubscriptionSchema = z.object({
    subscription: z.object({
      endpoint: z.string().url(),
      keys: z.object({
        p256dh: z.string().min(1),
        auth: z.string().min(1)
      })
    }),
    instruments: z.array(z.enum(instruments)).optional().default(['XAUUSD', 'GBPUSD', 'EURUSD']),
    minConfidence: z.number().min(50).max(95).optional().default(70)
  });

  app.post("/api/push/subscribe", async (req, res) => {
    try {
      const userId = getUserId(req) || 'anonymous';
      const validated = pushSubscriptionSchema.parse(req.body);

      const result = await pushNotificationService.subscribe(
        validated.subscription,
        userId,
        validated.instruments,
        validated.minConfidence
      );
      
      if (userId !== 'anonymous') {
        await logUserAction(userId, "push_subscribe", { instruments: validated.instruments, minConfidence: validated.minConfidence }, req);
      }

      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid subscription data", details: error.errors });
      }
      console.error("Error subscribing to push:", error);
      res.status(500).json({ error: "Failed to subscribe" });
    }
  });

  // Unsubscribe from push notifications
  const unsubscribeSchema = z.object({
    endpoint: z.string().url()
  });

  app.post("/api/push/unsubscribe", async (req, res) => {
    try {
      const validated = unsubscribeSchema.parse(req.body);
      const success = await pushNotificationService.unsubscribe(validated.endpoint);
      res.json({ success });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid endpoint" });
      }
      console.error("Error unsubscribing:", error);
      res.status(500).json({ error: "Failed to unsubscribe" });
    }
  });

  // Update notification preferences
  const preferencesSchema = z.object({
    endpoint: z.string().url(),
    instruments: z.array(z.enum(instruments)),
    minConfidence: z.number().min(50).max(95)
  });

  app.patch("/api/push/preferences", async (req, res) => {
    try {
      const validated = preferencesSchema.parse(req.body);

      const success = await pushNotificationService.updatePreferences(
        validated.endpoint,
        validated.instruments,
        validated.minConfidence
      );

      res.json({ success });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid preferences data" });
      }
      console.error("Error updating preferences:", error);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  // Get push notification stats
  app.get("/api/push/stats", async (req, res) => {
    const count = await pushNotificationService.getSubscriptionCount();
    res.json({
      configured: pushNotificationService.isConfigured(),
      subscriptionCount: count
    });
  });

  // Test push notification (for debugging)
  app.post("/api/push/test", async (req, res) => {
    try {
      const testSignal = {
        instrument: 'XAUUSD',
        timeframe: '1h',
        direction: 'buy',
        confidence: 85,
        entryZone: { low: 4890, high: 4895 },
        stopLoss: 4870,
        takeProfit1: 4920
      };

      const sentCount = await pushNotificationService.sendSignalNotification(testSignal);
      res.json({ success: true, sentCount });
    } catch (error) {
      console.error("Error sending test notification:", error);
      res.status(500).json({ error: "Failed to send test" });
    }
  });

  // ============================================================
  // MT5 EXPERT ADVISOR API ENDPOINTS
  // ============================================================

  // Get active high-confidence signals for MT5 EA
  app.get("/api/mt5/signals", async (req, res) => {
    try {
      const minConfidence = parseInt(req.query.minConfidence as string) || 70;
      const instrument = req.query.instrument as string;
      
      // Get risk management settings
      const riskSettings = storage.getRiskManagement();
      const simulationEnabled = storage.isSimulationEnabled();
      
      // Check if simulation/auto-trading is enabled
      if (!simulationEnabled) {
        return res.json({
          signals: [],
          message: "Auto-trading is disabled. Enable simulation in settings.",
          autoTradeEnabled: false,
          timestamp: new Date().toISOString()
        });
      }
      
      // Get all current signals from cached analysis
      const activeSignals: any[] = [];
      
      for (const inst of instruments) {
        if (instrument && inst !== instrument) continue;
        
        // Check 1h and 15m timeframes (most reliable for trading)
        for (const tf of ["1h", "15m", "5m"] as Timeframe[]) {
          const analysis = storage.getCachedAnalysis(inst, tf);
          if (!analysis) continue;
          
          // Generate signal for this instrument/timeframe
          const signal = generateSignal(analysis);
          
          // Only include high-confidence signals with clear direction
          if (signal && signal.confidence >= minConfidence && signal.direction !== "stand_aside") {
            // Check if we already have an open trade for this instrument
            const openTrades = await storage.getOpenSimulatedTrades();
            const hasOpenTrade = openTrades.some(t => t.instrument === inst);
            
            // Check max positions limit
            const maxPositionsReached = openTrades.length >= riskSettings.maxOpenPositions;
            
            activeSignals.push({
              id: `${inst}_${tf}_${Date.now()}`,
              instrument: inst,
              timeframe: tf,
              direction: signal.direction,
              confidence: signal.confidence,
              entryPrice: (signal.entryZone.low + signal.entryZone.high) / 2,
              entryLow: signal.entryZone.low,
              entryHigh: signal.entryZone.high,
              stopLoss: signal.stopLoss,
              takeProfit1: signal.takeProfit1,
              takeProfit2: signal.takeProfit2,
              riskRewardRatio: signal.riskRewardRatio,
              reasoning: signal.reasoning,
              canTrade: !hasOpenTrade && !maxPositionsReached,
              hasOpenTrade,
              maxPositionsReached,
              generatedAt: new Date().toISOString(),
              validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // Valid for 15 minutes
            });
          }
        }
      }
      
      // Sort by confidence (highest first)
      activeSignals.sort((a, b) => b.confidence - a.confidence);
      
      res.json({
        signals: activeSignals,
        autoTradeEnabled: simulationEnabled,
        maxPositions: riskSettings.maxOpenPositions,
        currentOpenPositions: (await storage.getOpenSimulatedTrades()).length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error fetching MT5 signals:", error);
      res.status(500).json({ error: "Failed to fetch signals" });
    }
  });

  // Report trade execution from MT5 EA
  const mt5TradeReportSchema = z.object({
    signalId: z.string(),
    instrument: z.enum(instruments),
    direction: z.enum(["buy", "sell"]),
    entryPrice: z.number(),
    stopLoss: z.number(),
    takeProfit: z.number(),
    lotSize: z.number(),
    ticket: z.number().optional(), // MT5 order ticket
    status: z.enum(["opened", "closed", "cancelled"]),
    exitPrice: z.number().optional(),
    pnlPips: z.number().optional(),
    pnlGBP: z.number().optional(),
    closedAt: z.string().optional(),
  });

  app.post("/api/mt5/report", async (req, res) => {
    try {
      const report = mt5TradeReportSchema.parse(req.body);
      
      console.log(`[MT5] Trade report: ${report.instrument} ${report.direction} ${report.status}`, {
        ticket: report.ticket,
        entry: report.entryPrice,
        pnl: report.pnlPips
      });
      
      // If trade opened, create a journal entry
      if (report.status === "opened") {
        const tradeData = {
          instrument: report.instrument,
          direction: report.direction,
          entryPrice: report.entryPrice,
          stopLoss: report.stopLoss,
          takeProfit: report.takeProfit,
          lotSize: report.lotSize,
          status: "open",
          notes: `MT5 EA Trade - Ticket #${report.ticket || 'N/A'}`,
          timeframe: "1h",
          entryTime: new Date().toISOString(),
        };
        
        await db.insert(tradeJournalTable).values(tradeData);
      }
      
      // If trade closed, update the journal entry
      if (report.status === "closed" && report.exitPrice) {
        const pnlPips = report.pnlPips || 0;
        const outcome = pnlPips > 0 ? "win" : pnlPips < 0 ? "loss" : "breakeven";
        
        // Find and update the most recent open trade for this instrument
        const trades = await db.select().from(tradeJournalTable)
          .where(eq(tradeJournalTable.instrument, report.instrument))
          .orderBy(desc(tradeJournalTable.entryTime));
        
        const openTrade = trades.find(t => t.status === "open");
        if (openTrade) {
          await db.update(tradeJournalTable)
            .set({
              status: "closed",
              outcome,
              exitPrice: report.exitPrice,
              pnlPips: report.pnlPips,
              pnlGBP: report.pnlGBP,
              exitTime: report.closedAt || new Date().toISOString(),
            })
            .where(eq(tradeJournalTable.id, openTrade.id));
        }
      }
      
      res.json({ 
        success: true, 
        message: `Trade ${report.status} recorded`,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error processing MT5 report:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid trade report", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to process report" });
      }
    }
  });

  // Get MT5 EA configuration
  app.get("/api/mt5/config", (req, res) => {
    const riskSettings = storage.getRiskManagement();
    
    res.json({
      enabled: storage.isSimulationEnabled(),
      riskPercent: 1, // 1% risk per trade
      maxPositions: riskSettings.maxOpenPositions,
      minConfidence: 70,
      allowedInstruments: instruments,
      allowedTimeframes: ["5m", "15m", "1h"],
      slippagePoints: 30,
      maxSpreadPoints: 50,
      tradeComment: "TradeIQ_EA",
      pollIntervalSeconds: 30,
      timestamp: new Date().toISOString()
    });
  });

  // MT5 EA heartbeat/status endpoint
  app.post("/api/mt5/heartbeat", (req, res) => {
    const { accountBalance, equity, openPositions, eaVersion } = req.body;
    
    console.log(`[MT5] Heartbeat - Balance: £${accountBalance}, Equity: £${equity}, Positions: ${openPositions}, EA v${eaVersion || '1.0'}`);
    
    res.json({
      status: "ok",
      serverTime: new Date().toISOString(),
      autoTradeEnabled: storage.isSimulationEnabled(),
      message: "Connection active"
    });
  });

  // =====================================================
  // OANDA API Integration - Direct broker trading (Per-User)
  // =====================================================

  // Configure OANDA connection (saves to user's account - STATELESS)
  app.post("/api/oanda/connect", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in to connect your OANDA account" });
      }

      const { apiKey, accountId, isLive } = req.body;
      
      if (!apiKey || !accountId) {
        return res.status(400).json({ error: "API key and account ID required" });
      }
      
      // Test the connection using STATELESS function (no singleton mutation)
      const creds: OandaCredentials = { apiKey, accountId, isLive: isLive || false };
      const success = await oandaTestConnection(creds);
      
      if (success) {
        // Save credentials to user's database record (encrypted)
        await saveUserOandaCredentials(userId, apiKey, accountId, isLive ? "live" : "demo");
        historicalDataService.setOandaCredentials(apiKey, accountId, isLive || false);
        
        const currentSettings = await getUserSettings(userId);
        const isFirstConnection = !currentSettings.updatedAt;
        
        if (isLive) {
          const safeUpdates: Record<string, any> = {};
          if ((currentSettings.defaultRiskPercent || 3) > 1) {
            safeUpdates.defaultRiskPercent = 1;
          }
          if ((currentSettings.dailyLossLimitPercent || 5) > 3) {
            safeUpdates.dailyLossLimitPercent = 3;
          }
          if (!currentSettings.guardianEnabled) {
            safeUpdates.guardianEnabled = true;
          }
          if (Object.keys(safeUpdates).length > 0) {
            await db.update(userSettingsTable)
              .set(safeUpdates)
              .where(eq(userSettingsTable.userId, userId));
            console.log(`[OANDA] Applied live safety defaults for user ${userId.slice(0, 8)}: ${JSON.stringify(safeUpdates)}`);
          }
        }
        
        if (isFirstConnection) {
          const firstTimeDefaults: Record<string, any> = {
            guardianEnabled: true,
            maxTradeDurationHours: 8,
            maxOpenPositions: 3,
            dailyLossLimitPercent: isLive ? 3 : 5,
            defaultRiskPercent: 1,
            updatedAt: new Date().toISOString(),
          };
          await db.update(userSettingsTable)
            .set(firstTimeDefaults)
            .where(eq(userSettingsTable.userId, userId));
          console.log(`[OANDA] Applied first-time defaults for new user ${userId.slice(0, 8)}: Guardian ON, 3 max trades, ${isLive ? '3' : '5'}% daily limit`);
        }
        
        // Log the connection action
        await logUserAction(userId, "oanda_connect", { 
          accountId, 
          environment: isLive ? "live" : "demo" 
        }, req);
        
        // Get account summary using stateless function
        const account = await oandaGetAccountSummary(creds);
        res.json({
          success: true,
          isLive,
          message: `Connected to OANDA ${isLive ? 'LIVE' : 'DEMO'} account`,
          safetyApplied: isLive,
          account: {
            balance: account.balance,
            currency: account.currency,
            openTradeCount: account.openTradeCount,
            unrealizedPL: account.unrealizedPL,
          }
        });
      } else {
        await logUserAction(userId, "oanda_connect_failed", { accountId }, req);
        res.status(401).json({ success: false, error: "Failed to connect - check API key and account ID" });
      }
    } catch (error) {
      console.error("[OANDA] Connect error:", error);
      res.status(500).json({ error: "Connection failed" });
    }
  });

  // Get OANDA connection status (checks user's saved credentials - STATELESS)
  app.get("/api/oanda/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.json({ connected: false, isOwner: false });
      }

      // Get user's saved credentials
      const userIsOwner = commissionService.isOwner(userId);

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds || !dbCreds.isConnected) {
        return res.json({ connected: false, isOwner: userIsOwner });
      }

      // Use stateless function with user's credentials (no race condition)
      const creds: OandaCredentials = {
        apiKey: dbCreds.apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live"
      };

      const connected = await oandaTestConnection(creds);
      if (!connected) {
        return res.json({ connected: false, isOwner: userIsOwner, error: "Credentials expired" });
      }
      
      const account = await oandaGetAccountSummary(creds);
      const trades = await oandaGetOpenTrades(creds);
      
      const journalEntries = await db.select().from(tradeJournalTable)
        .where(eq(tradeJournalTable.userId, userId));
      const openJournals = journalEntries.filter(j => j.status === "open");
      
      const accountCurrency = account.currency || "GBP";
      
      res.json({
        connected: true,
        isOwner: userIsOwner,
        environment: dbCreds.environment,
        account: {
          balance: account.balance,
          currency: accountCurrency,
          unrealizedPL: account.unrealizedPL,
          openTradeCount: trades.length,
          nav: account.NAV || account.balance,
          marginUsed: account.marginUsed || "0",
          marginAvailable: account.marginAvailable || account.balance,
          pl: account.pl || "0",
        },
        openTrades: trades.map(t => {
          const inst = t.instrument.replace(/_/g, "")
            .replace("XAUUSD", "XAUUSD");
          const entryPrice = parseFloat(t.price);
          const units = parseFloat(t.currentUnits);
          const direction = units > 0 ? "buy" : "sell";
          const sl = t.stopLossOrder ? parseFloat(t.stopLossOrder.price) : undefined;
          const tp = t.takeProfitOrder ? parseFloat(t.takeProfitOrder.price) : undefined;
          
          const journal = openJournals.find(j => 
            j.notes?.includes(`Trade ID: ${t.id}`)
          );
          const timeframe = journal?.timeframe || undefined;
          
          const pipSize = PIP_VALUES[inst] || 0.0001;
          const contractSize = CONTRACT_SIZES[inst] || 100000;
          const lotSize = Math.abs(units) / contractSize;
          
          let potentialProfit: number | undefined;
          let potentialLoss: number | undefined;
          
          if (tp) {
            const tpPips = direction === "buy"
              ? (tp - entryPrice) / pipSize
              : (entryPrice - tp) / pipSize;
            potentialProfit = Math.round(calculateMoneyPnL(tpPips, lotSize, inst, accountCurrency, entryPrice) * 100) / 100;
          }
          if (sl) {
            const slPips = direction === "buy"
              ? (sl - entryPrice) / pipSize
              : (entryPrice - sl) / pipSize;
            potentialLoss = Math.round(calculateMoneyPnL(slPips, lotSize, inst, accountCurrency, entryPrice) * 100) / 100;
          }
          
          return {
            id: t.id,
            instrument: inst,
            units,
            direction,
            entryPrice,
            unrealizedPL: parseFloat(t.unrealizedPL),
            stopLoss: sl,
            takeProfit: tp,
            openTime: t.openTime,
            timeframe,
            potentialProfit,
            potentialLoss,
            lotSize: Math.round(lotSize * 1000) / 1000,
          };
        }),
      });
    } catch (error) {
      console.error("[OANDA] Status error:", error);
      res.json({ connected: false, error: "Connection lost" });
    }
  });

  // Get all connected OANDA users' health overview
  app.get("/api/oanda/users-health", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const allCreds = await db.select({
        userId: userOandaCredentials.userId,
        accountId: userOandaCredentials.accountId,
        environment: userOandaCredentials.environment,
        isConnected: userOandaCredentials.isConnected,
        lastConnected: userOandaCredentials.lastConnected,
      }).from(userOandaCredentials).where(eq(userOandaCredentials.isConnected, true));

      const users = (await Promise.all(allCreds.map(async (cred) => {
        const settings = await getUserSettings(cred.userId);
        if (!settings.showOnLeaderboard) return null;
        const displayName = settings.displayName || cred.userId.slice(0, 8);

        let accountInfo = null;
        let openTradeCount = 0;
        let connectionOk = false;

        try {
          const fullCreds = await getUserOandaCredentials(cred.userId);
          if (fullCreds && fullCreds.apiKey) {
            const oandaCreds: OandaCredentials = {
              apiKey: fullCreds.apiKey,
              accountId: fullCreds.accountId,
              isLive: fullCreds.environment === "live"
            };
            const ok = await oandaTestConnection(oandaCreds);
            if (ok) {
              connectionOk = true;
              const account = await oandaGetAccountSummary(oandaCreds);
              const trades = await oandaGetOpenTrades(oandaCreds);
              openTradeCount = trades.length;
              accountInfo = {
                balance: account.balance,
                currency: account.currency,
                unrealizedPL: account.unrealizedPL,
                nav: account.NAV || account.balance,
              };
            }
          }
        } catch {
          connectionOk = false;
        }

        return {
          id: cred.userId.slice(0, 8),
          displayName,
          isLive: cred.environment === "live",
          connectionOk,
          openTradeCount,
          account: accountInfo,
          riskPercent: settings.defaultRiskPercent || 1,
          guardianEnabled: settings.guardianEnabled,
          autoExecuteEnabled: settings.autoExecuteEnabled,
        };
      }))).filter(Boolean);

      res.json({ users });
    } catch (error) {
      console.error("[OANDA] Users health error:", error);
      res.status(500).json({ error: "Failed to fetch users health" });
    }
  });

  // Get OANDA balance history for current user
  app.get("/api/oanda/balance-history", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds || !dbCreds.isConnected) {
        return res.json({ points: [], currency: "GBP", startBalance: 0, currentBalance: 0, returnPercent: 0, maxDrawdown: 0 });
      }

      let apiKey = dbCreds.apiKey;
      if (isEncrypted(apiKey)) {
        try { apiKey = decryptApiKey(apiKey); } catch {
          return res.json({ points: [], currency: "GBP", startBalance: 0, currentBalance: 0, returnPercent: 0, maxDrawdown: 0 });
        }
      }

      const creds: OandaCredentials = {
        apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live"
      };

      const rawDays = parseInt(req.query.days as string) || 30;
      const days = Math.max(1, Math.min(rawDays, 90));
      const now = new Date();
      const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      const chunkDays = 7;
      let currentStart = new Date(startDate);
      const allPoints: { date: string; balance: number }[] = [];

      while (currentStart < now) {
        const chunkEnd = new Date(Math.min(currentStart.getTime() + chunkDays * 24 * 60 * 60 * 1000, now.getTime()));
        const transactions = await oandaGetTransactionsByDateRange(
          creds,
          currentStart.toISOString(),
          chunkEnd.toISOString()
        );

        const balanceChanges = transactions.filter(t =>
          t.accountBalance && (t.type === "ORDER_FILL" || t.type === "DAILY_FINANCING" || t.type === "TRANSFER_FUNDS")
        );

        for (const tx of balanceChanges) {
          const bal = parseFloat(tx.accountBalance!);
          if (!isNaN(bal)) {
            allPoints.push({ date: tx.time, balance: bal });
          }
        }

        currentStart = chunkEnd;
      }

      let account: any = {};
      try {
        account = await oandaGetAccountSummary(creds);
      } catch {}
      const currentBal = parseFloat(account.balance || "0");
      const currentEq = parseFloat(account.NAV || account.balance || "0");
      const unrealizedPL = parseFloat(account.unrealizedPL || "0");
      const currency = account.currency || "GBP";

      if (currentBal > 0) {
        allPoints.push({ date: now.toISOString(), balance: currentBal });
      }

      if (allPoints.length === 0) {
        return res.json({ points: [], currency, startBalance: 0, currentBalance: 0, returnPercent: 0, maxDrawdown: 0 });
      }

      allPoints.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const seen = new Set<string>();
      const dedupedPoints: typeof allPoints = [];
      for (const p of allPoints) {
        const key = `${p.date}-${p.balance}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedPoints.push(p);
        }
      }

      const startBalance = dedupedPoints[0].balance;
      const lastBalance = dedupedPoints[dedupedPoints.length - 1].balance;
      const finalEquity = currentEq > 0 ? currentEq : lastBalance;
      const returnPercent = startBalance > 0 ? Math.round(((finalEquity - startBalance) / startBalance) * 10000) / 100 : 0;

      let peak = startBalance;
      let maxDrawdown = 0;
      const points = dedupedPoints.map((p, i) => {
        const eq = (i === dedupedPoints.length - 1 && currentEq > 0) ? currentEq : p.balance;
        if (eq > peak) peak = eq;
        const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
        return {
          date: p.date,
          balance: Math.round(p.balance * 100) / 100,
          equity: Math.round(eq * 100) / 100,
          unrealizedPL: (i === dedupedPoints.length - 1) ? Math.round(unrealizedPL * 100) / 100 : 0,
          openTrades: 0,
        };
      });

      res.json({
        points,
        currency,
        startBalance: Math.round(startBalance * 100) / 100,
        currentBalance: Math.round(finalEquity * 100) / 100,
        returnPercent,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      });
    } catch (error) {
      console.error("[OANDA] Balance history error:", error);
      res.status(500).json({ error: "Failed to fetch balance history" });
    }
  });

  const backfillBodySchema = z.object({
    days: z.number().int().min(1).max(90).optional().default(90),
  });

  app.post("/api/oanda/backfill-history", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const parsed = backfillBodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const cooldownMs = 10 * 60 * 1000;
      const lastSnapshot = await db.select({ snapshotAt: oandaBalanceSnapshots.snapshotAt })
        .from(oandaBalanceSnapshots)
        .where(eq(oandaBalanceSnapshots.userId, userId))
        .orderBy(sql`${oandaBalanceSnapshots.snapshotAt} DESC`)
        .limit(1);
      if (lastSnapshot.length > 0) {
        const lastInsertTime = new Date(lastSnapshot[0].snapshotAt).getTime();
        if (Date.now() - lastInsertTime < cooldownMs) {
          const waitMin = Math.ceil((cooldownMs - (Date.now() - lastInsertTime)) / 60000);
          return res.status(429).json({ error: `Please wait ${waitMin} minute(s) before importing again` });
        }
      }

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds || !dbCreds.isConnected) {
        return res.status(400).json({ error: "No OANDA account connected" });
      }

      const creds: OandaCredentials = {
        apiKey: dbCreds.apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live"
      };

      const existingCount = await db.select({ count: sql<number>`count(*)` })
        .from(oandaBalanceSnapshots)
        .where(eq(oandaBalanceSnapshots.userId, userId));
      const alreadyHas = Number(existingCount[0]?.count || 0);

      const now = new Date();
      const daysBack = parsed.data.days;
      const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

      const chunkDays = 7;
      let inserted = 0;
      let skipped = 0;
      let currentStart = new Date(startDate);

      while (currentStart < now) {
        const chunkEnd = new Date(Math.min(currentStart.getTime() + chunkDays * 24 * 60 * 60 * 1000, now.getTime()));
        const transactions = await oandaGetTransactionsByDateRange(
          creds,
          currentStart.toISOString(),
          chunkEnd.toISOString()
        );

        const balanceChanges = transactions.filter(t =>
          t.accountBalance && (t.type === "ORDER_FILL" || t.type === "DAILY_FINANCING" || t.type === "TRANSFER_FUNDS")
        );

        for (const tx of balanceChanges) {
          const bal = parseFloat(tx.accountBalance!);
          if (isNaN(bal)) continue;

          const result = await db.insert(oandaBalanceSnapshots).values({
            id: randomUUID(),
            userId,
            balance: bal,
            equity: bal,
            unrealizedPL: 0,
            openTradeCount: 0,
            currency: "GBP",
            environment: dbCreds.environment,
            snapshotAt: tx.time,
          }).onConflictDoNothing();
          if (result.rowCount && result.rowCount > 0) {
            inserted++;
          } else {
            skipped++;
          }
        }

        currentStart = chunkEnd;
        await new Promise(r => setTimeout(r, 200));
      }

      const account = await oandaGetAccountSummary(creds);
      const currentBal = parseFloat(account.balance);
      const currentEq = parseFloat(account.NAV || account.balance);
      if (!isNaN(currentBal)) {
        const nowIso = new Date().toISOString();
        const result = await db.insert(oandaBalanceSnapshots).values({
          id: randomUUID(),
          userId,
          balance: currentBal,
          equity: isNaN(currentEq) ? currentBal : currentEq,
          unrealizedPL: parseFloat(account.unrealizedPL || "0") || 0,
          openTradeCount: 0,
          currency: account.currency || "GBP",
          environment: dbCreds.environment,
          snapshotAt: nowIso,
        }).onConflictDoNothing();
        if (result.rowCount && result.rowCount > 0) inserted++;
      }

      console.log(`[Backfill] ${inserted} inserted, ${skipped} skipped for ${userId.slice(0, 8)}... (had ${alreadyHas} before)`);
      res.json({ success: true, inserted, skipped, totalBefore: alreadyHas });
    } catch (error: any) {
      console.error("[OANDA] Backfill error:", error);
      res.status(500).json({ error: "Failed to backfill history" });
    }
  });

  // Get OANDA open trades (uses user's credentials - STATELESS)
  app.get("/api/oanda/trades", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds || !dbCreds.isConnected) {
        return res.status(400).json({ error: "OANDA not connected" });
      }

      const creds: OandaCredentials = {
        apiKey: dbCreds.apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live"
      };
      
      const trades = await oandaGetOpenTrades(creds);
      res.json({ trades });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trades" });
    }
  });

  // Get real-time prices from OANDA for all instruments
  // Uses SYSTEM credentials (from env vars) only - not user credentials
  // This provides price data for all users without cross-contamination
  app.get("/api/oanda/prices", async (req, res) => {
    try {
      // Only use system-configured OANDA (from env vars at startup)
      // Never configure singleton with user credentials here
      if (!oandaService.isConfigured()) {
        return res.json({ connected: false, prices: {} });
      }
      
      const prices = await oandaService.getAllPrices([...instruments]);
      res.json({ 
        connected: true, 
        prices,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("[OANDA] Prices error:", error);
      res.json({ connected: false, prices: {} });
    }
  });

  // Execute signal on OANDA (uses user's credentials - STATELESS with proper risk sizing)
  app.post("/api/oanda/execute", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds || !dbCreds.isConnected) {
        return res.status(400).json({ error: "OANDA not connected. Go to Settings to connect your account." });
      }

      const creds: OandaCredentials = {
        apiKey: dbCreds.apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live"
      };
      
      if (isUserPausedByGuardian(userId)) {
        return res.status(403).json({ error: "Daily loss limit reached. New trades paused until losses recover." });
      }

      const { instrument, direction, entryPrice, signalId, confidence, timeframe, entryLow, entryHigh } = req.body;
      let { stopLoss, takeProfit } = req.body;
      
      if (!instrument || !direction || !stopLoss || !takeProfit) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Entry zone validation - block if price drifted outside entry zone
      if (entryLow != null && entryHigh != null) {
        try {
          const priceData = await oandaGetCurrentPrice(creds, instrument);
          if (priceData) {
            const livePrice = priceData.price;
            const zoneMid = (entryLow + entryHigh) / 2;
            const zoneRange = Math.abs(entryHigh - entryLow);
            const buffer = zoneRange * 2;
            const zoneLowWithBuffer = Math.min(entryLow, entryHigh) - buffer;
            const zoneHighWithBuffer = Math.max(entryLow, entryHigh) + buffer;
            
            if (livePrice < zoneLowWithBuffer || livePrice > zoneHighWithBuffer) {
              const pipSize = PIP_VALUES[instrument] || 0.0001;
              const driftPips = Math.round(Math.abs(livePrice - zoneMid) / pipSize);
              return res.status(400).json({ 
                success: false,
                error: `Price has moved outside the entry zone. Current: ${livePrice.toFixed(instrument.includes('JPY') ? 3 : 5)}, Entry zone: ${entryLow.toFixed(instrument.includes('JPY') ? 3 : 5)} - ${entryHigh.toFixed(instrument.includes('JPY') ? 3 : 5)} (${driftPips} pips drift). Look for a fresh signal instead.`,
                reason: "entry_zone_drift"
              });
            }
          }
        } catch (e) {
          console.log(`[OANDA] Entry zone check failed for ${instrument}, proceeding with trade:`, e);
        }
      }
      
      // Get account balance for risk-based sizing
      const account = await oandaGetAccountSummary(creds);
      const accountBalance = parseFloat(account.balance);
      const userPaperAcct = await storage.getPaperAccount(userId);
      const riskPercent = userPaperAcct.riskPercent ?? 1;
      
      // Calculate risk-based position size using the same function as paper trading
      const currentPrice = entryPrice || stopLoss;
      const slDistance = Math.abs(currentPrice - stopLoss);
      const oandaPipSize = PIP_VALUES[instrument] || 0.0001;
      const slPips = slDistance / oandaPipSize;
      
      const oandaLotInfo = calculateLotSize(
        accountBalance,
        riskPercent,
        slPips,
        instrument,
        account.currency || "USD",
        currentPrice
      );
      
      if (oandaLotInfo.skipped) {
        return res.status(400).json({ 
          error: `Trade risk too high: ${oandaLotInfo.skipReason}`,
          riskInfo: {
            actualRiskPercent: oandaLotInfo.actualRiskPercent,
            actualRiskAmount: oandaLotInfo.actualRiskAmount,
            riskBudget: oandaLotInfo.riskAmount,
            minAccountFor1Pct: oandaLotInfo.minAccountFor1Pct,
            currency: account.currency || "USD",
          }
        });
      }
      
      const unitsPerLot = CONTRACT_SIZES[instrument] || 100000;
      
      const manualMinSl = enforceMinimumSlDistance(instrument, currentPrice, stopLoss, takeProfit, direction);
      let effectiveSlPips = slPips;
      if (manualMinSl.widened) {
        stopLoss = manualMinSl.stopLoss;
        takeProfit = manualMinSl.takeProfit;
        const widenedSlDist = Math.abs(currentPrice - stopLoss);
        effectiveSlPips = widenedSlDist / oandaPipSize;
        const widenedLotInfo = calculateLotSize(accountBalance, riskPercent, effectiveSlPips, instrument, account.currency || "USD", currentPrice);
        if (widenedLotInfo.skipped) {
          return res.status(400).json({ error: `Trade risk too high after SL widening: ${widenedLotInfo.skipReason}` });
        }
        oandaLotInfo.units = widenedLotInfo.units;
        oandaLotInfo.lotSize = widenedLotInfo.lotSize;
      }
      
      let rawUnits = oandaLotInfo.units;
      
      const userSettingsForBoost = await getUserSettings(userId);
      const boostThreshold = userSettingsForBoost.confidenceBoostThreshold as number | null;
      const boostMultiplier = userSettingsForBoost.confidenceBoostMultiplier as number | null;
      if (boostThreshold && boostMultiplier && confidence && confidence >= boostThreshold) {
        const boostedUnits = Math.round(rawUnits * boostMultiplier);
        const maxBoostedUnits = rawUnits * 3;
        rawUnits = Math.min(boostedUnits, maxBoostedUnits);
        console.log(`[OANDA] Confidence boost for user ${userId.slice(0,8)}: ${confidence}% >= ${boostThreshold}% -> ${boostMultiplier}x units`);
      }
      
      rawUnits = Math.min(rawUnits, unitsPerLot * 1);
      
      const units = direction === "buy" ? rawUnits : -rawUnits;
      const lotSize = Math.round((Math.abs(units) / unitsPerLot) * 1000) / 1000;
      
      console.log(`[OANDA] User ${userId}: Executing ${direction} ${instrument}, ${lotSize} lots (${units} units), SL: ${stopLoss}, TP: ${takeProfit}`);
      
      const result = await oandaPlaceMarketOrder(creds, instrument, units, stopLoss, takeProfit);
      
      if (result.success) {
        const matchingTrades = await db.select().from(simulatedTradesTable)
          .where(and(
            eq(simulatedTradesTable.userId, userId),
            eq(simulatedTradesTable.instrument, instrument),
            eq(simulatedTradesTable.direction, direction),
            eq(simulatedTradesTable.status, "open"),
            isNull(simulatedTradesTable.oandaTradeId)
          ))
          .orderBy(desc(simulatedTradesTable.openedAt))
          .limit(1);
        
        if (matchingTrades.length > 0 && result.tradeId) {
          await storage.updateSimulatedTrade(matchingTrades[0].id, { oandaTradeId: result.tradeId });
          console.log(`[OANDA] Linked OANDA trade ${result.tradeId} to simulated trade ${matchingTrades[0].id} for trailing stop sync`);
        }
        
        const journalEntry: InsertTradeJournal = {
          userId,
          instrument,
          direction,
          entryPrice: entryPrice || 0,
          stopLoss,
          takeProfit: takeProfit,
          lotSize,
          status: "open",
          notes: `Placed via OANDA. Trade ID: ${result.tradeId}`,
          timeframe: timeframe || "1h",
          entryTime: new Date().toISOString(),
          signalConfidence: confidence,
        };
        
        await db.insert(tradeJournalTable).values(journalEntry);
        
        // Log audit action
        await logUserAction(userId, "trade_execute", {
          instrument,
          direction,
          tradeId: result.tradeId,
          lotSize,
          stopLoss,
          takeProfit
        }, req);
        
        const manualTpDist = Math.abs(takeProfit - currentPrice) / oandaPipSize;
        const manualPotentialProfit = calculateMoneyPnL(manualTpDist, lotSize, instrument, account.currency || "GBP", currentPrice);
        const manualPotentialLoss = calculateMoneyPnL(slPips, lotSize, instrument, account.currency || "GBP", currentPrice);
        const manualCurrSym = (account.currency || "GBP") === "USD" ? "$" : (account.currency || "GBP") === "EUR" ? "€" : "£";
        const manualProfitStr = isFinite(manualPotentialProfit) ? `${manualCurrSym}${Math.abs(manualPotentialProfit).toFixed(2)}` : "calculating";
        const manualLossStr = isFinite(manualPotentialLoss) ? `${manualCurrSym}${Math.abs(manualPotentialLoss).toFixed(2)}` : "calculating";
        
        pushNotificationService.sendTradeNotification(
          userId, instrument, direction, 'executed', undefined,
          `${timeframe || "1h"} ${direction.toUpperCase()} @ ${currentPrice.toFixed(instrument.includes("XA") ? 2 : 5)} | Profit: ${manualProfitStr} | Risk: ${manualLossStr}`
        ).catch(() => {});
        
        const response: Record<string, any> = { success: true, tradeId: result.tradeId, lotSize };
        if (oandaLotInfo.elevatedRisk) {
          response.riskWarning = {
            elevatedRisk: true,
            actualRiskPercent: Math.round((oandaLotInfo.actualRiskPercent || 0) * 10) / 10,
            actualRiskAmount: Math.round((oandaLotInfo.actualRiskAmount || 0) * 100) / 100,
            normalRiskPercent: riskPercent,
            normalRiskAmount: Math.round(oandaLotInfo.riskAmount * 100) / 100,
            minAccountFor1Pct: oandaLotInfo.minAccountFor1Pct,
            currency: account.currency || "USD",
            reason: `Your broker's minimum trade size for ${instrument} requires more risk than your ${riskPercent}% setting allows on this account size.`,
          };
        }
        res.json(response);
      } else {
        await logUserAction(userId, "trade_execute_failed", { instrument, direction, error: result.error }, req);
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      console.error("[OANDA] Execute error:", error);
      res.status(500).json({ error: "Trade execution failed" });
    }
  });

  app.post("/api/oanda/risk-check", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Please sign in" });

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds?.isConnected) {
        return res.json({ available: false, reason: "OANDA not connected" });
      }

      const creds: OandaCredentials = {
        apiKey: dbCreds.apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live",
      };

      const { instrument, stopLoss, entryPrice } = req.body;
      if (!instrument || !stopLoss) {
        return res.status(400).json({ error: "Missing instrument or stopLoss" });
      }

      const account = await oandaGetAccountSummary(creds);
      const accountBalance = parseFloat(account.balance);
      const userPaperAcct = await storage.getPaperAccount(userId);
      const riskPercent = userPaperAcct.riskPercent ?? 1;

      const currentPrice = entryPrice || stopLoss;
      const slDistance = Math.abs(currentPrice - stopLoss);
      const pipSize = PIP_VALUES[instrument] || 0.0001;
      const slPips = slDistance / pipSize;

      const lotInfo = calculateLotSize(accountBalance, riskPercent, slPips, instrument, account.currency || "USD", currentPrice);

      const rrRatio = 2;
      const potentialReward = lotInfo.lotSize > 0 ? Math.round((lotInfo.actualRiskAmount || lotInfo.riskAmount) * rrRatio * 100) / 100 : 0;

      res.json({
        available: !lotInfo.skipped,
        accountBalance: Math.round(accountBalance * 100) / 100,
        currency: account.currency || "USD",
        riskPercent,
        normalRiskAmount: Math.round(lotInfo.riskAmount * 100) / 100,
        lotSize: lotInfo.lotSize,
        units: lotInfo.units,
        elevatedRisk: lotInfo.elevatedRisk || false,
        actualRiskPercent: lotInfo.actualRiskPercent ? Math.round(lotInfo.actualRiskPercent * 10) / 10 : riskPercent,
        actualRiskAmount: lotInfo.actualRiskAmount ? Math.round(lotInfo.actualRiskAmount * 100) / 100 : Math.round(lotInfo.riskAmount * 100) / 100,
        potentialReward,
        minAccountFor1Pct: lotInfo.minAccountFor1Pct,
        skipped: lotInfo.skipped || false,
        skipReason: lotInfo.skipReason,
      });
    } catch (error) {
      console.error("[OANDA] Risk check error:", error);
      res.status(500).json({ error: "Risk check failed" });
    }
  });

  // Close OANDA trade (uses user's credentials - STATELESS)
  app.post("/api/oanda/close/:tradeId", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds || !dbCreds.isConnected) {
        return res.status(400).json({ error: "OANDA not connected" });
      }

      const creds: OandaCredentials = {
        apiKey: dbCreds.apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live"
      };
      
      const { tradeId } = req.params;
      const result = await oandaCloseTrade(creds, tradeId);
      
      await logUserAction(userId, "trade_close", { tradeId, result }, req);
      await logOandaActivity(userId, "manual_close", {
        tradeId,
        details: `Manually closed by user. Result: ${result.success ? "success" : result.error}`,
        source: "user",
      });
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to close trade" });
    }
  });

  // Disconnect OANDA (clears user's saved credentials in database)
  app.post("/api/oanda/disconnect", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Please sign in" });
      }

      await disconnectUserOanda(userId);
      await logUserAction(userId, "oanda_disconnect", {}, req);
      res.json({ success: true, message: "Disconnected from OANDA" });
    } catch (error) {
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  // ======== AUTO-OPTIMIZER API ENDPOINTS ========

  app.get("/api/auto-optimizer/status", async (_req, res) => {
    try {
      const status = await autoOptimizer.getStatus();
      res.json(status);
    } catch (error) {
      console.error("[AutoOptimizer] Error getting status:", error);
      res.status(500).json({ error: "Failed to get optimizer status" });
    }
  });

  app.get("/api/auto-optimizer/profiles", async (_req, res) => {
    try {
      const profiles = await autoOptimizer.getProfiles();
      res.json({ profiles });
    } catch (error) {
      console.error("[AutoOptimizer] Error getting profiles:", error);
      res.status(500).json({ error: "Failed to get profiles" });
    }
  });

  app.get("/api/auto-optimizer/history", async (_req, res) => {
    try {
      const history = await autoOptimizer.getHistory(100);
      res.json({ history });
    } catch (error) {
      console.error("[AutoOptimizer] Error getting history:", error);
      res.status(500).json({ error: "Failed to get optimization history" });
    }
  });

  app.get("/api/auto-optimizer/stats", async (_req, res) => {
    try {
      const stats = await autoOptimizer.getOverallStatsAsync();
      res.json(stats);
    } catch (error) {
      console.error("[AutoOptimizer] Error getting stats:", error);
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  app.post("/api/auto-optimizer/run", async (_req, res) => {
    try {
      res.json({ message: "Optimization started", status: "running" });
      autoOptimizer.runFullOptimization("manual").catch(console.error);
    } catch (error) {
      console.error("[AutoOptimizer] Error triggering optimization:", error);
      res.status(500).json({ error: "Failed to start optimization" });
    }
  });

  app.post("/api/auto-optimizer/fetch-data", async (_req, res) => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const cachePath = path.join(process.cwd(), 'historical-data-cache.json');
      let cacheData: Record<string, any> = {};
      if (fs.existsSync(cachePath)) {
        cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      }

      const allTimeframes = ['1m', '5m', '15m', '1h', '4h', '1D'];

      const missing: { instrument: string; timeframe: string }[] = [];
      for (const inst of instruments) {
        for (const tf of allTimeframes) {
          const key = `${inst}-${tf}`;
          if (!cacheData[key] || !cacheData[key].candles || cacheData[key].candles.length < 500) {
            missing.push({ instrument: inst, timeframe: tf });
          }
        }
      }

      if (missing.length === 0) {
        return res.json({ message: "All historical data already cached", fetched: 0, total: Object.keys(cacheData).length });
      }

      const oandaInstruments = missing;
      const twelveDataInstruments: typeof missing = [];

      res.json({ 
        message: `Fetching ${missing.length} missing datasets in background via OANDA.`,
        missing: missing.map(m => `${m.instrument}-${m.timeframe}`),
      });

      let fetched = 0;
      let errors = 0;

      const oandaApiKey = process.env.OANDA_API_KEY;
      const oandaAccountId = process.env.OANDA_ACCOUNT_ID;
      const oandaSymbolMapping: Record<string, string> = {
        'XAUUSD': 'XAU_USD', 'XAGUSD': 'XAG_USD',
        'EURUSD': 'EUR_USD', 'GBPUSD': 'GBP_USD',
        'USDCHF': 'USD_CHF', 'AUDUSD': 'AUD_USD', 'NZDUSD': 'NZD_USD',
        'USDJPY': 'USD_JPY', 'USDCAD': 'USD_CAD', 'EURGBP': 'EUR_GBP',
        'EURJPY': 'EUR_JPY', 'GBPJPY': 'GBP_JPY',
      };
      const oandaGranularityMapping: Record<string, string> = {
        '1m': 'M1', '5m': 'M5', '15m': 'M15',
        '1h': 'H1', '4h': 'H4', '1D': 'D',
      };

      if (oandaInstruments.length > 0 && oandaApiKey) {
        const baseUrl = 'https://api-fxpractice.oanda.com';
        for (let i = 0; i < oandaInstruments.length; i++) {
          const { instrument, timeframe } = oandaInstruments[i];
          const oandaSymbol = oandaSymbolMapping[instrument] || instrument;
          const granularity = oandaGranularityMapping[timeframe] || 'H1';
          const url = `${baseUrl}/v3/instruments/${oandaSymbol}/candles?count=5000&granularity=${granularity}&price=M`;

          try {
            console.log(`[DataFetch/OANDA] Fetching ${instrument}/${timeframe} (${i+1}/${oandaInstruments.length})...`);
            const resp = await fetch(url, {
              headers: {
                'Authorization': `Bearer ${oandaApiKey}`,
                'Content-Type': 'application/json',
              },
            });
            const data = await resp.json();

            if (!data.candles || !Array.isArray(data.candles)) {
              console.error(`[DataFetch/OANDA] No candle data for ${instrument}/${timeframe}:`, data.errorMessage || 'unknown');
              errors++;
              continue;
            }

            const candles = data.candles
              .filter((c: any) => c.complete)
              .map((c: any) => ({
                timestamp: c.time,
                open: parseFloat(c.mid.o),
                high: parseFloat(c.mid.h),
                low: parseFloat(c.mid.l),
                close: parseFloat(c.mid.c),
                volume: c.volume || 0,
              }));

            const key = `${instrument}-${timeframe}`;
            cacheData[key] = { instrument, timeframe, candles, candleCount: candles.length };
            fetched++;
            console.log(`[DataFetch/OANDA] Cached ${key}: ${candles.length} candles`);

            fs.writeFileSync(cachePath, JSON.stringify(cacheData));
          } catch (err) {
            console.error(`[DataFetch/OANDA] Failed ${instrument}/${timeframe}:`, err);
            errors++;
          }
        }
      }

      const twelveDataApiKey = process.env.TWELVE_DATA_API_KEY;
      if (twelveDataInstruments.length > 0 && twelveDataApiKey) {
        const symbolMapping: Record<string, string> = {
          'XAUUSD': 'XAU/USD', 'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD',
          'USDCHF': 'USD/CHF', 'AUDUSD': 'AUD/USD', 'NZDUSD': 'NZD/USD',
        };
        const intervalMapping: Record<string, string> = {
          '1m': '1min', '5m': '5min', '15m': '15min',
          '1h': '1h', '4h': '4h', '1D': '1day',
        };

        console.log(`[DataFetch] Waiting 60s for Twelve Data rate limit to reset...`);
        await new Promise(r => setTimeout(r, 60000));

        for (let i = 0; i < twelveDataInstruments.length; i++) {
          const { instrument, timeframe } = twelveDataInstruments[i];

          if (i > 0 && i % 7 === 0) {
            console.log(`[DataFetch] Rate limit pause: waiting 65s...`);
            await new Promise(r => setTimeout(r, 65000));
          }

          const symbol = symbolMapping[instrument] || instrument;
          const interval = intervalMapping[timeframe] || '1h';
          const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=5000&apikey=${twelveDataApiKey}`;

          try {
            console.log(`[DataFetch/12Data] Fetching ${instrument}/${timeframe} (${i+1}/${twelveDataInstruments.length})...`);
            const resp = await fetch(url);
            const data = await resp.json();

            if (data.status === 'error' || !data.values || !Array.isArray(data.values)) {
              console.error(`[DataFetch/12Data] Error for ${instrument}/${timeframe}: ${data.message || 'no data'}`);
              errors++;
              continue;
            }

            const candles = data.values.map((v: any) => ({
              timestamp: v.datetime,
              open: parseFloat(v.open),
              high: parseFloat(v.high),
              low: parseFloat(v.low),
              close: parseFloat(v.close),
              volume: v.volume ? parseFloat(v.volume) : 0,
            })).reverse();

            const key = `${instrument}-${timeframe}`;
            cacheData[key] = { instrument, timeframe, candles, candleCount: candles.length };
            fetched++;
            console.log(`[DataFetch/12Data] Cached ${key}: ${candles.length} candles`);

            fs.writeFileSync(cachePath, JSON.stringify(cacheData));
          } catch (err) {
            console.error(`[DataFetch/12Data] Failed ${instrument}/${timeframe}:`, err);
            errors++;
          }
        }
      }

      console.log(`[DataFetch] Complete: ${fetched} fetched, ${errors} errors`);

      autoOptimizer.reloadHistoricalData();
      console.log(`[DataFetch] Optimizer reloaded with ${autoOptimizer.getDatasetKeys().length} datasets`);
    } catch (error) {
      console.error("[DataFetch] Error:", error);
    }
  });

  // ======== STRATEGY LAB API ENDPOINTS (legacy) ========
  
  // Get available historical data for optimization
  app.get("/api/strategy-lab/available-data", async (_req, res) => {
    try {
      const availableData = strategyOptimizer.getAvailableData();
      res.json({ data: availableData });
    } catch (error) {
      console.error("[StrategyLab] Error fetching available data:", error);
      res.status(500).json({ error: "Failed to fetch available data" });
    }
  });

  // Get default parameters for a timeframe
  app.get("/api/strategy-lab/default-params/:timeframe", async (req, res) => {
    try {
      const { timeframe } = req.params;
      const params = strategyOptimizer.getDefaultParameters(timeframe as Timeframe);
      res.json({ params });
    } catch (error) {
      console.error("[StrategyLab] Error fetching default params:", error);
      res.status(500).json({ error: "Failed to fetch parameters" });
    }
  });

  // Run optimization for a timeframe
  const optimizeRequestSchema = z.object({
    timeframe: z.enum(timeframes),
    instrument: z.enum(instruments).optional(),
  });
  
  app.post("/api/strategy-lab/optimize", async (req, res) => {
    try {
      const validated = optimizeRequestSchema.safeParse(req.body);
      if (!validated.success) {
        return res.status(400).json({ error: validated.error.errors[0].message });
      }
      
      const { timeframe, instrument } = validated.data;

      // Start optimization (this can take a while)
      const result = await strategyOptimizer.runOptimization(timeframe, instrument);
      
      res.json({ result });
    } catch (error) {
      console.error("[StrategyLab] Error running optimization:", error);
      res.status(500).json({ error: "Optimization failed" });
    }
  });

  // Get optimization progress
  app.get("/api/strategy-lab/progress/:runId", async (req, res) => {
    try {
      const { runId } = req.params;
      const progress = strategyOptimizer.getOptimizationProgress(runId);
      
      if (!progress) {
        return res.status(404).json({ error: "Optimization run not found" });
      }
      
      res.json({ progress });
    } catch (error) {
      console.error("[StrategyLab] Error fetching progress:", error);
      res.status(500).json({ error: "Failed to fetch progress" });
    }
  });

  // Get saved strategy profiles
  app.get("/api/strategy-lab/profiles", async (_req, res) => {
    try {
      const profiles = await db.select().from(timeframeStrategyProfiles);
      res.json({ profiles });
    } catch (error) {
      console.error("[StrategyLab] Error fetching profiles:", error);
      res.status(500).json({ error: "Failed to fetch profiles" });
    }
  });

  // Save/update strategy profile for a timeframe
  const saveProfileSchema = z.object({
    timeframe: z.enum(timeframes),
    params: z.object({
      minTrendStrength: z.number().min(40).max(90),
      minConfluence: z.number().min(1).max(5),
      slMultiplier: z.number().min(0.5).max(3.0),
      rrRatio: z.number().min(1.0).max(4.0),
      maxVolatility: z.enum(["low", "medium", "high"]),
      requireMTFConfluence: z.boolean(),
      minConfidence: z.number().min(50).max(95),
    }),
    winRate: z.number().optional(),
    profitFactor: z.number().optional(),
    backtests: z.number().optional(),
  });
  
  app.post("/api/strategy-lab/profiles", async (req, res) => {
    try {
      const validated = saveProfileSchema.safeParse(req.body);
      if (!validated.success) {
        return res.status(400).json({ error: validated.error.errors[0].message });
      }
      
      const { timeframe, params, winRate, profitFactor, backtests } = validated.data;

      // Check if profile exists
      const existing = await db.select()
        .from(timeframeStrategyProfiles)
        .where(eq(timeframeStrategyProfiles.timeframe, timeframe));

      if (existing.length > 0) {
        // Update existing
        await db.update(timeframeStrategyProfiles)
          .set({
            minTrendStrength: params.minTrendStrength,
            minConfluence: params.minConfluence,
            slMultiplier: params.slMultiplier,
            rrRatio: params.rrRatio,
            maxVolatility: params.maxVolatility,
            requireMTFConfluence: params.requireMTFConfluence,
            minConfidence: params.minConfidence,
            optimizedWinRate: winRate || null,
            optimizedProfitFactor: profitFactor || null,
            totalBacktests: backtests || 0,
            lastOptimizedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(timeframeStrategyProfiles.timeframe, timeframe));
      } else {
        // Create new
        await db.insert(timeframeStrategyProfiles).values({
          timeframe,
          minTrendStrength: params.minTrendStrength,
          minConfluence: params.minConfluence,
          slMultiplier: params.slMultiplier,
          rrRatio: params.rrRatio,
          maxVolatility: params.maxVolatility,
          requireMTFConfluence: params.requireMTFConfluence,
          minConfidence: params.minConfidence,
          optimizedWinRate: winRate || null,
          optimizedProfitFactor: profitFactor || null,
          totalBacktests: backtests || 0,
          lastOptimizedAt: new Date().toISOString(),
          isActive: false,
        });
      }

      const profiles = await db.select().from(timeframeStrategyProfiles);
      res.json({ success: true, profiles });
    } catch (error) {
      console.error("[StrategyLab] Error saving profile:", error);
      res.status(500).json({ error: "Failed to save profile" });
    }
  });

  // Toggle profile active status
  const toggleProfileSchema = z.object({
    isActive: z.boolean(),
  });
  
  app.post("/api/strategy-lab/profiles/:timeframe/toggle", async (req, res) => {
    try {
      const { timeframe } = req.params;
      const validated = toggleProfileSchema.safeParse(req.body);
      if (!validated.success) {
        return res.status(400).json({ error: validated.error.errors[0].message });
      }
      const { isActive } = validated.data;

      await db.update(timeframeStrategyProfiles)
        .set({ 
          isActive: isActive,
          updatedAt: new Date().toISOString()
        })
        .where(eq(timeframeStrategyProfiles.timeframe, timeframe));

      // Sync the in-memory strategy cache with the database
      const profiles = await db.select().from(timeframeStrategyProfiles);
      
      // Update the analysis engine with active profiles
      for (const profile of profiles) {
        if (profile.isActive) {
          updateActiveStrategyProfile(profile.timeframe, {
            minTrendStrength: profile.minTrendStrength,
            minConfluence: profile.minConfluence,
            slMultiplier: profile.slMultiplier,
            rrRatio: profile.rrRatio,
            maxVolatility: profile.maxVolatility,
            requireMTFConfluence: profile.requireMTFConfluence,
            minConfidence: profile.minConfidence,
          });
        } else {
          updateActiveStrategyProfile(profile.timeframe, null);
        }
      }
      
      res.json({ success: true, profiles });
    } catch (error) {
      console.error("[StrategyLab] Error toggling profile:", error);
      res.status(500).json({ error: "Failed to toggle profile" });
    }
  });

  // Auto-execute signals - DISABLED for multi-user mode
  // In multi-user mode, each user must manually execute or have their own auto-trade settings
  // This endpoint is only for system-level auto-trading with env-var credentials
  app.post("/api/oanda/auto-execute", async (req, res) => {
    try {
      if (!oandaService.isConfigured()) {
        return res.json({ executed: false, reason: "System OANDA not configured" });
      }
      
      if (!storage.isSimulationEnabled()) {
        return res.json({ executed: false, reason: "Auto-trade disabled" });
      }
      
      const { signal } = req.body;
      
      if (!signal || signal.confidence < 70) {
        return res.json({ executed: false, reason: "Signal does not meet confidence threshold" });
      }
      
      const trades = await oandaService.getOpenTrades();
      const hasOpenTrade = trades.some(t => 
        t.instrument.replace("_", "").replace("XAU_USD", "XAUUSD") === signal.instrument
      );
      
      if (hasOpenTrade) {
        return res.json({ executed: false, reason: "Already have open trade for this instrument" });
      }
      
      const result = await oandaService.executeSignal({
        instrument: signal.instrument,
        direction: signal.direction,
        entryPrice: signal.entryPrice || (signal.entryZone?.low + signal.entryZone?.high) / 2,
        stopLoss: signal.stopLoss,
        takeProfit1: signal.takeProfit1,
        confidence: signal.confidence,
        signalId: signal.id || randomUUID(),
      });
      
      res.json({ 
        executed: result.success, 
        tradeId: result.tradeId,
        error: result.error 
      });
    } catch (error) {
      console.error("[OANDA] Auto-execute error:", error);
      res.json({ executed: false, reason: "Execution error" });
    }
  });

  // =====================================================
  // MICRO-SCALPER ROUTES - Instant Profit Trapper
  // =====================================================

  app.get("/api/scalper/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const stats = await microScalperManager.getStatsForUser(userId);
      const settings = await microScalperManager.getSettingsForUser(userId);
      const instance = microScalperManager.getInstanceForUser(userId);
      const optimization = instance?.optimizationState || null;
      const activity = instance?.activityFeed?.slice(0, 20) || [];
      const momentum: Record<string, any> = {};
      if (instance?.momentumReadings) {
        const now = Date.now();
        instance.momentumReadings.forEach((reading, pair) => {
          if (now - reading.timestamp < 10000) {
            momentum[pair] = reading;
          }
        });
      }
      const session = getSessionInfo();
      let oandaAccountType: string | null = null;
      try {
        const creds = await getUserOandaCredentials(userId);
        if (creds) {
          oandaAccountType = creds.environment === "live" ? "live" : "demo";
        }
      } catch {}
      const streamAuthError = instance?.streamAuthError || null;
      res.json({ stats, settings, optimization, activity, momentum, session, oandaAccountType, streamAuthError });
    } catch (error) {
      console.error("[Scalper] Status error:", error);
      res.status(500).json({ error: "Failed to get scalper status" });
    }
  });

  app.get("/api/scalper/trades", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const limit = parseInt(req.query.limit as string) || 50;
      const trades = await microScalperManager.getRecentTradesForUser(userId, limit);
      const instance = microScalperManager.getInstanceForUser(userId);
      const openTrades = instance ? instance.getOpenTradesList() : [];
      res.json({ trades, openTrades });
    } catch (error) {
      console.error("[Scalper] Trades error:", error);
      res.status(500).json({ error: "Failed to get scalper trades" });
    }
  });

  app.post("/api/scalper/start", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      if (microScalperManager.isRunningForUser(userId)) {
        return res.status(400).json({ error: "Scalper is already running" });
      }

      const creds = await getUserOandaCredentials(userId);
      if (!creds) {
        return res.status(400).json({ error: "Please connect your OANDA account first" });
      }

      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        const parsed = scalperSettingsSchema.safeParse(req.body);
        if (parsed.success && Object.keys(parsed.data).length > 0) {
          await microScalperManager.updateSettingsForUser(userId, parsed.data);
        }
      }

      const isLive = creds.environment === "live";
      const result = await microScalperManager.startForUser(userId, creds.apiKey, creds.accountId, isLive);
      if (result.success) {
        res.json({ success: true, message: "Micro-scalper started" });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("[Scalper] Start error:", error);
      res.status(500).json({ error: "Failed to start scalper" });
    }
  });

  app.post("/api/scalper/stop", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await microScalperManager.stopForUser(userId);
      res.json({ success: true, message: "Micro-scalper stopped" });
    } catch (error) {
      console.error("[Scalper] Stop error:", error);
      res.status(500).json({ error: "Failed to stop scalper" });
    }
  });

  const scalperSettingsSchema = z.object({
    riskPercent: z.number().min(0.1).max(5).optional(),
    maxTradesPerHour: z.number().int().min(1).max(100).optional(),
    dailyLossLimit: z.number().min(1).max(500).optional(),
    maxSpreadPips: z.number().min(0.5).max(10).optional(),
    momentumThresholdPips: z.number().min(1).max(20).optional(),
    momentumWindowSeconds: z.number().int().min(2).max(600).optional(),
    takeProfitPips: z.number().min(2).max(100).optional(),
    trailingDistancePips: z.number().min(1).max(20).optional(),
    maxTradeSeconds: z.number().int().min(10).max(3600).optional(),
    sessionFilter: z.boolean().optional(),
    tradingPairs: z.array(z.string()).optional(),
    profileType: z.string().optional(),
    oandaEnabled: z.boolean().optional(),
  });

  app.post("/api/scalper/settings", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const parsed = scalperSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid settings", details: parsed.error.issues });
      }
      await microScalperManager.updateSettingsForUser(userId, parsed.data);
      const settings = await microScalperManager.getSettingsForUser(userId);
      res.json({ success: true, settings });
    } catch (error) {
      console.error("[Scalper] Settings error:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  const scalperResetSchema = z.object({
    startingBalance: z.number().min(10).max(100000).optional().default(500),
    currency: z.enum(["GBP", "USD", "EUR"]).optional().default("GBP"),
  });

  app.post("/api/scalper/reset", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const parsed = scalperResetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid reset parameters", details: parsed.error.issues });
      }
      const { startingBalance, currency } = parsed.data;
      await microScalperManager.resetAccountForUser(userId, startingBalance, currency);
      const settings = await microScalperManager.getSettingsForUser(userId);
      res.json({ success: true, settings });
    } catch (error) {
      console.error("[Scalper] Reset error:", error);
      res.status(500).json({ error: "Failed to reset scalper account" });
    }
  });

  app.post("/api/scalper/backtest", async (req, res) => {
    try {
      if (!req.isAuthenticated?.() || !req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const {
        instruments: pairs,
        momentumThresholdPips = 3,
        momentumWindowSeconds = 5,
        takeProfitPips = 5,
        trailingDistancePips = 2,
        maxTradeSeconds = 40,
        maxSpreadPips = 1.5,
        candleCount = 500,
        profileName = "custom",
      } = req.body;

      const testPairs = pairs && Array.isArray(pairs) && pairs.length > 0
        ? pairs
        : ["EURUSD", "GBPUSD", "USDCHF"];

      const results = await backtestScalper(
        testPairs,
        {
          momentumThresholdPips,
          momentumWindowSeconds,
          takeProfitPips,
          trailingDistancePips,
          maxTradeSeconds,
          maxSpreadPips,
        },
        Math.min(candleCount, 5000),
        profileName
      );

      const summary = {
        totalInstruments: results.length,
        totalTrades: results.reduce((s, r) => s + r.totalTrades, 0),
        totalWins: results.reduce((s, r) => s + r.wins, 0),
        totalLosses: results.reduce((s, r) => s + r.losses, 0),
        totalBreakevens: results.reduce((s, r) => s + r.breakevens, 0),
        overallWinRate: 0,
        totalPnlPips: Math.round(results.reduce((s, r) => s + r.totalPnlPips, 0) * 10) / 10,
        overallProfitFactor: 0,
      };

      const totalTrades = summary.totalTrades;
      if (totalTrades > 0) {
        summary.overallWinRate = Math.round((summary.totalWins / totalTrades) * 1000) / 10;
      }

      const grossWin = results.reduce((s, r) => s + r.trades.filter(t => t.pnlPips > 0).reduce((ss, t) => ss + t.pnlPips, 0), 0);
      const grossLoss = Math.abs(results.reduce((s, r) => s + r.trades.filter(t => t.pnlPips < 0).reduce((ss, t) => ss + t.pnlPips, 0), 0));
      summary.overallProfitFactor = grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 999 : 0;

      res.json({ summary, results });
    } catch (error) {
      console.error("[Scalper] Backtest error:", error);
      res.status(500).json({ error: "Backtest failed" });
    }
  });

  app.post("/api/oanda/emergency-close-all", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const dbCreds = await getUserOandaCredentials(userId);
      if (!dbCreds || !dbCreds.isConnected) {
        return res.status(400).json({ error: "OANDA not connected" });
      }

      const creds: OandaCredentials = {
        apiKey: dbCreds.apiKey,
        accountId: dbCreds.accountId,
        isLive: dbCreds.environment === "live"
      };

      const trades = await oandaGetOpenTrades(creds);
      if (!trades || trades.length === 0) {
        return res.json({ closed: 0, message: "No open trades to close" });
      }

      const results: Array<{ tradeId: string; instrument: string; success: boolean; pnl?: number; error?: string }> = [];

      for (const trade of trades) {
        try {
          await oandaCloseTrade(creds, trade.id);
          const pnl = parseFloat(trade.unrealizedPL || "0");
          results.push({ tradeId: trade.id, instrument: trade.instrument, success: true, pnl });
          await logOandaActivity(userId, "emergency_close", {
            tradeId: trade.id,
            instrument: trade.instrument,
            direction: parseFloat(trade.initialUnits || trade.currentUnits) > 0 ? "buy" : "sell",
            pnl,
            units: Math.abs(parseInt(trade.currentUnits || trade.initialUnits || "0")),
            details: "Emergency kill switch - all trades closed",
            source: "user",
          });
        } catch (err) {
          results.push({ tradeId: trade.id, instrument: trade.instrument, success: false, error: (err as Error).message });
        }
      }

      await logUserAction(userId, "emergency_close_all", { totalTrades: trades.length, results }, req);

      try {
        pushNotificationService.sendToUser(userId, {
          title: "EMERGENCY: All Trades Closed",
          body: `Kill switch activated - ${results.filter(r => r.success).length}/${trades.length} trades closed`,
          tag: "emergency-close",
        });
      } catch {}

      res.json({
        closed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        total: trades.length,
        results,
      });
    } catch (error) {
      console.error("[Emergency] Close all error:", error);
      res.status(500).json({ error: "Emergency close failed" });
    }
  });

  app.get("/api/trade-duration-insights", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const allTrades = await storage.getSimulatedTrades();
      const closedTrades = allTrades.filter(t => 
        t.status !== "open" && t.status !== "cancelled" && t.openedAt && t.closedAt && t.pnlMoney !== undefined && t.pnlMoney !== null
      );

      const insights: Record<string, {
        instrument: string;
        timeframe: string;
        avgDurationHours: number;
        avgWinDurationHours: number;
        avgLossDurationHours: number;
        totalTrades: number;
        winningTrades: number;
        losingTrades: number;
        winRate: number;
      }> = {};

      for (const trade of closedTrades) {
        const key = `${trade.instrument}_${trade.timeframe}`;
        const entryTime = new Date(trade.openedAt!).getTime();
        const exitTime = new Date(trade.closedAt!).getTime();
        const durationHours = (exitTime - entryTime) / (1000 * 60 * 60);
        
        if (durationHours <= 0 || durationHours > 500) continue;

        if (!insights[key]) {
          insights[key] = {
            instrument: trade.instrument,
            timeframe: trade.timeframe,
            avgDurationHours: 0,
            avgWinDurationHours: 0,
            avgLossDurationHours: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
          };
        }

        const entry = insights[key];
        entry.totalTrades++;
        
        const pnl = trade.pnlMoney ?? 0;
        if (pnl > 0) {
          entry.winningTrades++;
          entry.avgWinDurationHours = ((entry.avgWinDurationHours * (entry.winningTrades - 1)) + durationHours) / entry.winningTrades;
        } else {
          entry.losingTrades++;
          entry.avgLossDurationHours = ((entry.avgLossDurationHours * (entry.losingTrades - 1)) + durationHours) / entry.losingTrades;
        }
        entry.avgDurationHours = ((entry.avgDurationHours * (entry.totalTrades - 1)) + durationHours) / entry.totalTrades;
        entry.winRate = entry.totalTrades > 0 ? (entry.winningTrades / entry.totalTrades) * 100 : 0;
      }

      const results = Object.values(insights)
        .filter(i => i.totalTrades >= 3)
        .sort((a, b) => b.totalTrades - a.totalTrades);

      res.json({ 
        insights: results,
        timeframeLimits: TIMEFRAME_DURATION_LIMITS,
        totalAnalyzed: closedTrades.length,
      });
    } catch (error) {
      console.error("[DurationInsights] Error:", error);
      res.status(500).json({ error: "Failed to compute duration insights" });
    }
  });

  app.get("/api/oanda/guardian/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const config = await getGuardianConfigFromDB(userId);
      const isPaused = isUserPausedByGuardian(userId);

      const userRecord = await getUserSettings(userId);
      const maxOpenPositions = userRecord?.maxOpenPositions ?? 3;

      const mergedTimeframeDurations: Record<string, number> = { ...TIMEFRAME_DURATION_LIMITS };
      if (config.timeframeDurations) {
        for (const [tf, hours] of Object.entries(config.timeframeDurations)) {
          if (typeof hours === "number" && hours > 0) mergedTimeframeDurations[tf] = hours;
        }
      }

      res.json({
        enabled: config.enabled,
        maxTradeDurationHours: config.maxTradeDurationHours,
        dailyLossLimitPercent: config.dailyLossLimitPercent,
        maxOpenPositions,
        timeframeDurationLimits: TIMEFRAME_DURATION_LIMITS,
        timeframeDurations: mergedTimeframeDurations,
        isNewTradesPaused: isPaused,
        lastCheck: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get guardian status" });
    }
  });

  app.post("/api/oanda/guardian/config", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { maxTradeDurationHours, dailyLossLimitPercent, enabled, maxOpenPositions, timeframeDurations } = req.body;
      const current = await getGuardianConfigFromDB(userId);

      const updated: GuardianConfig = {
        maxTradeDurationHours: maxTradeDurationHours ?? current.maxTradeDurationHours,
        dailyLossLimitPercent: dailyLossLimitPercent ?? current.dailyLossLimitPercent,
        enabled: enabled ?? current.enabled,
        timeframeDurations: timeframeDurations ?? current.timeframeDurations,
      };

      const clampedMaxPositions = maxOpenPositions != null
        ? Math.max(1, Math.min(10, Math.round(maxOpenPositions)))
        : undefined;

      await db.update(userSettingsTable).set({
        guardianEnabled: updated.enabled,
        maxTradeDurationHours: updated.maxTradeDurationHours,
        dailyLossLimitPercent: updated.dailyLossLimitPercent,
        timeframeDurations: updated.timeframeDurations,
        ...(clampedMaxPositions != null ? { maxOpenPositions: clampedMaxPositions } : {}),
        updatedAt: new Date().toISOString(),
      }).where(eq(userSettingsTable.userId, userId));

      const tfDetails = updated.timeframeDurations
        ? Object.entries(updated.timeframeDurations).map(([tf, h]) => `${tf}:${h}h`).join(", ")
        : "defaults";
      await logOandaActivity(userId, "guardian_config_update", {
        details: `Timeframes: ${tfDetails}, Loss limit: ${updated.dailyLossLimitPercent}%, Max positions: ${clampedMaxPositions ?? 'unchanged'}, Enabled: ${updated.enabled}`,
        source: "user",
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update guardian config" });
    }
  });

  app.get("/api/oanda/activity-log", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const logs = await db.select()
        .from(oandaActivityLogTable)
        .where(eq(oandaActivityLogTable.userId, userId))
        .orderBy(desc(oandaActivityLogTable.createdAt))
        .limit(limit);

      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to get activity log" });
    }
  });

  app.get("/api/telegram/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const settings = await getUserSettings(userId);
      res.json({
        botRunning: isTelegramBotRunning(),
        enabled: settings.telegramEnabled ?? false,
        chatId: settings.telegramChatId ?? null,
        autoExecute: settings.telegramAutoExecute ?? false,
        recentSignals: getRecentTelegramSignals().slice(-10),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get telegram status" });
    }
  });

  app.post("/api/telegram/test-parse", async (req, res) => {
    try {
      const { message, forwardSourceTitle } = req.body;
      if (!message) return res.status(400).json({ error: "No message provided" });
      const parsed = parseTelegramSignal(message, forwardSourceTitle);
      res.json({ parsed, success: !!parsed });
    } catch (error) {
      res.status(500).json({ error: "Failed to parse signal" });
    }
  });
}
