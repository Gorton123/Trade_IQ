import TelegramBot from "node-telegram-bot-api";
import { db } from "./db";
import { userSettingsTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  oandaGetAccountSummary,
  oandaGetCurrentPrice,
  oandaPlaceMarketOrder,
  type OandaCredentials,
} from "./oanda";

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

function calculateLotSize(
  accountBalance: number,
  riskPercent: number,
  stopLossPips: number,
  instrument: string,
  accountCurrency: string,
  currentPrice?: number
): { lotSize: number; units: number; riskAmount: number; pipValue: number; skipped?: boolean; skipReason?: string } {
  const pipSize = PIP_VALUES[instrument] || 0.0001;
  const contractSize = CONTRACT_SIZES[instrument] || 100000;
  const riskAmount = accountBalance * (riskPercent / 100);
  let pipValueUsd = pipSize * contractSize;
  const isJpyQuote = instrument.endsWith("JPY");
  const isChfQuote = instrument.endsWith("CHF");
  const isGbpQuote = instrument.endsWith("GBP");
  if ((isJpyQuote || isChfQuote) && currentPrice && currentPrice > 0) {
    pipValueUsd = pipValueUsd / currentPrice;
  }
  let pipValue: number;
  if (isGbpQuote && accountCurrency === "GBP") {
    pipValue = pipValueUsd;
  } else if (accountCurrency === "GBP") {
    pipValue = pipValueUsd * 0.735;
  } else if (accountCurrency === "EUR") {
    pipValue = pipValueUsd * 0.84;
  } else {
    pipValue = pipValueUsd;
  }
  if (stopLossPips <= 0 || pipValue <= 0) {
    return { lotSize: 0, units: 0, riskAmount: 0, pipValue: 0, skipped: true, skipReason: "Invalid SL or pip value" };
  }
  const rawLots = riskAmount / (stopLossPips * pipValue);
  const lotSize = Math.max(0.01, Math.round(rawLots * 100) / 100);
  const units = Math.round(lotSize * contractSize);
  if (units < 1) {
    return { lotSize: 0, units: 0, riskAmount, pipValue, skipped: true, skipReason: "Position too small" };
  }
  return { lotSize, units, riskAmount, pipValue };
}

const INSTRUMENT_ALIASES: Record<string, string> = {
  GOLD: "XAUUSD",
  XAUUSD: "XAUUSD",
  "XAU/USD": "XAUUSD",
  XAU_USD: "XAUUSD",
  SILVER: "XAGUSD",
  XAGUSD: "XAGUSD",
  "XAG/USD": "XAGUSD",
  XAG_USD: "XAGUSD",
  EURUSD: "EURUSD",
  "EUR/USD": "EURUSD",
  EUR_USD: "EURUSD",
  GBPUSD: "GBPUSD",
  "GBP/USD": "GBPUSD",
  GBP_USD: "GBPUSD",
  USDJPY: "USDJPY",
  "USD/JPY": "USDJPY",
  USD_JPY: "USDJPY",
  AUDUSD: "AUDUSD",
  "AUD/USD": "AUDUSD",
  AUD_USD: "AUDUSD",
  NZDUSD: "NZDUSD",
  "NZD/USD": "NZDUSD",
  NZD_USD: "NZDUSD",
  USDCHF: "USDCHF",
  "USD/CHF": "USDCHF",
  USD_CHF: "USDCHF",
  USDCAD: "USDCAD",
  "USD/CAD": "USDCAD",
  USD_CAD: "USDCAD",
  EURGBP: "EURGBP",
  "EUR/GBP": "EURGBP",
  EUR_GBP: "EURGBP",
  EURJPY: "EURJPY",
  "EUR/JPY": "EURJPY",
  EUR_JPY: "EURJPY",
  GBPJPY: "GBPJPY",
  "GBP/JPY": "GBPJPY",
  GBP_JPY: "GBPJPY",
};

export interface ParsedTelegramSignal {
  instrument: string;
  direction: "buy" | "sell";
  entryPrice?: number;
  entryZone?: { low: number; high: number };
  stopLoss?: number;
  takeProfit?: number;
  takeProfit2?: number;
  raw: string;
}

function findInstrumentInText(text: string): string | null {
  const upper = text.toUpperCase();
  const sortedAliases = Object.entries(INSTRUMENT_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, standard] of sortedAliases) {
    const escapedAlias = alias.replace(/[/\\]/g, "\\$&");
    if (new RegExp(`\\b${escapedAlias}\\b`).test(upper) || upper.includes(alias)) {
      return standard;
    }
  }
  return null;
}

export function parseTelegramSignal(text: string, forwardSourceTitle?: string): ParsedTelegramSignal | null {
  if (!text || text.length < 5) return null;

  const originalText = text;
  const cleaned = text.replace(/[^\x20-\x7E\n\r]/g, " ").trim();
  const upper = cleaned.toUpperCase();
  const lines = cleaned.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

  if (/^\+\d+$/.test(cleaned.trim())) return null;
  if (/^(profit|boom|in profit|close profit|target \d|wait for the call)/i.test(cleaned.trim())) return null;
  if (/^potential\s+(buy|sell)\s+zone/i.test(cleaned.trim()) && !/\bnow\b/i.test(cleaned)) return null;

  let direction: "buy" | "sell" | null = null;
  if (/\bBUY\b|\bLONG\b/i.test(upper)) direction = "buy";
  if (/\bSELL\b|\bSHORT\b/i.test(upper)) direction = "sell";
  if (!direction) return null;

  let instrument = findInstrumentInText(upper);

  if (!instrument && forwardSourceTitle) {
    instrument = findInstrumentInText(forwardSourceTitle);
  }

  const slMatch = upper.match(/(?:SL|STOP\s*LOSS|STOPLOSS|S\/L)\s*[:=]?\s*([\d.]+)/);
  const invalidSlMatch = upper.match(/INVALID\s*[/]?\s*(?:SL)?\s*([\d.]+)/);
  const stopLoss = slMatch ? parseFloat(slMatch[1]) : (invalidSlMatch ? parseFloat(invalidSlMatch[1]) : undefined);

  let entryPrice: number | undefined;
  let entryZone: { low: number; high: number } | undefined;

  const entryZoneMatch = upper.match(/(?:ENTRY|ENTER|PRICE|@|ZONE)\s*[:=]?\s*([\d.]+)\s*[-–—to]+\s*([\d.]+)/);
  const bareZoneMatch = cleaned.match(/^([\d.]+)\s*[-–—]\s*([\d.]+)$/m);
  const entryMatch = upper.match(/(?:ENTRY|ENTRY\s*PRICE|ENTER|PRICE|@)\s*[:=]?\s*([\d.]+)/);

  if (entryZoneMatch) {
    const z1 = parseFloat(entryZoneMatch[1]);
    const z2 = parseFloat(entryZoneMatch[2]);
    entryZone = { low: Math.min(z1, z2), high: Math.max(z1, z2) };
    entryPrice = (z1 + z2) / 2;
  } else if (bareZoneMatch) {
    const z1 = parseFloat(bareZoneMatch[1]);
    const z2 = parseFloat(bareZoneMatch[2]);
    if (z1 > 100 && z2 > 100) {
      entryZone = { low: Math.min(z1, z2), high: Math.max(z1, z2) };
      entryPrice = (z1 + z2) / 2;
    }
  } else if (entryMatch) {
    entryPrice = parseFloat(entryMatch[1]);
  }

  const tpMatch = upper.match(/(?:TP\s*1?|TAKE\s*PROFIT\s*1?|T\/P\s*1?)\s*[:=]?\s*([\d.]+)/);
  const tp2Match = upper.match(/(?:TP\s*2|TAKE\s*PROFIT\s*2|T\/P\s*2)\s*[:=]?\s*([\d.]+)/);

  let takeProfit = tpMatch ? parseFloat(tpMatch[1]) : undefined;
  let takeProfit2 = tp2Match ? parseFloat(tp2Match[1]) : undefined;

  if (!takeProfit) {
    const targetsIdx = lines.findIndex(l => /^targets?$/i.test(l));
    if (targetsIdx >= 0) {
      const targetNumbers: number[] = [];
      for (let i = targetsIdx + 1; i < lines.length; i++) {
        const numMatch = lines[i].match(/^([\d.]+)$/);
        if (numMatch) {
          targetNumbers.push(parseFloat(numMatch[1]));
        } else {
          break;
        }
      }
      if (targetNumbers.length > 0) {
        takeProfit = targetNumbers[0];
        if (targetNumbers.length > 1) takeProfit2 = targetNumbers[1];
      }
    }
  }

  if (!takeProfit && stopLoss && entryPrice) {
    const slDistance = Math.abs(entryPrice - stopLoss);
    if (direction === "buy") {
      takeProfit = entryPrice + slDistance * 2;
    } else {
      takeProfit = entryPrice - slDistance * 2;
    }
    takeProfit = Math.round(takeProfit * 100) / 100;
  }

  if (!instrument) return null;
  if (!stopLoss) return null;
  if (!takeProfit) return null;

  return { instrument, direction, entryPrice, entryZone, stopLoss, takeProfit, takeProfit2, raw: originalText };
}

let bot: TelegramBot | null = null;
let isRunning = false;

const recentSignals: Array<{
  signal: ParsedTelegramSignal;
  timestamp: Date;
  executed: boolean;
  result?: string;
  telegramChatId?: string;
}> = [];

export function getRecentTelegramSignals() {
  return recentSignals.slice(-20);
}

async function getUserOandaCredentials(userId: string): Promise<{
  apiKey: string;
  accountId: string;
  isLive: boolean;
} | null> {
  try {
    const { decryptApiKey } = await import("./encryption");
    const result = await db.execute(
      `SELECT oanda_api_key, oanda_account_id, oanda_environment FROM users WHERE id = $1`,
      [userId]
    );
    const row = result.rows?.[0] as any;
    if (!row || !row.oanda_api_key || !row.oanda_account_id) return null;
    return {
      apiKey: decryptApiKey(row.oanda_api_key),
      accountId: row.oanda_account_id,
      isLive: row.oanda_environment === "live",
    };
  } catch {
    return null;
  }
}

async function getUserSettings(userId: string) {
  const rows = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);
  return rows[0] || null;
}

async function executeSignalForUser(
  userId: string,
  signal: ParsedTelegramSignal
): Promise<{ success: boolean; message: string }> {
  try {
    const settings = await getUserSettings(userId);
    const accountType = settings?.telegramAccountType ?? "paper";
    const riskPercent = settings?.telegramRiskPercent ?? 0.5;

    if (settings?.guardianEnabled === false) {
      return { success: false, message: "Guardian is disabled — trade blocked" };
    }

    const oandaCreds = await getUserOandaCredentials(userId);

    if (accountType === "live") {
      if (!oandaCreds) return { success: false, message: "OANDA not connected — can't place live trades" };

      const creds: OandaCredentials = {
        apiKey: oandaCreds.apiKey,
        accountId: oandaCreds.accountId,
        isLive: oandaCreds.isLive,
      };

      const maxPositions = settings?.maxOpenPositions ?? 3;
      const openTrades = await import("./oanda").then(m => m.oandaGetOpenTrades(creds));
      if (openTrades && openTrades.length >= maxPositions) {
        return { success: false, message: `Max positions reached (${openTrades.length}/${maxPositions})` };
      }

      const sameInstrumentTrades = openTrades?.filter((t: any) => {
        const tradeInst = (t.instrument || "").replace("_", "");
        return tradeInst === signal.instrument;
      });
      if (sameInstrumentTrades && sameInstrumentTrades.length > 0) {
        return { success: false, message: `Already have an open ${signal.instrument} trade` };
      }

      const account = await oandaGetAccountSummary(creds);
      const accountBalance = parseFloat(account.balance);

      const dailyLossLimit = settings?.dailyLossLimitPercent ?? 5;
      const unrealizedPnl = parseFloat(account.unrealizedPL || "0");
      if (unrealizedPnl < 0 && Math.abs(unrealizedPnl) > accountBalance * (dailyLossLimit / 100)) {
        return { success: false, message: `Daily loss limit reached (${dailyLossLimit}% of balance)` };
      }

      let entryPrice = signal.entryPrice;
      if (!entryPrice) {
        const priceData = await oandaGetCurrentPrice(creds, signal.instrument);
        if (!priceData) return { success: false, message: "Could not get current price" };
        entryPrice = priceData.price;
      }

      const pipSize = PIP_VALUES[signal.instrument] || 0.0001;
      const slDistance = Math.abs(entryPrice - signal.stopLoss!);
      const slPips = slDistance / pipSize;

      const lotInfo = calculateLotSize(
        accountBalance,
        riskPercent,
        slPips,
        signal.instrument,
        account.currency || "GBP",
        entryPrice
      );

      if (lotInfo.skipped) {
        return { success: false, message: `Risk too high: ${lotInfo.skipReason}` };
      }

      const units = signal.direction === "buy" ? lotInfo.units : -lotInfo.units;

      console.log(
        `[Telegram] LIVE ${signal.direction} ${signal.instrument} for user ${userId.slice(0, 8)}... | ${lotInfo.lotSize} lots (${riskPercent}% risk) | SL: ${signal.stopLoss} | TP: ${signal.takeProfit}`
      );

      const result = await oandaPlaceMarketOrder(
        creds,
        signal.instrument,
        units,
        signal.stopLoss!,
        signal.takeProfit!
      );

      if (result.success) {
        return {
          success: true,
          message: `LIVE: ${signal.direction.toUpperCase()} ${signal.instrument} — ${lotInfo.lotSize} lots @ ${riskPercent}% risk (SL: ${signal.stopLoss}, TP: ${signal.takeProfit})`,
        };
      } else {
        return { success: false, message: result.error || "Order failed" };
      }
    } else {
      const { storage } = await import("./storage");

      let entryPrice = signal.entryPrice;
      if (!entryPrice && oandaCreds) {
        const creds: OandaCredentials = {
          apiKey: oandaCreds.apiKey,
          accountId: oandaCreds.accountId,
          isLive: oandaCreds.isLive,
        };
        const priceData = await oandaGetCurrentPrice(creds, signal.instrument);
        if (priceData) entryPrice = priceData.price;
      }
      if (!entryPrice) {
        return { success: false, message: "Could not get current price for paper trade" };
      }

      const paperBalance = settings?.paperCurrentBalance ?? 300;
      const paperCurrency = settings?.paperCurrency ?? "GBP";

      const pipSize = PIP_VALUES[signal.instrument] || 0.0001;
      const slDistance = Math.abs(entryPrice - signal.stopLoss!);
      const slPips = slDistance / pipSize;

      const lotInfo = calculateLotSize(
        paperBalance,
        riskPercent,
        slPips,
        signal.instrument,
        paperCurrency,
        entryPrice
      );

      if (lotInfo.skipped) {
        return { success: false, message: `Risk too high for paper account: ${lotInfo.skipReason}` };
      }

      const tradeId = crypto.randomUUID();
      const trade = {
        id: tradeId,
        signalId: `telegram-${Date.now()}`,
        userId,
        instrument: signal.instrument as any,
        timeframe: "1h" as any,
        direction: signal.direction as "buy" | "sell",
        entryPrice,
        stopLoss: signal.stopLoss!,
        takeProfit1: signal.takeProfit!,
        takeProfit2: signal.takeProfit2,
        lotSize: lotInfo.lotSize,
        status: "open" as const,
        openedAt: new Date().toISOString(),
      };

      await storage.addSimulatedTrade(trade);

      console.log(
        `[Telegram] PAPER ${signal.direction} ${signal.instrument} for user ${userId.slice(0, 8)}... | ${lotInfo.lotSize} lots (${riskPercent}% risk) | SL: ${signal.stopLoss} | TP: ${signal.takeProfit}`
      );

      return {
        success: true,
        message: `PAPER: ${signal.direction.toUpperCase()} ${signal.instrument} — ${lotInfo.lotSize} lots @ ${riskPercent}% risk (SL: ${signal.stopLoss}, TP: ${signal.takeProfit})`,
      };
    }
  } catch (e: any) {
    return { success: false, message: e.message || "Execution error" };
  }
}

function formatSignalSummary(signal: ParsedTelegramSignal): string {
  const dir = signal.direction.toUpperCase();
  const entry = signal.entryZone
    ? `${signal.entryZone.low} - ${signal.entryZone.high}`
    : signal.entryPrice
    ? `${signal.entryPrice}`
    : "Market price";
  return `${dir} ${signal.instrument}\nEntry: ${entry}\nSL: ${signal.stopLoss}\nTP: ${signal.takeProfit}${signal.takeProfit2 ? `\nTP2: ${signal.takeProfit2}` : ""}`;
}

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[Telegram] No TELEGRAM_BOT_TOKEN set, skipping bot startup");
    return;
  }

  if (isRunning) {
    console.log("[Telegram] Bot already running");
    return;
  }

  try {
    bot = new TelegramBot(token, { polling: true });
    isRunning = true;

    bot.on("message", async (msg) => {
      const chatId = msg.chat.id.toString();
      const text = msg.text || msg.caption || "";

      if (msg.chat.type !== "private") return;

      if (text === "/start" || text === "/help") {
        bot?.sendMessage(
          chatId,
          `TradeIQ Signal Bot\n\nForward trading signals from your Telegram groups to me and I'll parse and execute them on your OANDA account.\n\nYour Chat ID: ${chatId}\n\nSetup:\n1. Go to TradeIQ Settings > Telegram\n2. Enable Telegram Signals\n3. Paste this Chat ID: ${chatId}\n4. Enable Auto-Execute\n5. Forward any signal message to me\n\nI'll parse signals like:\n"SELL XAUUSD @ 5390 SL 5420 TP 5340"\n"BUY GOLD 2650-2660 SL 2620 TP 2700"\n\nMessages I can't parse as signals are safely ignored.`
        );
        return;
      }

      if (!text || text.length < 5) return;

      const forwardTitle = (msg as any).forward_from_chat?.title || (msg as any).forward_origin?.chat?.title || "";

      const signal = parseTelegramSignal(text, forwardTitle);

      if (!signal) {
        bot?.sendMessage(chatId, "No trade signal detected in this message. I look for signals with a direction (BUY/SELL), instrument, SL, and TP.");
        return;
      }

      console.log(
        `[Telegram] Parsed signal from ${chatId}: ${signal.direction.toUpperCase()} ${signal.instrument} | Entry: ${signal.entryPrice || "market"} | SL: ${signal.stopLoss} | TP: ${signal.takeProfit}`
      );

      const signalEntry = {
        signal,
        timestamp: new Date(),
        executed: false,
        result: undefined as string | undefined,
        telegramChatId: chatId,
      };
      recentSignals.push(signalEntry);
      if (recentSignals.length > 50) recentSignals.shift();

      const usersWithTelegram = await db
        .select()
        .from(userSettingsTable)
        .where(eq(userSettingsTable.telegramEnabled, true));

      let matched = false;
      for (const userSettings of usersWithTelegram) {
        if (!userSettings.userId) continue;
        if (userSettings.telegramChatId !== chatId) continue;
        matched = true;

        if (!userSettings.telegramAutoExecute) {
          bot?.sendMessage(
            chatId,
            `Signal detected:\n${formatSignalSummary(signal)}\n\nAuto-execute is OFF. Enable it in TradeIQ Settings to place trades automatically.`
          );
          continue;
        }

        bot?.sendMessage(chatId, `Signal detected — executing...\n${formatSignalSummary(signal)}`);

        const result = await executeSignalForUser(userSettings.userId, signal);
        signalEntry.executed = result.success;
        signalEntry.result = result.message;

        const emoji = result.success ? "✅" : "❌";
        bot?.sendMessage(chatId, `${emoji} ${result.message}`);

        console.log(
          `[Telegram] User ${userSettings.userId.slice(0, 8)}: ${result.success ? "✓" : "✗"} ${result.message}`
        );
      }

      if (!matched) {
        bot?.sendMessage(
          chatId,
          `Signal detected:\n${formatSignalSummary(signal)}\n\nBut your Telegram is not linked to TradeIQ. Go to Settings > Telegram and paste your Chat ID: ${chatId}`
        );
      }
    });

    bot.on("polling_error", (error) => {
      console.error("[Telegram] Polling error:", error.message);
    });

    console.log("[Telegram] Bot started in private-chat mode, listening for forwarded signals...");
  } catch (e: any) {
    console.error("[Telegram] Failed to start bot:", e.message);
    isRunning = false;
  }
}

export function stopTelegramBot() {
  if (bot) {
    bot.stopPolling();
    bot = null;
    isRunning = false;
    console.log("[Telegram] Bot stopped");
  }
}

export function isTelegramBotRunning() {
  return isRunning;
}
