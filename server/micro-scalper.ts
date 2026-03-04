import { db } from "./db";
import { microScalperTradesTable, microScalperSettingsTable, userOandaCredentials } from "@shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { pushNotificationService } from "./push-notifications";
import { commissionService } from "./commission";

const OANDA_DEMO_STREAM_URL = "https://stream-fxpractice.oanda.com";
const OANDA_LIVE_STREAM_URL = "https://stream-fxtrade.oanda.com";
const OANDA_DEMO_URL = "https://api-fxpractice.oanda.com";
const OANDA_LIVE_URL = "https://api-fxtrade.oanda.com";

const PIP_VALUES: Record<string, number> = {
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  USDCHF: 0.0001,
  AUDUSD: 0.0001,
  NZDUSD: 0.0001,
  USDJPY: 0.01,
  EURJPY: 0.01,
  XAUUSD: 0.1,
  XAGUSD: 0.01,
};

function convertInstrument(instrument: string): string {
  const special: Record<string, string> = { XAUUSD: "XAU_USD", XAGUSD: "XAG_USD" };
  if (special[instrument]) return special[instrument];
  const match = instrument.match(/^([A-Z]{3})([A-Z]{3})$/);
  if (match) return `${match[1]}_${match[2]}`;
  return instrument;
}

interface TickData {
  instrument: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: Date;
}

interface MicroTrade {
  id: string;
  instrument: string;
  direction: "buy" | "sell";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  spread: number;
  momentumPips: number;
  openedAt: Date;
  breakEvenApplied: boolean;
  trailingStopPrice: number | null;
  oandaTradeId: string | null;
  highestFavorable: number;
}

interface ScalperSettings {
  isEnabled: boolean;
  startingBalance: number;
  currentBalance: number;
  currency: string;
  riskPercent: number;
  peakBalance: number;
  maxDrawdown: number;
  maxTradesPerHour: number;
  dailyLossLimit: number;
  maxSpreadPips: number;
  momentumThresholdPips: number;
  momentumWindowSeconds: number;
  takeProfitPips: number;
  trailingDistancePips: number;
  maxTradeSeconds: number;
  tradingPairs: string[];
  sessionFilter: boolean;
  profileType: string;
  oandaEnabled: boolean;
}

interface SessionInfo {
  name: string;
  active: boolean;
  boost: boolean;
  volatilityLevel: 'high' | 'medium' | 'low' | 'dead';
  description: string;
  nextActiveIn: string | null;
}

function getSessionInfo(): SessionInfo {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const minuteOfDay = utcHour * 60 + utcMinute;

  const londonOpen = 8 * 60;
  const londonBoostEnd = 8 * 60 + 30;
  const nyOpen = 13 * 60 + 30;
  const nyBoostEnd = 14 * 60;
  const londonClose = 16 * 60 + 30;
  const nyClose = 21 * 60;
  const overlap = 13 * 60;
  const overlapEnd = 16 * 60 + 30;

  const isLondon = minuteOfDay >= londonOpen && minuteOfDay < londonClose;
  const isNY = minuteOfDay >= nyOpen && minuteOfDay < nyClose;
  const isOverlap = minuteOfDay >= overlap && minuteOfDay < overlapEnd;
  const isLondonBoost = minuteOfDay >= londonOpen && minuteOfDay < londonBoostEnd;
  const isNYBoost = minuteOfDay >= nyOpen && minuteOfDay < nyBoostEnd;
  const isBoost = isLondonBoost || isNYBoost;

  let name = 'Off-Hours';
  let active = false;
  let volatilityLevel: 'high' | 'medium' | 'low' | 'dead' = 'dead';
  let description = 'Markets are quiet — not ideal for scalping';
  let nextActiveIn: string | null = null;

  if (isOverlap) {
    name = 'London/NY Overlap';
    active = true;
    volatilityLevel = 'high';
    description = 'Peak volatility — best window for fast trades';
  } else if (isLondonBoost || isNYBoost) {
    name = isLondonBoost ? 'London Open (Boost)' : 'NY Open (Boost)';
    active = true;
    volatilityLevel = 'high';
    description = 'Session open burst — lowered thresholds for more entries';
  } else if (isLondon) {
    name = 'London Session';
    active = true;
    volatilityLevel = 'medium';
    description = 'Good volatility — solid scalping conditions';
  } else if (isNY) {
    name = 'New York Session';
    active = true;
    volatilityLevel = 'medium';
    description = 'Active markets — decent for quick trades';
  } else {
    const minsToLondon = minuteOfDay < londonOpen
      ? londonOpen - minuteOfDay
      : (24 * 60 - minuteOfDay) + londonOpen;
    const hours = Math.floor(minsToLondon / 60);
    const mins = minsToLondon % 60;
    nextActiveIn = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  return { name, active, boost: isBoost, volatilityLevel, description, nextActiveIn };
}

function isInSessionBoost(): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const minuteOfDay = utcHour * 60 + utcMinute;
  const londonOpen = 8 * 60;
  const londonBoostEnd = 8 * 60 + 30;
  const nyOpen = 13 * 60 + 30;
  const nyBoostEnd = 14 * 60;
  return (minuteOfDay >= londonOpen && minuteOfDay < londonBoostEnd) ||
         (minuteOfDay >= nyOpen && minuteOfDay < nyBoostEnd);
}

const ROUND_NUMBER_LEVELS: Record<string, number[]> = {};

function getRoundNumbers(instrument: string, currentPrice: number): number[] {
  const cached = ROUND_NUMBER_LEVELS[instrument];
  if (cached && cached.length > 0) {
    const nearest = cached.reduce((a, b) => Math.abs(b - currentPrice) < Math.abs(a - currentPrice) ? b : a);
    if (Math.abs(nearest - currentPrice) / currentPrice < 0.05) return cached;
  }

  const levels: number[] = [];
  const pipValue = PIP_VALUES[instrument] || 0.0001;

  if (instrument === 'XAUUSD') {
    const base = Math.floor(currentPrice / 10) * 10;
    for (let i = -3; i <= 3; i++) levels.push(base + i * 10);
  } else if (instrument === 'XAGUSD') {
    const base = Math.floor(currentPrice);
    for (let i = -3; i <= 3; i++) levels.push(base + i);
  } else if (instrument.includes('JPY')) {
    const base = Math.floor(currentPrice * 2) / 2;
    for (let i = -3; i <= 3; i++) levels.push(base + i * 0.5);
  } else {
    const base = Math.floor(currentPrice * 100) / 100;
    for (let i = -5; i <= 5; i++) levels.push(Math.round((base + i * 0.005) * 10000) / 10000);
  }

  ROUND_NUMBER_LEVELS[instrument] = levels;
  return levels;
}

function getEntryQualityScore(instrument: string, price: number, direction: 'buy' | 'sell', momentumPips: number, threshold: number): number {
  let score = 50;

  const momentumRatio = momentumPips / threshold;
  if (momentumRatio >= 2.0) score += 20;
  else if (momentumRatio >= 1.5) score += 15;
  else if (momentumRatio >= 1.2) score += 10;
  else score += 5;

  const roundNumbers = getRoundNumbers(instrument, price);
  const pipValue = PIP_VALUES[instrument] || 0.0001;
  for (const level of roundNumbers) {
    const distancePips = Math.abs(price - level) / pipValue;
    if (distancePips < 5) {
      if ((direction === 'buy' && price > level) || (direction === 'sell' && price < level)) {
        score += 15;
      } else {
        score += 8;
      }
      break;
    } else if (distancePips < 10) {
      score += 5;
      break;
    }
  }

  const session = getSessionInfo();
  if (session.volatilityLevel === 'high') score += 10;
  else if (session.volatilityLevel === 'medium') score += 5;
  else if (session.volatilityLevel === 'dead') score -= 10;

  return Math.max(0, Math.min(100, score));
}

interface ScalperStats {
  totalTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  totalPnlMoney: number;
  totalPnlPips: number;
  avgWinPips: number;
  avgLossPips: number;
  tradesThisHour: number;
  dailyPnl: number;
  isStreaming: boolean;
  streamingPairs: string[];
  lastTickTime: string | null;
}

function getDecimals(instrument: string): number {
  if (instrument === "XAUUSD") return 2;
  if (instrument === "XAGUSD") return 4;
  if (instrument.includes("JPY")) return 3;
  return 5;
}

function isInTradingSession(): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  return utcHour >= 7 && utcHour <= 21;
}

const SCALPER_PROFILES: Record<string, {
  momentumThresholdPips: number;
  momentumWindowSeconds: number;
  takeProfitPips: number;
  trailingDistancePips: number;
  maxTradeSeconds: number;
  maxSpreadPips: number;
  riskPercent: number;
  maxTradesPerHour: number;
  dailyLossLimit: number;
  maxSlPips: number;
  breakEvenPips: number;
  stagnationSeconds: number;
}> = {
  tight_swing: {
    momentumThresholdPips: 6.0,
    momentumWindowSeconds: 300,
    takeProfitPips: 15,
    trailingDistancePips: 4.0,
    maxTradeSeconds: 600,
    maxSpreadPips: 5.0,
    riskPercent: 1.0,
    maxTradesPerHour: 10,
    dailyLossLimit: 30,
    maxSlPips: 8.0,
    breakEvenPips: 6.0,
    stagnationSeconds: 300,
  },
  conservative: {
    momentumThresholdPips: 8.0,
    momentumWindowSeconds: 600,
    takeProfitPips: 30,
    trailingDistancePips: 7.5,
    maxTradeSeconds: 1800,
    maxSpreadPips: 5.0,
    riskPercent: 1.0,
    maxTradesPerHour: 6,
    dailyLossLimit: 25,
    maxSlPips: 15.0,
    breakEvenPips: 12.0,
    stagnationSeconds: 600,
  },
  balanced: {
    momentumThresholdPips: 5.0,
    momentumWindowSeconds: 300,
    takeProfitPips: 25,
    trailingDistancePips: 6.0,
    maxTradeSeconds: 1200,
    maxSpreadPips: 5.0,
    riskPercent: 1.0,
    maxTradesPerHour: 8,
    dailyLossLimit: 30,
    maxSlPips: 12.0,
    breakEvenPips: 10.0,
    stagnationSeconds: 450,
  },
  aggressive: {
    momentumThresholdPips: 3.0,
    momentumWindowSeconds: 180,
    takeProfitPips: 20,
    trailingDistancePips: 5.0,
    maxTradeSeconds: 900,
    maxSpreadPips: 6.0,
    riskPercent: 1.5,
    maxTradesPerHour: 12,
    dailyLossLimit: 40,
    maxSlPips: 10.0,
    breakEvenPips: 8.0,
    stagnationSeconds: 300,
  },
};

const ALL_SCALPER_PAIRS = ["XAUUSD", "XAGUSD"];

interface OptimizationResult {
  status: "idle" | "optimizing" | "ready" | "error";
  selectedProfile: string | null;
  includedPairs: string[];
  excludedPairs: { pair: string; reason: string }[];
  confidence: number;
  lastOptimizedAt: string | null;
  nextOptimizationAt: string | null;
  profileResults: { profile: string; winRate: number; pnlPips: number; profitFactor: number; trades: number }[];
  consecutiveLosses: number;
  totalReoptimizations: number;
  progress: string | null;
}

const candleCache: Map<string, { data: BacktestCandle[]; fetchedAt: number }> = new Map();
const candleInflight: Map<string, Promise<BacktestCandle[]>> = new Map();
const CANDLE_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchCachedCandles(instrument: string, count: number): Promise<BacktestCandle[]> {
  const cacheKey = `${instrument}_${count}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cached.data;
  }
  const inflight = candleInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = fetchOandaBacktestCandles(instrument, count).then(data => {
    candleCache.set(cacheKey, { data, fetchedAt: Date.now() });
    candleInflight.delete(cacheKey);
    return data;
  }).catch(err => {
    candleInflight.delete(cacheKey);
    throw err;
  });
  candleInflight.set(cacheKey, promise);
  return promise;
}

class UserScalperInstance {
  userId: string;
  settings: ScalperSettings | null = null;
  openTrades: Map<string, MicroTrade> = new Map();
  tradesThisHour: number = 0;
  dailyPnl: number = 0;
  private tickCount: number = 0;
  private tickLogInterval: NodeJS.Timeout | null = null;
  oandaApiKey: string | null = null;
  oandaAccountId: string | null = null;
  oandaIsLive: boolean = false;
  isStreaming: boolean = false;
  streamAuthError: string | null = null;
  streamingPairs: string[] = [];
  lastTickTime: Date | null = null;

  private tickHistory: Map<string, TickData[]> = new Map();
  private streamAbortController: AbortController | null = null;
  private tradeMonitorInterval: NodeJS.Timeout | null = null;
  private hourResetInterval: NodeJS.Timeout | null = null;
  private dailyResetInterval: NodeJS.Timeout | null = null;

  activityFeed: { time: string; type: string; message: string; instrument?: string }[] = [];
  private maxActivityItems = 50;
  momentumReadings: Map<string, { movePips: number; threshold: number; spread: number; consistency: number; timestamp: number }> = new Map();
  private lastGateLog: Map<string, number> = new Map();
  private consecutiveWins: number = 0;
  private consecutiveLosses: number = 0;
  private sessionHighLow: Map<string, { high: number; low: number; resetAt: number }> = new Map();
  private lastTradeCloseTime: Map<string, number> = new Map();

  private addActivityThrottled(gateKey: string, type: string, message: string, instrument?: string): void {
    const now = Date.now();
    const last = this.lastGateLog.get(gateKey) || 0;
    if (now - last < 30000) return;
    this.lastGateLog.set(gateKey, now);
    this.addActivity(type, message, instrument);
  }

  private addActivity(type: string, message: string, instrument?: string): void {
    this.activityFeed.unshift({
      time: new Date().toISOString(),
      type,
      message,
      instrument,
    });
    if (this.activityFeed.length > this.maxActivityItems) {
      this.activityFeed.length = this.maxActivityItems;
    }
  }

  optimizationState: OptimizationResult = {
    status: "idle",
    selectedProfile: null,
    includedPairs: [],
    excludedPairs: [],
    confidence: 0,
    lastOptimizedAt: null,
    nextOptimizationAt: null,
    profileResults: [],
    consecutiveLosses: 0,
    totalReoptimizations: 0,
    progress: null,
  };
  private reoptimizeInterval: NodeJS.Timeout | null = null;
  private isReoptimizing: boolean = false;

  constructor(userId: string) {
    this.userId = userId;
  }

  async initialize(): Promise<void> {
    await this.loadSettings();
    await this.loadOpenTrades();
    this.startHourlyReset();
    this.startDailyReset();
    console.log(`[MicroScalper:${this.userId}] Instance initialized`);
  }

  private async loadSettings(): Promise<void> {
    try {
      const records = await db
        .select()
        .from(microScalperSettingsTable)
        .where(eq(microScalperSettingsTable.userId, this.userId))
        .orderBy(desc(microScalperSettingsTable.updatedAt));
      
      if (records.length > 1) {
        console.log(`[MicroScalper:${this.userId}] Cleaning up ${records.length - 1} duplicate settings rows`);
        for (let i = 1; i < records.length; i++) {
          await db.delete(microScalperSettingsTable).where(eq(microScalperSettingsTable.id, records[i].id));
        }
      }
      
      const record = records[0];
      if (record) {
        this.settings = {
          isEnabled: record.isEnabled,
          startingBalance: record.startingBalance,
          currentBalance: record.currentBalance,
          currency: record.currency,
          riskPercent: record.riskPercent,
          peakBalance: record.peakBalance,
          maxDrawdown: record.maxDrawdown,
          maxTradesPerHour: record.maxTradesPerHour,
          dailyLossLimit: record.dailyLossLimit,
          maxSpreadPips: record.maxSpreadPips,
          momentumThresholdPips: record.momentumThresholdPips,
          momentumWindowSeconds: record.momentumWindowSeconds,
          takeProfitPips: record.takeProfitPips,
          trailingDistancePips: record.trailingDistancePips,
          maxTradeSeconds: record.maxTradeSeconds,
          tradingPairs: (record.tradingPairs as string[]) || ["EURUSD", "GBPUSD", "USDJPY", "EURJPY"],
          sessionFilter: record.sessionFilter,
          profileType: record.profileType || "balanced",
          oandaEnabled: record.oandaEnabled ?? false,
        };
      } else {
        await db.insert(microScalperSettingsTable).values({
          userId: this.userId,
          isEnabled: false,
          startingBalance: 500,
          currentBalance: 500,
          currency: "GBP",
          riskPercent: 1.0,
          peakBalance: 500,
          maxDrawdown: 0,
          maxTradesPerHour: 10,
          dailyLossLimit: 30,
          maxSpreadPips: 5.0,
          momentumThresholdPips: 6.0,
          momentumWindowSeconds: 300,
          takeProfitPips: 15,
          trailingDistancePips: 4.0,
          maxTradeSeconds: 600,
          tradingPairs: ["XAUUSD", "XAGUSD"],
          sessionFilter: true,
          profileType: "tight_swing",
          oandaEnabled: false,
        });
        await this.loadSettings();
      }
    } catch (error) {
      console.error(`[MicroScalper:${this.userId}] Error loading settings:`, error);
      this.settings = {
        isEnabled: false,
        startingBalance: 500,
        currentBalance: 500,
        currency: "GBP",
        riskPercent: 1.0,
        peakBalance: 500,
        maxDrawdown: 0,
        maxTradesPerHour: 10,
        dailyLossLimit: 30,
        maxSpreadPips: 5.0,
        momentumThresholdPips: 6.0,
        momentumWindowSeconds: 300,
        takeProfitPips: 15,
        trailingDistancePips: 4.0,
        maxTradeSeconds: 600,
        tradingPairs: ["XAUUSD", "XAGUSD"],
        sessionFilter: true,
        profileType: "tight_swing",
        oandaEnabled: false,
      };
    }
  }

  private async loadOpenTrades(): Promise<void> {
    try {
      const trades = await db
        .select()
        .from(microScalperTradesTable)
        .where(
          and(
            eq(microScalperTradesTable.status, "open"),
            eq(microScalperTradesTable.userId, this.userId)
          )
        );
      for (const t of trades) {
        this.openTrades.set(t.id, {
          id: t.id,
          instrument: t.instrument,
          direction: t.direction as "buy" | "sell",
          entryPrice: t.entryPrice,
          stopLoss: t.stopLoss,
          takeProfit: t.takeProfit,
          lotSize: t.lotSize,
          spread: t.spread || 0,
          momentumPips: t.momentumPips || 0,
          openedAt: new Date(t.openedAt),
          breakEvenApplied: t.breakEvenApplied || false,
          trailingStopPrice: t.trailingStopPrice || null,
          oandaTradeId: t.oandaTradeId || null,
          highestFavorable: t.direction === "buy" ? t.entryPrice : t.entryPrice,
        });
      }
      console.log(`[MicroScalper:${this.userId}] Loaded ${this.openTrades.size} open trades`);
    } catch (error) {
      console.error(`[MicroScalper:${this.userId}] Error loading open trades:`, error);
    }
  }

  private startHourlyReset(): void {
    this.hourResetInterval = setInterval(() => {
      this.tradesThisHour = 0;
    }, 60 * 60 * 1000);
  }

  private startDailyReset(): void {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
      this.dailyPnl = 0;
      this.dailyResetInterval = setInterval(() => {
        this.dailyPnl = 0;
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  async autoOptimize(candleCount: number = 1000): Promise<OptimizationResult> {
    const uid = this.userId.slice(0, 8);
    console.log(`[ScalperOptimizer:${uid}] Starting auto-optimization...`);
    this.optimizationState.status = "optimizing";
    this.optimizationState.progress = "Starting optimization...";

    try {
      const profileResults: OptimizationResult["profileResults"] = [];
      const profileNames = Object.keys(SCALPER_PROFILES);
      let profileIdx = 0;

      for (const [profileName, profileSettings] of Object.entries(SCALPER_PROFILES)) {
        profileIdx++;
        this.optimizationState.progress = `Testing ${profileName} profile (${profileIdx}/${profileNames.length})...`;
        const results = await backtestScalper(
          ALL_SCALPER_PAIRS,
          {
            momentumThresholdPips: profileSettings.momentumThresholdPips,
            momentumWindowSeconds: profileSettings.momentumWindowSeconds,
            takeProfitPips: profileSettings.takeProfitPips,
            trailingDistancePips: profileSettings.trailingDistancePips,
            maxTradeSeconds: profileSettings.maxTradeSeconds,
            maxSpreadPips: profileSettings.maxSpreadPips,
          },
          candleCount,
          profileName
        );

        const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
        const totalWins = results.reduce((s, r) => s + r.wins, 0);
        const totalPnl = results.reduce((s, r) => s + r.totalPnlPips, 0);
        const grossWin = results.reduce((s, r) => s + r.trades.filter(t => t.pnlPips > 0).reduce((ss, t) => ss + t.pnlPips, 0), 0);
        const grossLoss = Math.abs(results.reduce((s, r) => s + r.trades.filter(t => t.pnlPips < 0).reduce((ss, t) => ss + t.pnlPips, 0), 0));
        const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
        const wr = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

        profileResults.push({
          profile: profileName,
          winRate: Math.round(wr * 10) / 10,
          pnlPips: Math.round(totalPnl * 10) / 10,
          profitFactor: Math.round(pf * 100) / 100,
          trades: totalTrades,
        });

        (profileResults as any)[profileName + "_details"] = results;

        console.log(`[ScalperOptimizer:${uid}] ${profileName}: ${totalTrades} trades, WR ${wr.toFixed(1)}%, PnL ${totalPnl.toFixed(1)} pips, PF ${pf.toFixed(2)}`);
      }

      const ranked = [...profileResults]
        .filter(p => p.trades >= 3)
        .sort((a, b) => {
          const scoreA = a.pnlPips * (a.profitFactor >= 1 ? 1.5 : 0.5) * (a.winRate >= 45 ? 1.2 : 0.8);
          const scoreB = b.pnlPips * (b.profitFactor >= 1 ? 1.5 : 0.5) * (b.winRate >= 45 ? 1.2 : 0.8);
          return scoreB - scoreA;
        });

      let bestProfile = ranked.length > 0 ? ranked[0] : null;

      if (!bestProfile || bestProfile.pnlPips <= 0) {
        const leastBad = [...profileResults]
          .filter(p => p.trades >= 1)
          .sort((a, b) => b.pnlPips - a.pnlPips);
        bestProfile = leastBad.length > 0 ? leastBad[0] : { profile: "balanced", winRate: 0, pnlPips: 0, profitFactor: 0, trades: 0 };
        console.log(`[ScalperOptimizer:${uid}] No profitable profile found, using least bad: ${bestProfile.profile}`);
      }

      const selectedProfileName = bestProfile.profile;
      const selectedSettings = SCALPER_PROFILES[selectedProfileName];

      const detailsKey = selectedProfileName + "_details";
      const bestDetails: BacktestResult[] = (profileResults as any)[detailsKey] || [];

      const includedPairs: string[] = [];
      const excludedPairs: { pair: string; reason: string }[] = [];

      for (const pair of ALL_SCALPER_PAIRS) {
        const pairResult = bestDetails.find(r => r.instrument === pair);
        if (!pairResult || pairResult.totalTrades === 0) {
          excludedPairs.push({ pair, reason: "No trades detected in backtest" });
        } else if (pairResult.totalPnlPips < -5 && pairResult.winRate < 35) {
          excludedPairs.push({ pair, reason: `Poor performance: ${pairResult.winRate.toFixed(0)}% WR, ${pairResult.totalPnlPips.toFixed(1)} pips` });
        } else {
          includedPairs.push(pair);
        }
      }

      if (includedPairs.length === 0) {
        const fallback = bestDetails
          .filter(r => r.totalTrades > 0)
          .sort((a, b) => b.totalPnlPips - a.totalPnlPips);
        if (fallback.length > 0) {
          includedPairs.push(fallback[0].instrument);
          const idx = excludedPairs.findIndex(e => e.pair === fallback[0].instrument);
          if (idx >= 0) excludedPairs.splice(idx, 1);
          console.log(`[ScalperOptimizer:${uid}] All pairs excluded, keeping least bad: ${fallback[0].instrument}`);
        } else {
          includedPairs.push("EURUSD", "GBPUSD");
          console.log(`[ScalperOptimizer:${uid}] No data at all, falling back to EURUSD/GBPUSD`);
        }
      }

      const maxPf = Math.max(...profileResults.map(p => p.profitFactor));
      const maxWr = Math.max(...profileResults.map(p => p.winRate));
      let confidence = 0;
      if (bestProfile.profitFactor >= 1.5 && bestProfile.winRate >= 50) confidence = 90;
      else if (bestProfile.profitFactor >= 1.0 && bestProfile.winRate >= 45) confidence = 70;
      else if (bestProfile.profitFactor >= 0.8 && bestProfile.winRate >= 40) confidence = 50;
      else if (bestProfile.trades >= 5) confidence = 30;
      else confidence = 15;

      if (this.settings) {
        const userProfileType = this.settings.profileType || "balanced";
        const userSessionFilter = this.settings.sessionFilter;
        const userTradingPairs = this.settings.tradingPairs;

        const userProfile = SCALPER_PROFILES[userProfileType] || selectedSettings;
        Object.assign(this.settings, {
          momentumThresholdPips: userProfile.momentumThresholdPips,
          momentumWindowSeconds: userProfile.momentumWindowSeconds,
          takeProfitPips: userProfile.takeProfitPips,
          trailingDistancePips: userProfile.trailingDistancePips,
          maxTradeSeconds: userProfile.maxTradeSeconds,
          maxSpreadPips: userProfile.maxSpreadPips,
          riskPercent: userProfile.riskPercent,
          maxTradesPerHour: userProfile.maxTradesPerHour,
          dailyLossLimit: userProfile.dailyLossLimit,
          tradingPairs: userTradingPairs,
          profileType: userProfileType,
          sessionFilter: userSessionFilter,
        });
        await this.saveSettings();
        console.log(`[ScalperOptimizer:${uid}] Preserved user profile: ${userProfileType}, sessionFilter: ${userSessionFilter}, pairs: ${userTradingPairs.join(",")}`);
      }

      const now = new Date();
      const nextOpt = new Date(now.getTime() + 60 * 60 * 1000);

      this.optimizationState = {
        status: "ready",
        selectedProfile: selectedProfileName,
        includedPairs,
        excludedPairs,
        confidence,
        lastOptimizedAt: now.toISOString(),
        nextOptimizationAt: nextOpt.toISOString(),
        profileResults,
        consecutiveLosses: this.optimizationState.consecutiveLosses,
        totalReoptimizations: this.optimizationState.totalReoptimizations + 1,
        progress: null,
      };

      console.log(`[ScalperOptimizer:${uid}] Selected: ${selectedProfileName} (${confidence}% confidence), Pairs: ${includedPairs.join(",")} | Excluded: ${excludedPairs.map(e => e.pair).join(",") || "none"}`);
      return this.optimizationState;
    } catch (error) {
      console.error(`[ScalperOptimizer:${uid}] Optimization failed:`, error);
      this.optimizationState.status = "error";
      return this.optimizationState;
    }
  }

  private startReoptimizationScheduler(): void {
    if (this.reoptimizeInterval) clearInterval(this.reoptimizeInterval);

    this.reoptimizeInterval = setInterval(async () => {
      if (this.isReoptimizing || !this.isStreaming) return;
      if (this.openTrades.size > 0) return;

      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();

      const isSessionBoundary =
        (utcHour === 7 && utcMinute < 5) ||
        (utcHour === 13 && utcMinute < 5) ||
        (utcHour === 16 && utcMinute < 5) ||
        (utcHour === 21 && utcMinute < 5);

      const lastOpt = this.optimizationState.lastOptimizedAt
        ? new Date(this.optimizationState.lastOptimizedAt).getTime()
        : 0;
      const hoursSinceOpt = (now.getTime() - lastOpt) / (1000 * 60 * 60);

      const needsReopt = hoursSinceOpt >= 1 || isSessionBoundary;

      if (needsReopt) {
        const jitterMs = Math.floor(Math.random() * 60000);
        setTimeout(() => {
          if (this.isStreaming && !this.isReoptimizing) {
            this.triggerReoptimization("scheduled");
          }
        }, jitterMs);
      }
    }, 5 * 60 * 1000);
  }

  async triggerReoptimization(reason: string): Promise<void> {
    if (this.isReoptimizing) return;
    this.isReoptimizing = true;
    const uid = this.userId.slice(0, 8);
    console.log(`[ScalperOptimizer:${uid}] Re-optimizing (reason: ${reason})...`);

    try {
      await this.autoOptimize(1000);

      if (this.isStreaming) {
        const oldPairs = this.streamingPairs;
        const newPairs = this.optimizationState.includedPairs;

        const pairsChanged = oldPairs.length !== newPairs.length ||
          oldPairs.some(p => !newPairs.includes(p));

        if (pairsChanged && this.openTrades.size === 0) {
          console.log(`[ScalperOptimizer:${uid}] Pairs changed: ${oldPairs.join(",")} -> ${newPairs.join(",")}, reconnecting stream...`);
          if (this.streamAbortController) {
            this.streamAbortController.abort();
          }
          this.streamingPairs = newPairs;
          this.startStreaming(newPairs);
        }
      }
    } finally {
      this.isReoptimizing = false;
    }
  }

  private onTradeClose(pnlPips: number): void {
    if (pnlPips < -0.1) {
      this.consecutiveLosses++;
      this.consecutiveWins = 0;
      this.optimizationState.consecutiveLosses++;
      if (this.optimizationState.consecutiveLosses >= 3 && this.openTrades.size === 0 && !this.isReoptimizing) {
        console.log(`[ScalperOptimizer:${this.userId.slice(0, 8)}] ${this.optimizationState.consecutiveLosses} consecutive losses, triggering re-optimization...`);
        this.triggerReoptimization(`${this.optimizationState.consecutiveLosses} consecutive losses`);
      }
    } else if (pnlPips > 0.1) {
      this.consecutiveWins++;
      this.consecutiveLosses = 0;
      this.optimizationState.consecutiveLosses = 0;
    } else {
      this.consecutiveWins = 0;
      this.consecutiveLosses = 0;
    }
  }

  async start(apiKey: string, accountId: string, isLive: boolean = false): Promise<{ success: boolean; error?: string }> {
    if (this.isStreaming) {
      return { success: false, error: "Already streaming" };
    }

    this.oandaApiKey = apiKey;
    this.oandaAccountId = accountId;
    this.oandaIsLive = isLive;

    await this.loadSettings();
    if (!this.settings) {
      return { success: false, error: "Settings not loaded" };
    }

    this.optimizationState.status = "optimizing";
    try {
      await this.autoOptimize(1000);
    } catch (err) {
      console.error(`[MicroScalper:${this.userId}] Auto-optimization failed, using current settings:`, err);
      this.optimizationState.status = "error";
    }

    this.settings.isEnabled = true;
    await this.saveSettings();

    const pairs = this.settings.tradingPairs;
    if (pairs.length === 0) {
      return { success: false, error: "No trading pairs configured" };
    }

    this.streamingPairs = pairs;
    this.startStreaming(pairs);
    this.startTradeMonitor();
    this.startReoptimizationScheduler();

    this.tickCount = 0;
    this.tickLogInterval = setInterval(() => {
      if (this.tickCount > 0) {
        console.log(`[MicroScalper:${this.userId.slice(0, 8)}...] ${this.tickCount} ticks received, ${this.openTrades.size} open trades, daily P&L: ${this.dailyPnl.toFixed(2)}`);
        this.tickCount = 0;
      }
    }, 60000);

    console.log(`[MicroScalper:${this.userId}] Started streaming: ${pairs.join(", ")} (profile: ${this.optimizationState.selectedProfile}, confidence: ${this.optimizationState.confidence}%)`);
    return { success: true };
  }

  async stop(userInitiated: boolean = true): Promise<void> {
    this.isStreaming = false;
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }
    if (this.tradeMonitorInterval) {
      clearInterval(this.tradeMonitorInterval);
      this.tradeMonitorInterval = null;
    }
    if (this.tickLogInterval) {
      clearInterval(this.tickLogInterval);
      this.tickLogInterval = null;
    }
    if (this.reoptimizeInterval) {
      clearInterval(this.reoptimizeInterval);
      this.reoptimizeInterval = null;
    }
    this.streamingPairs = [];

    if (userInitiated && this.settings) {
      this.settings.isEnabled = false;
      await this.saveSettings();
      console.log(`[MicroScalper:${this.userId}] Stopped by user - disabled`);
    } else {
      console.log(`[MicroScalper:${this.userId}] Stopped for server cleanup - will auto-restart`);
    }
  }

  private async startStreaming(pairs: string[]): Promise<void> {
    const streamBaseUrl = this.oandaIsLive ? OANDA_LIVE_STREAM_URL : OANDA_DEMO_STREAM_URL;
    const oandaInstruments = pairs.map(convertInstrument).join(",");
    const url = `${streamBaseUrl}/v3/accounts/${this.oandaAccountId}/pricing/stream?instruments=${oandaInstruments}`;

    this.isStreaming = true;
    this.streamAbortController = new AbortController();

    const connectStream = async () => {
      while (this.isStreaming) {
        try {
          console.log(`[MicroScalper:${this.userId}] Connecting to OANDA price stream...`);
          const response = await fetch(url, {
            headers: {
              Authorization: `Bearer ${this.oandaApiKey}`,
              "Content-Type": "application/json",
            },
            signal: this.streamAbortController!.signal,
          });

          if (!response.ok) {
            const errText = await response.text();
            console.error(`[MicroScalper:${this.userId}] Stream error ${response.status}: ${errText}`);
            if (response.status === 401 || response.status === 403) {
              this.streamAuthError = `OANDA streaming unavailable (${response.status}): Your API key may not have streaming permissions. ${this.oandaIsLive ? 'Live accounts require a full-access API key.' : 'Please check your OANDA API key settings.'}`;
              console.error(`[MicroScalper:${this.userId}] Auth failed - stopping stream. ${this.streamAuthError}`);
              this.isStreaming = false;
              this.addActivity("error", this.streamAuthError);
              return;
            }
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          if (!response.body) {
            console.error(`[MicroScalper:${this.userId}] No response body`);
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          this.streamAuthError = null;
          console.log(`[MicroScalper:${this.userId}] Connected to OANDA price stream`);

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (this.isStreaming) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const data = JSON.parse(trimmed);
                if (data.type === "PRICE") {
                  this.processTick(data);
                }
              } catch {
                // skip malformed lines
              }
            }
          }
        } catch (error: any) {
          if (error.name === "AbortError") {
            console.log(`[MicroScalper:${this.userId}] Stream aborted`);
            return;
          }
          console.error(`[MicroScalper:${this.userId}] Stream error:`, error.message);
          if (this.isStreaming) {
            console.log(`[MicroScalper:${this.userId}] Reconnecting in 5s...`);
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      }
    };

    connectStream();
  }

  private processTick(data: any): void {
    const instrument = data.instrument.replace("_", "");
    const bid = parseFloat(data.bids?.[0]?.price || "0");
    const ask = parseFloat(data.asks?.[0]?.price || "0");

    if (bid === 0 || ask === 0) return;

    const pipValue = PIP_VALUES[instrument] || 0.0001;
    const spreadPips = (ask - bid) / pipValue;

    const tick: TickData = {
      instrument,
      bid,
      ask,
      spread: spreadPips,
      timestamp: new Date(),
    };

    this.lastTickTime = tick.timestamp;
    this.tickCount++;

    if (!this.tickHistory.has(instrument)) {
      this.tickHistory.set(instrument, []);
    }
    const history = this.tickHistory.get(instrument)!;
    history.push(tick);

    const windowMs = (this.settings?.momentumWindowSeconds || 5) * 1000;
    const cutoff = Date.now() - windowMs * 2;
    while (history.length > 0 && history[0].timestamp.getTime() < cutoff) {
      history.shift();
    }

    this.manageTrades(tick);
    this.checkEntry(tick);
  }

  private updateSessionHighLow(tick: TickData): void {
    const instrument = tick.instrument;
    const mid = (tick.bid + tick.ask) / 2;
    const now = Date.now();
    const existing = this.sessionHighLow.get(instrument);
    const hourMs = 60 * 60 * 1000;

    if (!existing || now - existing.resetAt > hourMs) {
      this.sessionHighLow.set(instrument, { high: mid, low: mid, resetAt: now });
    } else {
      existing.high = Math.max(existing.high, mid);
      existing.low = Math.min(existing.low, mid);
    }
  }

  private getAdaptiveRiskPercent(): number {
    const baseRisk = this.settings?.riskPercent || 1.0;
    const maxRisk = 2.0;
    if (this.consecutiveWins >= 2) {
      return Math.min(baseRisk + 0.5, maxRisk);
    }
    if (this.consecutiveLosses >= 2) {
      return Math.max(baseRisk - 0.5, 0.5);
    }
    return baseRisk;
  }

  private checkEntry(tick: TickData): void {
    if (!this.settings || !this.settings.isEnabled) return;

    const now = new Date();
    const utcDay = now.getUTCDay();
    const utcHour = now.getUTCHours();
    const marketClosed = utcDay === 6 || (utcDay === 0 && utcHour < 22) || (utcDay === 5 && utcHour >= 22);
    if (marketClosed) return;

    this.updateMomentumReading(tick);
    this.updateSessionHighLow(tick);

    if (this.settings.sessionFilter && !isInTradingSession()) {
      this.addActivityThrottled("session_filter", "blocked", "Outside active trading session - scanning paused");
      return;
    }

    if (this.tradesThisHour >= this.settings.maxTradesPerHour) {
      this.addActivityThrottled("max_trades", "blocked", `Max trades/hour reached (${this.tradesThisHour}/${this.settings.maxTradesPerHour})`);
      return;
    }

    if (this.dailyPnl <= -this.settings.dailyLossLimit) {
      this.addActivityThrottled("daily_loss", "blocked", `Daily loss limit hit (${this.dailyPnl.toFixed(2)} / -${this.settings.dailyLossLimit})`);
      return;
    }

    if (tick.spread > this.settings.maxSpreadPips) {
      this.addActivityThrottled(`spread_${tick.instrument}`, "blocked", `${tick.instrument} spread ${tick.spread.toFixed(1)}p > max ${this.settings.maxSpreadPips}p`, tick.instrument);
      return;
    }

    const existingTrade = Array.from(this.openTrades.values()).find(
      (t) => t.instrument === tick.instrument
    );
    if (existingTrade) return;

    const lastClose = this.lastTradeCloseTime.get(tick.instrument) || 0;
    const cooldownMs = 30000;
    if (Date.now() - lastClose < cooldownMs) return;

    const momentum = this.detectMomentumWithLog(tick);
    if (!momentum) return;

    const qualityScore = getEntryQualityScore(
      tick.instrument,
      (tick.bid + tick.ask) / 2,
      momentum.direction,
      momentum.pips,
      this.settings.momentumThresholdPips
    );

    if (qualityScore < 55) {
      this.addActivity("rejected", `${tick.instrument} ${momentum.pips.toFixed(1)}p burst but quality score ${qualityScore}/100 too low (need 55+)`, tick.instrument);
      return;
    }

    const adaptiveRisk = this.getAdaptiveRiskPercent();
    const streakInfo = this.consecutiveWins >= 2 ? ` [streak +${this.consecutiveWins}W, risk ${adaptiveRisk.toFixed(1)}%]` : 
                       this.consecutiveLosses >= 2 ? ` [after ${this.consecutiveLosses}L, risk ${adaptiveRisk.toFixed(1)}%]` : '';

    this.addActivity("entry", `${momentum.direction.toUpperCase()} ${tick.instrument} - ${momentum.pips.toFixed(1)} pip burst, quality ${qualityScore}/100${streakInfo}`, tick.instrument);
    this.executeTrade(tick, momentum, qualityScore);
  }

  private updateMomentumReading(tick: TickData): void {
    const instrument = tick.instrument;
    const history = this.tickHistory.get(instrument);
    if (!history || history.length < 4) return;

    const windowMs = (this.settings?.momentumWindowSeconds || 5) * 1000;
    const now = Date.now();
    const recentTicks = history.filter((t) => now - t.timestamp.getTime() <= windowMs);
    if (recentTicks.length < 3) return;

    const pipValue = PIP_VALUES[instrument] || 0.0001;
    const first = recentTicks[0];
    const last = recentTicks[recentTicks.length - 1];
    const midFirst = (first.bid + first.ask) / 2;
    const midLast = (last.bid + last.ask) / 2;
    const movePips = Math.abs((midLast - midFirst) / pipValue);
    const threshold = this.settings?.momentumThresholdPips || 4;

    this.momentumReadings.set(instrument, {
      movePips: Math.round(movePips * 100) / 100,
      threshold,
      spread: Math.round(tick.spread * 100) / 100,
      consistency: 0,
      timestamp: now,
    });
  }

  private detectMomentumWithLog(tick: TickData): { direction: "buy" | "sell"; pips: number } | null {
    const instrument = tick.instrument;
    const history = this.tickHistory.get(instrument);
    if (!history || history.length < 4) return null;

    const windowMs = (this.settings?.momentumWindowSeconds || 5) * 1000;
    const now = Date.now();
    const recentTicks = history.filter((t) => now - t.timestamp.getTime() <= windowMs);
    if (recentTicks.length < 3) return null;

    const pipValue = PIP_VALUES[instrument] || 0.0001;
    const first = recentTicks[0];
    const last = recentTicks[recentTicks.length - 1];

    const midFirst = (first.bid + first.ask) / 2;
    const midLast = (last.bid + last.ask) / 2;

    const movePips = (midLast - midFirst) / pipValue;
    let threshold = this.settings?.momentumThresholdPips || 1.2;

    if (isInSessionBoost()) {
      threshold *= 0.7;
    }

    const absPips = Math.abs(movePips);

    this.momentumReadings.set(instrument, {
      movePips: Math.round(absPips * 100) / 100,
      threshold: Math.round(threshold * 100) / 100,
      spread: Math.round(tick.spread * 100) / 100,
      consistency: 0,
      timestamp: now,
    });

    if (absPips < threshold) {
      if (absPips >= threshold * 0.6) {
        this.addActivity("near_miss", `${instrument} move ${absPips.toFixed(1)}p / ${threshold.toFixed(1)}p needed (${Math.round(absPips/threshold*100)}%)`, instrument);
      }
      return null;
    }

    const direction: "buy" | "sell" = movePips > 0 ? "buy" : "sell";

    if (recentTicks.length >= 3) {
      let directionalTicks = 0;
      for (let i = 1; i < recentTicks.length; i++) {
        const prevMid = (recentTicks[i - 1].bid + recentTicks[i - 1].ask) / 2;
        const curMid = (recentTicks[i].bid + recentTicks[i].ask) / 2;
        if (direction === "buy" && curMid >= prevMid) directionalTicks++;
        else if (direction === "sell" && curMid <= prevMid) directionalTicks++;
      }
      const consistency = directionalTicks / (recentTicks.length - 1);

      const reading = this.momentumReadings.get(instrument);
      if (reading) reading.consistency = Math.round(consistency * 100);

      if (consistency < 0.55) {
        this.addActivity("rejected", `${instrument} ${absPips.toFixed(1)}p burst but only ${Math.round(consistency*100)}% consistent (need 55%)`, instrument);
        return null;
      }
    }

    const currentSpread = last.spread;
    const tpPips = this.settings?.takeProfitPips || 5;
    if (currentSpread > 0 && tpPips / currentSpread < 2.0) {
      this.addActivity("rejected", `${instrument} ${absPips.toFixed(1)}p burst but spread ${currentSpread.toFixed(1)}p too wide for ${tpPips}p TP (need 2x)`, instrument);
      return null;
    }

    if (absPips < currentSpread * 1.5) {
      this.addActivity("rejected", `${instrument} ${absPips.toFixed(1)}p move too small vs ${currentSpread.toFixed(1)}p spread (need 1.5x)`, instrument);
      return null;
    }

    return { direction, pips: absPips };
  }

  private async executeTrade(
    tick: TickData,
    momentum: { direction: "buy" | "sell"; pips: number },
    qualityScore: number = 50
  ): Promise<void> {
    if (!this.settings) return;

    const pipValue = PIP_VALUES[tick.instrument] || 0.0001;
    const entryPrice = momentum.direction === "buy" ? tick.ask : tick.bid;

    const maxSlPips = this.optimizationState.selectedProfile 
      ? (SCALPER_PROFILES[this.optimizationState.selectedProfile]?.maxSlPips || 3.0) 
      : 3.0;
    const slPipsRaw = Math.min(Math.max(tick.spread + 0.8, 1.5), maxSlPips);
    const slDistance = slPipsRaw * pipValue;
    const tpDistance = this.settings.takeProfitPips * pipValue;

    let stopLoss: number;
    let takeProfit: number;

    if (momentum.direction === "buy") {
      stopLoss = entryPrice - slDistance;
      takeProfit = entryPrice + tpDistance;
    } else {
      stopLoss = entryPrice + slDistance;
      takeProfit = entryPrice - tpDistance;
    }

    const adaptiveRisk = this.getAdaptiveRiskPercent();
    const riskAmount = this.settings.currentBalance * (adaptiveRisk / 100);
    const slPips = slDistance / pipValue;
    
    const contractSizes: Record<string, number> = { XAUUSD: 100, XAGUSD: 5000 };
    const minUnitMap: Record<string, number> = { XAUUSD: 1, XAGUSD: 5 };
    const contractSize = contractSizes[tick.instrument] || 100000;
    const instrumentMinUnits = minUnitMap[tick.instrument] || 1;
    
    const pipValuePerLot = pipValue * contractSize;
    const rawLotSize = riskAmount / (slPips * pipValuePerLot);
    const roundedLot = Math.round(rawLotSize * 1000) / 1000;
    const instrumentMinLot = Math.max(0.001, Math.ceil((instrumentMinUnits / contractSize) * 1000) / 1000);
    const safeLot = Math.max(instrumentMinLot, roundedLot);
    
    const effectiveUnits = Math.max(instrumentMinUnits, Math.round(safeLot * contractSize));
    const lotSize = Math.round((effectiveUnits / contractSize) * 1000) / 1000;
    
    const effectiveRisk = lotSize * slPips * pipValuePerLot;
    if (lotSize <= instrumentMinLot && effectiveRisk > riskAmount * 2) {
      console.log(`[MicroScalper:${this.userId}] SKIPPED ${tick.instrument}: min ${lotSize} lots would risk ${effectiveRisk.toFixed(2)} vs budget ${riskAmount.toFixed(2)} - exceeds 2x`);
      return;
    }

    const tradeId = randomUUID();
    const trade: MicroTrade = {
      id: tradeId,
      instrument: tick.instrument,
      direction: momentum.direction,
      entryPrice,
      stopLoss,
      takeProfit,
      lotSize,
      spread: tick.spread,
      momentumPips: momentum.pips,
      openedAt: new Date(),
      breakEvenApplied: false,
      trailingStopPrice: null,
      oandaTradeId: null,
      highestFavorable: entryPrice,
    };

    this.openTrades.set(tradeId, trade);
    this.tradesThisHour++;

    const decimals = getDecimals(tick.instrument);

    await db.insert(microScalperTradesTable).values({
      id: tradeId,
      userId: this.userId,
      instrument: tick.instrument,
      direction: momentum.direction,
      entryPrice,
      stopLoss,
      takeProfit,
      status: "open",
      lotSize,
      spread: tick.spread,
      momentumPips: momentum.pips,
      openedAt: new Date().toISOString(),
    });

    console.log(
      `[MicroScalper:${this.userId}] ENTRY: ${momentum.direction.toUpperCase()} ${tick.instrument} @ ${entryPrice.toFixed(decimals)} | SL: ${stopLoss.toFixed(decimals)} | TP: ${takeProfit.toFixed(decimals)} | ${lotSize} lots | Momentum: ${momentum.pips.toFixed(1)} pips`
    );

    pushNotificationService.sendTradeNotification(
      this.userId, tick.instrument, momentum.direction, 'scalp_opened', undefined,
      `${momentum.direction.toUpperCase()} @ ${entryPrice.toFixed(decimals)} | ${momentum.pips.toFixed(1)} pip momentum`
    ).catch(() => {});

    this.tryOandaExecution(trade);
  }

  private async tryOandaExecution(trade: MicroTrade): Promise<void> {
    if (!this.settings?.oandaEnabled) return;
    if (!this.oandaApiKey || !this.oandaAccountId) return;

    try {
      const baseUrl = this.oandaIsLive ? OANDA_LIVE_URL : OANDA_DEMO_URL;
      const oandaInstrument = convertInstrument(trade.instrument);
      const decimals = getDecimals(trade.instrument);

      const pipValue = PIP_VALUES[trade.instrument] || 0.0001;
      let units: number;
      if (trade.instrument === "XAUUSD") {
        units = Math.max(1, Math.round(trade.lotSize * 100));
      } else if (trade.instrument === "XAGUSD") {
        units = Math.max(5, Math.round(trade.lotSize * 5000));
      } else {
        units = Math.max(1, Math.round(trade.lotSize * 100000));
      }
      if (trade.direction === "sell") units = -units;

      const orderData = {
        order: {
          type: "MARKET",
          instrument: oandaInstrument,
          units: units.toString(),
          stopLossOnFill: { price: trade.stopLoss.toFixed(decimals) },
          takeProfitOnFill: { price: trade.takeProfit.toFixed(decimals) },
          timeInForce: "FOK",
          positionFill: "DEFAULT",
        },
      };

      const response = await fetch(`${baseUrl}/v3/accounts/${this.oandaAccountId}/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.oandaApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderData),
      });

      const data = await response.json();
      if (response.ok && data.orderFillTransaction?.tradeOpened?.tradeID) {
        const oandaTradeId = data.orderFillTransaction.tradeOpened.tradeID;
        trade.oandaTradeId = oandaTradeId;
        await db
          .update(microScalperTradesTable)
          .set({ oandaTradeId })
          .where(
            and(
              eq(microScalperTradesTable.id, trade.id),
              eq(microScalperTradesTable.userId, this.userId)
            )
          );
        console.log(`[MicroScalper:${this.userId}] OANDA trade opened: ${oandaTradeId}`);
      }
    } catch (error) {
      console.error(`[MicroScalper:${this.userId}] OANDA execution failed:`, error);
    }
  }

  private manageTrades(tick: TickData): void {
    if (!this.settings) return;

    const entries = Array.from(this.openTrades.entries());
    for (const [id, trade] of entries) {
      if (trade.instrument !== tick.instrument) continue;

      const pipValue = PIP_VALUES[trade.instrument] || 0.0001;
      const currentPrice = trade.direction === "buy" ? tick.bid : tick.ask;
      const decimals = getDecimals(trade.instrument);

      const pnlPips =
        trade.direction === "buy"
          ? (currentPrice - trade.entryPrice) / pipValue
          : (trade.entryPrice - currentPrice) / pipValue;

      if (trade.direction === "buy") {
        trade.highestFavorable = Math.max(trade.highestFavorable, currentPrice);
      } else {
        trade.highestFavorable = Math.min(trade.highestFavorable, currentPrice);
      }

      if (
        (trade.direction === "buy" && currentPrice <= trade.stopLoss) ||
        (trade.direction === "sell" && currentPrice >= trade.stopLoss)
      ) {
        this.closeTrade(trade, currentPrice, pnlPips, trade.breakEvenApplied ? "trailing_stop" : "stop_loss");
        continue;
      }

      if (
        (trade.direction === "buy" && currentPrice >= trade.takeProfit) ||
        (trade.direction === "sell" && currentPrice <= trade.takeProfit)
      ) {
        this.closeTrade(trade, currentPrice, pnlPips, "take_profit");
        continue;
      }

      const tradeAge = (Date.now() - trade.openedAt.getTime()) / 1000;
      if (tradeAge >= this.settings.maxTradeSeconds) {
        this.closeTrade(trade, currentPrice, pnlPips, "time_expired");
        continue;
      }

      const beThreshold = this.optimizationState.selectedProfile 
        ? (SCALPER_PROFILES[this.optimizationState.selectedProfile]?.breakEvenPips || 2.0) 
        : 2.0;
      if (!trade.breakEvenApplied && pnlPips >= beThreshold) {
        if (trade.direction === "buy") {
          trade.stopLoss = trade.entryPrice + 0.3 * pipValue;
        } else {
          trade.stopLoss = trade.entryPrice - 0.3 * pipValue;
        }
        trade.breakEvenApplied = true;
        trade.trailingStopPrice = trade.stopLoss;

        db.update(microScalperTradesTable)
          .set({ breakEvenApplied: true, trailingStopPrice: trade.stopLoss, stopLoss: trade.stopLoss })
          .where(
            and(
              eq(microScalperTradesTable.id, trade.id),
              eq(microScalperTradesTable.userId, this.userId)
            )
          )
          .catch(() => {});

        console.log(
          `[MicroScalper:${this.userId}] BREAK-EVEN: ${trade.instrument} SL moved to ${trade.stopLoss.toFixed(decimals)} (+${beThreshold} pips)`
        );

        this.tryOandaModifyStop(trade);
      }

      if (trade.breakEvenApplied) {
        const trailingDistance = this.settings.trailingDistancePips * pipValue;
        let newStop: number;

        if (trade.direction === "buy") {
          newStop = currentPrice - trailingDistance;
          if (newStop > trade.stopLoss) {
            trade.stopLoss = newStop;
            trade.trailingStopPrice = newStop;

            db.update(microScalperTradesTable)
              .set({ trailingStopPrice: trade.trailingStopPrice, stopLoss: trade.stopLoss })
              .where(
                and(
                  eq(microScalperTradesTable.id, trade.id),
                  eq(microScalperTradesTable.userId, this.userId)
                )
              )
              .catch(() => {});

            this.tryOandaModifyStop(trade);
          }
        } else {
          newStop = currentPrice + trailingDistance;
          if (newStop < trade.stopLoss) {
            trade.stopLoss = newStop;
            trade.trailingStopPrice = newStop;

            db.update(microScalperTradesTable)
              .set({ trailingStopPrice: trade.trailingStopPrice, stopLoss: trade.stopLoss })
              .where(
                and(
                  eq(microScalperTradesTable.id, trade.id),
                  eq(microScalperTradesTable.userId, this.userId)
                )
              )
              .catch(() => {});

            this.tryOandaModifyStop(trade);
          }
        }
      }

      const stagnationTime = this.optimizationState.selectedProfile 
        ? (SCALPER_PROFILES[this.optimizationState.selectedProfile]?.stagnationSeconds || 90) 
        : 90;
      if (!trade.breakEvenApplied && tradeAge >= stagnationTime && pnlPips < 0.5) {
        this.closeTrade(trade, currentPrice, pnlPips, "stagnant_exit");
        continue;
      }
    }
  }

  private async tryOandaModifyStop(trade: MicroTrade): Promise<void> {
    if (!this.settings?.oandaEnabled) return;
    if (!trade.oandaTradeId || !this.oandaApiKey || !this.oandaAccountId) return;

    try {
      const baseUrl = this.oandaIsLive ? OANDA_LIVE_URL : OANDA_DEMO_URL;
      const decimals = getDecimals(trade.instrument);

      await fetch(
        `${baseUrl}/v3/accounts/${this.oandaAccountId}/trades/${trade.oandaTradeId}/orders`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.oandaApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stopLoss: { price: trade.stopLoss.toFixed(decimals), timeInForce: "GTC" },
          }),
        }
      );
    } catch (error) {
      console.error(`[MicroScalper:${this.userId}] OANDA stop modify failed:`, error);
    }
  }

  private calculateScalperPnl(pnlPips: number, lotSize: number, instrument: string, currentPrice: number): number {
    const pipValue = PIP_VALUES[instrument] || 0.0001;
    const currency = this.settings?.currency || "GBP";
    let pnlMoney: number;

    if (instrument === "XAUUSD") {
      const pipValueUsd = 0.1 * 100;
      pnlMoney = pnlPips * lotSize * pipValueUsd;
    } else if (instrument === "XAGUSD") {
      const pipValueUsd = 0.01 * 5000;
      pnlMoney = pnlPips * lotSize * pipValueUsd;
    } else {
      const units = lotSize * 100000;
      const pnlQuoteCurrency = pnlPips * pipValue * units;

      const isJpyQuote = instrument.endsWith("JPY");
      const isChfQuote = instrument.endsWith("CHF");

      if (isJpyQuote) {
        pnlMoney = pnlQuoteCurrency / currentPrice;
      } else if (isChfQuote) {
        pnlMoney = pnlQuoteCurrency / (currentPrice > 0 ? currentPrice : 0.9);
      } else {
        pnlMoney = pnlQuoteCurrency;
      }
    }

    if (currency === "GBP") {
      pnlMoney *= 0.735;
    } else if (currency === "EUR") {
      pnlMoney *= 0.84;
    }

    return Math.round(pnlMoney * 100) / 100;
  }

  private async closeTrade(
    trade: MicroTrade,
    exitPrice: number,
    pnlPips: number,
    exitReason: string
  ): Promise<void> {
    this.openTrades.delete(trade.id);

    const pnlMoney = this.calculateScalperPnl(pnlPips, trade.lotSize, trade.instrument, exitPrice);

    this.dailyPnl += pnlMoney;

    if (this.settings) {
      this.settings.currentBalance += pnlMoney;
      this.settings.currentBalance = Math.round(this.settings.currentBalance * 100) / 100;
      this.settings.peakBalance = Math.max(this.settings.peakBalance, this.settings.currentBalance);
      const drawdown =
        this.settings.peakBalance > 0
          ? ((this.settings.peakBalance - this.settings.currentBalance) / this.settings.peakBalance) * 100
          : 0;
      this.settings.maxDrawdown = Math.max(this.settings.maxDrawdown, drawdown);
      await this.saveSettings();
    }

    const decimals = getDecimals(trade.instrument);
    const outcome = pnlPips > 0.1 ? "win" : pnlPips < -0.1 ? "loss" : "breakeven";

    await db
      .update(microScalperTradesTable)
      .set({
        exitPrice,
        status: "closed",
        pnlPips: Math.round(pnlPips * 10) / 10,
        pnlMoney,
        exitReason,
        closedAt: new Date().toISOString(),
        trailingStopPrice: trade.trailingStopPrice,
        breakEvenApplied: trade.breakEvenApplied,
      })
      .where(
        and(
          eq(microScalperTradesTable.id, trade.id),
          eq(microScalperTradesTable.userId, this.userId)
        )
      );

    const currSymbol = this.settings?.currency === "USD" ? "$" : this.settings?.currency === "EUR" ? "\u20AC" : "\u00A3";
    this.addActivity(
      outcome === "win" ? "win" : outcome === "loss" ? "loss" : "breakeven",
      `${trade.direction.toUpperCase()} ${trade.instrument} closed: ${pnlPips > 0 ? "+" : ""}${pnlPips.toFixed(1)} pips (${pnlMoney > 0 ? "+" : ""}${currSymbol}${pnlMoney.toFixed(2)}) — ${exitReason.replace(/_/g, " ")}`,
      trade.instrument
    );

    console.log(
      `[MicroScalper:${this.userId}] EXIT: ${trade.direction.toUpperCase()} ${trade.instrument} @ ${exitPrice.toFixed(decimals)} | ${outcome.toUpperCase()} | ${pnlPips > 0 ? "+" : ""}${pnlPips.toFixed(1)} pips | ${pnlMoney > 0 ? "+" : ""}${currSymbol}${pnlMoney.toFixed(2)} | Reason: ${exitReason}`
    );

    pushNotificationService.sendTradeNotification(this.userId, trade.instrument, trade.direction, 'scalp_closed', pnlPips).catch(() => {});

    if (pnlMoney > 0 && this.oandaIsLive) {
      commissionService.deductCommission(this.userId, trade.id, pnlMoney, trade.instrument).catch(err => {
        console.error(`[MicroScalper:${this.userId}] Commission deduction error:`, err.message);
      });
    }

    this.lastTradeCloseTime.set(trade.instrument, Date.now());
    this.onTradeClose(pnlPips);

    if (trade.oandaTradeId) {
      this.tryOandaClose(trade);
    }
  }

  private async tryOandaClose(trade: MicroTrade): Promise<void> {
    if (!this.settings?.oandaEnabled) return;
    if (!trade.oandaTradeId || !this.oandaApiKey || !this.oandaAccountId) return;

    try {
      const baseUrl = this.oandaIsLive ? OANDA_LIVE_URL : OANDA_DEMO_URL;
      await fetch(
        `${baseUrl}/v3/accounts/${this.oandaAccountId}/trades/${trade.oandaTradeId}/close`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.oandaApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      console.error(`[MicroScalper:${this.userId}] OANDA close failed:`, error);
    }
  }

  private startTradeMonitor(): void {
    this.tradeMonitorInterval = setInterval(() => {
      if (!this.settings) return;

      const monitorEntries = Array.from(this.openTrades.entries());
      for (const [id, trade] of monitorEntries) {
        const tradeAge = (Date.now() - trade.openedAt.getTime()) / 1000;
        if (tradeAge >= this.settings.maxTradeSeconds) {
          const pipValue = PIP_VALUES[trade.instrument] || 0.0001;
          const lastTick = this.getLastTick(trade.instrument);
          if (lastTick) {
            const currentPrice = trade.direction === "buy" ? lastTick.bid : lastTick.ask;
            const pnlPips =
              trade.direction === "buy"
                ? (currentPrice - trade.entryPrice) / pipValue
                : (trade.entryPrice - currentPrice) / pipValue;
            this.closeTrade(trade, currentPrice, pnlPips, "time_expired");
          }
        }
      }
    }, 1000);
  }

  private getLastTick(instrument: string): TickData | null {
    const history = this.tickHistory.get(instrument);
    if (!history || history.length === 0) return null;
    return history[history.length - 1];
  }

  async saveSettings(): Promise<void> {
    if (!this.settings) return;
    try {
      const [existing] = await db
        .select()
        .from(microScalperSettingsTable)
        .where(eq(microScalperSettingsTable.userId, this.userId));
      if (existing) {
        await db
          .update(microScalperSettingsTable)
          .set({
            isEnabled: this.settings.isEnabled,
            currentBalance: this.settings.currentBalance,
            peakBalance: this.settings.peakBalance,
            maxDrawdown: this.settings.maxDrawdown,
            riskPercent: this.settings.riskPercent,
            maxTradesPerHour: this.settings.maxTradesPerHour,
            dailyLossLimit: this.settings.dailyLossLimit,
            maxSpreadPips: this.settings.maxSpreadPips,
            momentumThresholdPips: this.settings.momentumThresholdPips,
            momentumWindowSeconds: this.settings.momentumWindowSeconds,
            takeProfitPips: this.settings.takeProfitPips,
            trailingDistancePips: this.settings.trailingDistancePips,
            maxTradeSeconds: this.settings.maxTradeSeconds,
            tradingPairs: this.settings.tradingPairs,
            sessionFilter: this.settings.sessionFilter,
            profileType: this.settings.profileType || "balanced",
            oandaEnabled: this.settings.oandaEnabled ?? false,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(microScalperSettingsTable.id, existing.id));
      }
    } catch (error) {
      console.error(`[MicroScalper:${this.userId}] Error saving settings:`, error);
    }
  }

  async updateSettings(updates: Partial<ScalperSettings>): Promise<void> {
    if (!this.settings) await this.loadSettings();
    if (this.settings) {
      const oldPairs = [...(this.settings.tradingPairs || [])];
      Object.assign(this.settings, updates);
      await this.saveSettings();
      
      const newPairs = this.settings.tradingPairs || [];
      const pairsChanged = oldPairs.length !== newPairs.length ||
        oldPairs.some(p => !newPairs.includes(p)) ||
        newPairs.some(p => !oldPairs.includes(p));
      
      if (pairsChanged && this.isStreaming && this.openTrades.size === 0) {
        const uid = this.userId.slice(0, 8);
        console.log(`[MicroScalper:${uid}] Trading pairs changed: ${oldPairs.join(",")} -> ${newPairs.join(",")}, restarting stream...`);
        if (this.streamAbortController) {
          this.streamAbortController.abort();
        }
        this.isStreaming = false;
        this.streamingPairs = newPairs;
        if (this.oandaApiKey && this.oandaAccountId && newPairs.length > 0) {
          this.startStreaming(newPairs);
        }
      }
    }
  }

  async resetAccount(startingBalance: number, currency: string): Promise<void> {
    if (this.settings) {
      this.settings.startingBalance = startingBalance;
      this.settings.currentBalance = startingBalance;
      this.settings.currency = currency;
      this.settings.peakBalance = startingBalance;
      this.settings.maxDrawdown = 0;
    }

    const [existing] = await db
      .select()
      .from(microScalperSettingsTable)
      .where(eq(microScalperSettingsTable.userId, this.userId));
    if (existing) {
      await db
        .update(microScalperSettingsTable)
        .set({
          startingBalance,
          currentBalance: startingBalance,
          currency,
          peakBalance: startingBalance,
          maxDrawdown: 0,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(microScalperSettingsTable.id, existing.id));
    }

    await db
      .delete(microScalperTradesTable)
      .where(eq(microScalperTradesTable.userId, this.userId));
    this.openTrades.clear();
    this.dailyPnl = 0;
    this.tradesThisHour = 0;

    console.log(`[MicroScalper:${this.userId}] Account reset to ${currency} ${startingBalance}`);
  }

  async getSettings(): Promise<ScalperSettings> {
    if (!this.settings) await this.loadSettings();
    return this.settings!;
  }

  async getStats(): Promise<ScalperStats> {
    try {
      const allTrades = await db
        .select()
        .from(microScalperTradesTable)
        .where(eq(microScalperTradesTable.userId, this.userId))
        .orderBy(desc(microScalperTradesTable.openedAt));

      const closedTrades = allTrades.filter((t) => t.status === "closed");
      const wins = closedTrades.filter((t) => (t.pnlPips || 0) > 0.1);
      const losses = closedTrades.filter((t) => (t.pnlPips || 0) < -0.1);
      const breakevens = closedTrades.filter(
        (t) => (t.pnlPips || 0) >= -0.1 && (t.pnlPips || 0) <= 0.1
      );

      const totalPnlMoney = closedTrades.reduce((sum, t) => sum + (t.pnlMoney || 0), 0);
      const totalPnlPips = closedTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);

      const avgWinPips =
        wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPips || 0), 0) / wins.length : 0;
      const avgLossPips =
        losses.length > 0
          ? Math.abs(losses.reduce((s, t) => s + (t.pnlPips || 0), 0) / losses.length)
          : 0;

      return {
        totalTrades: allTrades.length,
        openTrades: this.openTrades.size,
        wins: wins.length,
        losses: losses.length,
        breakevens: breakevens.length,
        winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
        totalPnlMoney: Math.round(totalPnlMoney * 100) / 100,
        totalPnlPips: Math.round(totalPnlPips * 10) / 10,
        avgWinPips: Math.round(avgWinPips * 10) / 10,
        avgLossPips: Math.round(avgLossPips * 10) / 10,
        tradesThisHour: this.tradesThisHour,
        dailyPnl: Math.round(this.dailyPnl * 100) / 100,
        isStreaming: this.isStreaming,
        streamingPairs: this.streamingPairs,
        lastTickTime: this.lastTickTime?.toISOString() || null,
      };
    } catch (error) {
      console.error(`[MicroScalper:${this.userId}] Error getting stats:`, error);
      return {
        totalTrades: 0,
        openTrades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        winRate: 0,
        totalPnlMoney: 0,
        totalPnlPips: 0,
        avgWinPips: 0,
        avgLossPips: 0,
        tradesThisHour: 0,
        dailyPnl: 0,
        isStreaming: this.isStreaming,
        streamingPairs: this.streamingPairs,
        lastTickTime: null,
      };
    }
  }

  async getRecentTrades(limit: number = 50): Promise<any[]> {
    try {
      const trades = await db
        .select()
        .from(microScalperTradesTable)
        .where(eq(microScalperTradesTable.userId, this.userId))
        .orderBy(desc(microScalperTradesTable.openedAt))
        .limit(limit);
      return trades;
    } catch (error) {
      console.error(`[MicroScalper:${this.userId}] Error getting recent trades:`, error);
      return [];
    }
  }

  getOpenTradesList(): MicroTrade[] {
    return Array.from(this.openTrades.values());
  }

  destroy(): void {
    this.stop(false);
    if (this.hourResetInterval) clearInterval(this.hourResetInterval);
    if (this.dailyResetInterval) clearInterval(this.dailyResetInterval);
    if (this.tickLogInterval) clearInterval(this.tickLogInterval);
  }
}

class MicroScalperManager {
  private instances: Map<string, UserScalperInstance> = new Map();

  async getOrCreateInstance(userId: string): Promise<UserScalperInstance> {
    let instance = this.instances.get(userId);
    if (!instance) {
      instance = new UserScalperInstance(userId);
      await instance.initialize();
      this.instances.set(userId, instance);
    }
    return instance;
  }

  getInstanceForUser(userId: string): UserScalperInstance | undefined {
    return this.instances.get(userId);
  }

  async startForUser(
    userId: string,
    apiKey: string,
    accountId: string,
    isLive: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    const instance = await this.getOrCreateInstance(userId);
    return instance.start(apiKey, accountId, isLive);
  }

  async stopForUser(userId: string, userInitiated: boolean = true): Promise<void> {
    const instance = this.instances.get(userId);
    if (instance) {
      await instance.stop(userInitiated);
    }
  }

  async getSettingsForUser(userId: string): Promise<ScalperSettings> {
    const instance = await this.getOrCreateInstance(userId);
    return instance.getSettings();
  }

  async getStatsForUser(userId: string): Promise<ScalperStats> {
    const instance = await this.getOrCreateInstance(userId);
    return instance.getStats();
  }

  async getRecentTradesForUser(userId: string, limit: number = 50): Promise<any[]> {
    const instance = await this.getOrCreateInstance(userId);
    return instance.getRecentTrades(limit);
  }

  async updateSettingsForUser(userId: string, updates: Partial<ScalperSettings>): Promise<void> {
    const instance = await this.getOrCreateInstance(userId);
    await instance.updateSettings(updates);
  }

  async resetAccountForUser(userId: string, startingBalance: number, currency: string): Promise<void> {
    const instance = await this.getOrCreateInstance(userId);
    await instance.resetAccount(startingBalance, currency);
  }

  isRunningForUser(userId: string): boolean {
    const instance = this.instances.get(userId);
    return instance?.isStreaming ?? false;
  }

  destroyForUser(userId: string): void {
    const instance = this.instances.get(userId);
    if (instance) {
      instance.destroy();
      this.instances.delete(userId);
    }
  }

  async autoRestartEnabled(): Promise<void> {
    try {
      const enabledSettings = await db
        .select()
        .from(microScalperSettingsTable)
        .where(eq(microScalperSettingsTable.isEnabled, true));

      if (enabledSettings.length === 0) {
        console.log("[MicroScalper] No users with scalper enabled for auto-restart");
        return;
      }

      console.log(`[MicroScalper] Auto-restart: found ${enabledSettings.length} user(s) with scalper enabled`);

      for (const settings of enabledSettings) {
        if (!settings.userId) continue;

        try {
          const [creds] = await db
            .select()
            .from(userOandaCredentials)
            .where(eq(userOandaCredentials.userId, settings.userId));

          if (!creds || !creds.isConnected || !creds.apiKey) {
            console.log(`[MicroScalper] Auto-restart: user ${settings.userId.slice(0, 8)}... has no OANDA credentials, skipping`);
            continue;
          }

          const isLive = creds.environment === "live";
          const result = await this.startForUser(settings.userId, creds.apiKey, creds.accountId, isLive);

          if (result.success) {
            console.log(`[MicroScalper] Auto-restart: successfully started for user ${settings.userId.slice(0, 8)}...`);
          } else {
            console.log(`[MicroScalper] Auto-restart: failed for user ${settings.userId.slice(0, 8)}...: ${result.error}`);
          }
        } catch (userError) {
          console.warn(`[MicroScalper] Auto-restart error for user ${settings.userId.slice(0, 8)}...:`, userError instanceof Error ? userError.message : "Unknown");
        }
      }
    } catch (error) {
      console.error("[MicroScalper] Auto-restart error:", error);
    }
  }
  getMomentumForInstrument(instrument: string): { movePips: number; threshold: number; spread: number; consistency: number; direction: 'buy' | 'sell' | 'neutral'; strength: number; timestamp: number } | null {
    const staleMs = 30_000;
    const now = Date.now();
    
    const instances = Array.from(this.instances.values());
    for (const instance of instances) {
      const reading = instance.momentumReadings.get(instrument);
      if (reading && (now - reading.timestamp) < staleMs) {
        const pct = reading.movePips / reading.threshold;
        const direction: 'buy' | 'sell' | 'neutral' = pct >= 0.6
          ? (reading.movePips > 0 ? 'buy' : 'sell')
          : 'neutral';
        return {
          ...reading,
          direction,
          strength: Math.min(pct, 2.0),
        };
      }
    }
    return null;
  }

  getAllMomentumReadings(): Map<string, { movePips: number; threshold: number; spread: number; direction: 'buy' | 'sell' | 'neutral'; strength: number; timestamp: number }> {
    const result = new Map<string, any>();
    const staleMs = 30_000;
    const now = Date.now();
    
    const allInstances = Array.from(this.instances.values());
    for (const instance of allInstances) {
      const entries = Array.from(instance.momentumReadings.entries());
      for (const [instrument, reading] of entries) {
        if ((now - reading.timestamp) < staleMs) {
          const pct = reading.movePips / reading.threshold;
          const dir: 'buy' | 'sell' | 'neutral' = pct >= 0.6
            ? (reading.movePips > 0 ? 'buy' : 'sell')
            : 'neutral';
          result.set(instrument, {
            movePips: reading.movePips,
            threshold: reading.threshold,
            spread: reading.spread,
            direction: dir,
            strength: Math.min(pct, 2.0),
            timestamp: reading.timestamp,
          });
        }
      }
    }
    return result;
  }
}

export const microScalperManager = new MicroScalperManager();
export { getSessionInfo };

interface BacktestCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  spread: number;
}

interface BacktestTrade {
  instrument: string;
  direction: "buy" | "sell";
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  pnlPips: number;
  exitReason: string;
  entryTime: string;
  exitTime: string;
  durationSeconds: number;
  momentumPips: number;
  spread: number;
  breakEvenApplied: boolean;
}

interface BacktestResult {
  instrument: string;
  profile: string;
  candleCount: number;
  periodStart: string;
  periodEnd: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  totalPnlPips: number;
  avgWinPips: number;
  avgLossPips: number;
  profitFactor: number;
  trades: BacktestTrade[];
  settings: {
    momentumThresholdPips: number;
    momentumWindowSeconds: number;
    takeProfitPips: number;
    trailingDistancePips: number;
    maxTradeSeconds: number;
    maxSpreadPips: number;
  };
}

async function fetchOandaBacktestCandles(
  instrument: string,
  count: number
): Promise<BacktestCandle[]> {
  const apiKey = process.env.OANDA_API_KEY;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  if (!apiKey || !accountId) throw new Error("OANDA credentials not configured");

  const oandaInstrument = convertInstrument(instrument);
  const url = `https://api-fxpractice.oanda.com/v3/instruments/${oandaInstrument}/candles?granularity=M1&count=${count}&price=BA`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OANDA candle fetch failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const candles: BacktestCandle[] = [];

  for (const c of data.candles || []) {
    if (!c.complete) continue;
    const bidMid = c.bid;
    const askMid = c.ask;
    if (!bidMid || !askMid) continue;

    const avgOpen = (parseFloat(bidMid.o) + parseFloat(askMid.o)) / 2;
    const avgHigh = (parseFloat(bidMid.h) + parseFloat(askMid.h)) / 2;
    const avgLow = (parseFloat(bidMid.l) + parseFloat(askMid.l)) / 2;
    const avgClose = (parseFloat(bidMid.c) + parseFloat(askMid.c)) / 2;

    const pipValue = PIP_VALUES[instrument] || 0.0001;
    const spread = (parseFloat(askMid.o) - parseFloat(bidMid.o)) / pipValue;

    candles.push({
      time: c.time,
      open: avgOpen,
      high: avgHigh,
      low: avgLow,
      close: avgClose,
      spread,
    });
  }

  return candles;
}

export async function backtestScalper(
  instruments: string[],
  settings: {
    momentumThresholdPips: number;
    momentumWindowSeconds: number;
    takeProfitPips: number;
    trailingDistancePips: number;
    maxTradeSeconds: number;
    maxSpreadPips: number;
  },
  candleCount: number = 500,
  profileName: string = "custom"
): Promise<BacktestResult[]> {
  const results: BacktestResult[] = [];
  const lookback = Math.max(2, Math.ceil(settings.momentumWindowSeconds / 60) + 1);

  for (const instrument of instruments) {
    console.log(`[ScalperBacktest] Fetching ${candleCount} M1 candles for ${instrument}...`);
    let candles: BacktestCandle[];
    try {
      candles = await fetchCachedCandles(instrument, candleCount);
    } catch (err) {
      console.error(`[ScalperBacktest] Failed to fetch candles for ${instrument}:`, err);
      continue;
    }

    if (candles.length < 20) {
      console.warn(`[ScalperBacktest] Not enough candles for ${instrument}: ${candles.length}`);
      continue;
    }

    const pipValue = PIP_VALUES[instrument] || 0.0001;
    const trades: BacktestTrade[] = [];
    const maxTradeDurationCandles = Math.ceil(settings.maxTradeSeconds / 60) + 1;

    for (let i = lookback; i < candles.length - maxTradeDurationCandles; i++) {
      const recent = candles.slice(i - lookback, i + 1);
      const firstCandle = recent[0];
      const lastCandle = recent[recent.length - 1];
      const currentSpread = lastCandle.spread;

      if (currentSpread > settings.maxSpreadPips) continue;

      const tpRatio = settings.takeProfitPips / currentSpread;
      if (currentSpread > 0 && tpRatio < 2.0) continue;

      const movePips = (lastCandle.close - firstCandle.open) / pipValue;
      if (Math.abs(movePips) < settings.momentumThresholdPips) continue;

      const direction: "buy" | "sell" = movePips > 0 ? "buy" : "sell";

      let directionalCandles = 0;
      for (let j = 1; j < recent.length; j++) {
        if (direction === "buy" && recent[j].close > recent[j - 1].close) directionalCandles++;
        else if (direction === "sell" && recent[j].close < recent[j - 1].close) directionalCandles++;
      }
      const consistency = directionalCandles / (recent.length - 1);
      if (consistency < 0.55) continue;

      const entryCandle = candles[i + 1];
      if (!entryCandle) continue;
      const entryPrice = entryCandle.open;
      const entryTime = new Date(entryCandle.time).getTime();

      const slPipsRaw = Math.min(Math.max(currentSpread + 0.8, 1.5), 3.5);
      const slDistance = slPipsRaw * pipValue;
      const tpDistance = settings.takeProfitPips * pipValue;

      const stopLoss = direction === "buy" ? entryPrice - slDistance : entryPrice + slDistance;
      const takeProfit = direction === "buy" ? entryPrice + tpDistance : entryPrice - tpDistance;

      let exitPrice = entryPrice;
      let exitReason = "time_expired";
      let exitTime = entryTime;
      let breakEvenApplied = false;
      let currentSL = stopLoss;
      let closed = false;

      for (let j = i + 1; j < Math.min(i + 1 + maxTradeDurationCandles, candles.length) && !closed; j++) {
        const c = candles[j];
        const candleTime = new Date(c.time).getTime();
        const tradeAgeSeconds = (candleTime - entryTime) / 1000;

        const pricePoints = direction === "buy"
          ? [c.open, c.low, c.high, c.close]
          : [c.open, c.high, c.low, c.close];

        for (const price of pricePoints) {
          const pnlPips = direction === "buy"
            ? (price - entryPrice) / pipValue
            : (entryPrice - price) / pipValue;

          if (
            (direction === "buy" && price <= currentSL) ||
            (direction === "sell" && price >= currentSL)
          ) {
            exitPrice = currentSL;
            exitReason = breakEvenApplied ? "trailing_stop" : "stop_loss";
            exitTime = candleTime;
            closed = true;
            break;
          }

          if (
            (direction === "buy" && price >= takeProfit) ||
            (direction === "sell" && price <= takeProfit)
          ) {
            exitPrice = takeProfit;
            exitReason = "take_profit";
            exitTime = candleTime;
            closed = true;
            break;
          }

          const beThreshold = 2.5;
          if (!breakEvenApplied && pnlPips >= beThreshold) {
            if (direction === "buy") {
              currentSL = entryPrice + 0.3 * pipValue;
            } else {
              currentSL = entryPrice - 0.3 * pipValue;
            }
            breakEvenApplied = true;
          }

          if (breakEvenApplied) {
            const trailingDistance = settings.trailingDistancePips * pipValue;
            if (direction === "buy") {
              const newStop = price - trailingDistance;
              if (newStop > currentSL) currentSL = newStop;
            } else {
              const newStop = price + trailingDistance;
              if (newStop < currentSL) currentSL = newStop;
            }
          }
        }

        if (!closed && tradeAgeSeconds >= settings.maxTradeSeconds) {
          exitPrice = c.close;
          exitReason = "time_expired";
          exitTime = candleTime;
          closed = true;
        }

        if (!closed && !breakEvenApplied && tradeAgeSeconds >= settings.maxTradeSeconds * 0.6) {
          const pnlNow = direction === "buy"
            ? (c.close - entryPrice) / pipValue
            : (entryPrice - c.close) / pipValue;
          if (pnlNow < 0.5) {
            exitPrice = c.close;
            exitReason = "stagnant_exit";
            exitTime = candleTime;
            closed = true;
          }
        }
      }

      if (!closed) {
        const lastC = candles[Math.min(i + maxTradeDurationCandles, candles.length - 1)];
        exitPrice = lastC.close;
        exitTime = new Date(lastC.time).getTime();
      }

      const finalPnl = direction === "buy"
        ? (exitPrice - entryPrice) / pipValue
        : (entryPrice - exitPrice) / pipValue;

      trades.push({
        instrument,
        direction,
        entryPrice,
        exitPrice,
        stopLoss,
        takeProfit,
        pnlPips: Math.round(finalPnl * 10) / 10,
        exitReason,
        entryTime: new Date(entryTime).toISOString(),
        exitTime: new Date(exitTime).toISOString(),
        durationSeconds: Math.round((exitTime - entryTime) / 1000),
        momentumPips: Math.round(Math.abs(movePips) * 10) / 10,
        spread: Math.round(currentSpread * 10) / 10,
        breakEvenApplied,
      });

      i += maxTradeDurationCandles;
    }

    const wins = trades.filter((t) => t.pnlPips > 0.1);
    const losses = trades.filter((t) => t.pnlPips < -0.1);
    const breakevens = trades.filter((t) => t.pnlPips >= -0.1 && t.pnlPips <= 0.1);
    const totalPnl = trades.reduce((s, t) => s + t.pnlPips, 0);
    const grossWin = wins.reduce((s, t) => s + t.pnlPips, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPips, 0));

    results.push({
      instrument,
      profile: profileName,
      candleCount: candles.length,
      periodStart: candles[0]?.time || "",
      periodEnd: candles[candles.length - 1]?.time || "",
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: trades.length > 0 ? Math.round((wins.length / trades.length) * 1000) / 10 : 0,
      totalPnlPips: Math.round(totalPnl * 10) / 10,
      avgWinPips: wins.length > 0 ? Math.round((grossWin / wins.length) * 10) / 10 : 0,
      avgLossPips: losses.length > 0 ? Math.round((grossLoss / losses.length) * 10) / 10 : 0,
      profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 999 : 0,
      trades,
      settings,
    });

    console.log(
      `[ScalperBacktest] ${instrument}: ${trades.length} trades, ${wins.length}W/${losses.length}L/${breakevens.length}BE, WR: ${
        trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(1) : 0
      }%, PnL: ${totalPnl.toFixed(1)} pips, PF: ${grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "N/A"}`
    );
  }

  return results;
}
