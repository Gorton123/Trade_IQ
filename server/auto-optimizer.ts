import {
  instruments,
  type Instrument,
  type Timeframe,
  type Candle,
  type StrategyParameters,
  type MarketAnalysis,
  autoOptimizedProfiles,
  optimizationHistory,
  simulatedTradesTable,
  signalHistoryTable,
} from "@shared/schema";
import { analyzeMarket, updateActiveStrategyProfile, updateInstrumentProfile, clearApprovedInstruments, addRejectedInstrument, isInstrumentApprovedForTrading, isInstrumentRejected, detectRSIDivergence, calculateRSI } from "./analysis";
import { db } from "./db";
import { eq, and, desc, inArray, sql, gte, isNotNull } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const DATA_FILE_PATH = path.join(process.cwd(), "historical-data-cache.json");

const OPTIMIZATION_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"];

const MIN_WIN_RATE = 50;
const MIN_SIGNALS = 3;
const MIN_WALK_FORWARD_WIN_RATE = 42;
const PERFORMANCE_DECAY_THRESHOLD = 45;
const WALK_FORWARD_SPLIT = 0.7;
const OPTIMIZATION_INTERVAL_MS = 4 * 60 * 60 * 1000;

const SIM_PROVEN_MIN_TRADES = 20;
const SIM_PROVEN_MIN_WIN_RATE = 60;

const BLOCKED_INSTRUMENT_TIMEFRAMES = new Set([
  "XAUUSD_5m",
  "XAUUSD_15m",
]);

const METALS_DEFAULT_PARAMS: Record<string, StrategyParameters> = {
  XAGUSD: {
    minTrendStrength: 55,
    minConfluence: 1,
    slMultiplier: 3.5,
    rrRatio: 2.5,
    maxVolatility: "high",
    requireMTFConfluence: false,
    minConfidence: 55,
  },
  XAUUSD: {
    minTrendStrength: 60,
    minConfluence: 2,
    slMultiplier: 2.0,
    rrRatio: 2.5,
    maxVolatility: "high",
    requireMTFConfluence: false,
    minConfidence: 70,
  },
};

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

interface StoredHistoricalData {
  instrument: Instrument;
  timeframe: Timeframe;
  candles: Candle[];
  candleCount: number;
}

interface BacktestResult {
  params: StrategyParameters;
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgWinPips: number;
  avgLossPips: number;
  score: number;
  breakEvenSaves: number;
  partialCloses: number;
  timeExits: number;
}

interface TradeSimState {
  direction: "buy" | "sell";
  entryPrice: number;
  currentSL: number;
  tp1Price: number;
  tp2Price: number;
  slPips: number;
  tpPips: number;
  pipValue: number;
  breakEvenApplied: boolean;
  halfProfitLocked: boolean;
  tp1Hit: boolean;
  positionSize: number;
  entryATR: number;
  candlesSinceEntry: number;
  highestFavorable: number;
  lowestFavorable: number;
}

interface OptimizationStatus {
  isRunning: boolean;
  currentInstrument: string | null;
  currentTimeframe: string | null;
  progress: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalProfiles: number;
  activeProfiles: number;
  pausedProfiles: number;
}

interface PrecomputedPoint {
  analysis: MarketAnalysis;
  candleSlice: Candle[];
  orderFlowBias: "bullish" | "bearish" | "neutral";
  orderFlowStrength: number;
  hasDivergence: boolean;
  divergenceType: "bullish" | "bearish" | null;
  divergenceStrength: "strong" | "regular" | "hidden" | null;
  rsiValue: number | null;
  momentumScore: number;
}

class AutoOptimizer {
  private historicalData: Map<string, StoredHistoricalData> = new Map();
  private isRunning = false;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private decayTimer: ReturnType<typeof setInterval> | null = null;
  private currentInstrument: string | null = null;
  private currentTimeframe: string | null = null;
  private progress = 0;
  private lastRunAt: string | null = null;

  constructor() {
    this.loadHistoricalData();
  }

  private loadHistoricalData(): void {
    try {
      if (fs.existsSync(DATA_FILE_PATH)) {
        const raw = fs.readFileSync(DATA_FILE_PATH, "utf8");
        const data = JSON.parse(raw) as Record<string, StoredHistoricalData>;
        Object.entries(data).forEach(([key, value]) => {
          this.historicalData.set(key, value);
        });
        console.log(
          `[AutoOptimizer] Loaded ${Object.keys(data).length} historical datasets`
        );
      }
    } catch (error) {
      console.error("[AutoOptimizer] Error loading historical data:", error);
    }
  }

  reloadHistoricalData(): void {
    this.historicalData.clear();
    this.loadHistoricalData();
  }

  getDatasetKeys(): string[] {
    return Array.from(this.historicalData.keys());
  }

  async start(): Promise<void> {
    console.log("[AutoOptimizer] Starting automatic strategy optimization...");

    const profiles = await db.select().from(autoOptimizedProfiles);
    if (profiles.length === 0) {
      console.log(
        "[AutoOptimizer] No profiles found. Running initial optimization..."
      );
      await this.runFullOptimization("initial");
    } else {
      console.log(
        `[AutoOptimizer] Found ${profiles.length} existing profiles. Applying active ones...`
      );
      await this.applyActiveProfiles();
    }

    this.schedulerTimer = setInterval(async () => {
      if (!this.isRunning) {
        console.log("[AutoOptimizer] Scheduled optimization cycle starting...");
        await this.runFullOptimization("scheduled");
      }
    }, OPTIMIZATION_INTERVAL_MS);

    this.decayTimer = setInterval(async () => {
      if (!this.isRunning) {
        await this.checkPerformanceDecay();
      }
    }, 5 * 60 * 1000);

    console.log(
      `[AutoOptimizer] Scheduler active. Next optimization in ${OPTIMIZATION_INTERVAL_MS / 1000 / 60} minutes. Decay checks every 5 min.`
    );
  }

  stop(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    console.log("[AutoOptimizer] Stopped.");
  }

  async runFullOptimization(
    trigger: "scheduled" | "performance_decay" | "initial" | "manual"
  ): Promise<void> {
    if (this.isRunning) {
      console.log("[AutoOptimizer] Optimization already in progress, skipping.");
      return;
    }

    this.isRunning = true;
    this.progress = 0;
    const totalCombos =
      instruments.length * OPTIMIZATION_TIMEFRAMES.length;
    let completed = 0;

    console.log(
      `[AutoOptimizer] Starting ${trigger} optimization across ${totalCombos} instrument+timeframe combos`
    );

    for (const instrument of instruments) {
      for (const timeframe of OPTIMIZATION_TIMEFRAMES) {
        this.currentInstrument = instrument;
        this.currentTimeframe = timeframe;

        try {
          await this.optimizeInstrumentTimeframe(
            instrument,
            timeframe,
            trigger
          );
        } catch (error) {
          console.error(
            `[AutoOptimizer] Error optimizing ${instrument}-${timeframe}:`,
            error
          );
        }

        completed++;
        this.progress = Math.round((completed / totalCombos) * 100);

        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    this.isRunning = false;
    this.currentInstrument = null;
    this.currentTimeframe = null;
    this.lastRunAt = new Date().toISOString();
    this.progress = 100;

    await this.applyActiveProfiles();

    console.log(`[AutoOptimizer] ${trigger} optimization complete.`);
  }

  private async optimizeInstrumentTimeframe(
    instrument: Instrument,
    timeframe: Timeframe,
    trigger: string
  ): Promise<void> {
    const key = `${instrument}-${timeframe}`;
    const data = this.historicalData.get(key);

    if (!data || data.candles.length < 100) {
      await this.upsertProfile(instrument, timeframe, {
        status: "insufficient_data",
      });
      return;
    }

    const startTime = Date.now();
    const candles = data.candles;

    const splitIndex = Math.floor(candles.length * WALK_FORWARD_SPLIT);
    const trainingCandles = candles.slice(0, splitIndex);
    const validationCandles = candles.slice(splitIndex);

    if (trainingCandles.length < 80 || validationCandles.length < 30) {
      await this.upsertProfile(instrument, timeframe, {
        status: "insufficient_data",
      });
      return;
    }

    const trainingPoints = await this.precomputeEnhancedAnalyses(trainingCandles, instrument, timeframe);

    const paramGrid = this.getParameterGrid(instrument, timeframe);
    const results: BacktestResult[] = [];

    for (let i = 0; i < paramGrid.length; i++) {
      const result = this.backtestWithCache(
        trainingCandles,
        trainingPoints,
        instrument,
        paramGrid[i],
        timeframe
      );
      if (result.totalSignals >= MIN_SIGNALS) {
        results.push(result);
      }
      if (i % 40 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    results.sort((a, b) => b.score - a.score);

    console.log(
      `[AutoOptimizer] ${key}: ${results.length}/${paramGrid.length} combos produced ${MIN_SIGNALS}+ signals. Analysis points: ${trainingPoints.size}`
    );
    if (results.length > 0) {
      const topResult = results[0];
      console.log(
        `[AutoOptimizer] ${key}: Best combo: ${topResult.wins}W/${topResult.losses}L (${topResult.winRate.toFixed(1)}% WR, PF=${topResult.profitFactor.toFixed(2)}, ${topResult.totalSignals} signals, BE saves: ${topResult.breakEvenSaves}, partials: ${topResult.partialCloses}, time exits: ${topResult.timeExits})`
      );
    }

    const best = results[0];
    
    const simProvenCheck = await this.getSimulationProvenStrategies();
    const simKey = `${instrument}_${timeframe}`;
    const isSimProven = simProvenCheck.has(simKey);
    
    if (!best) {
      if (isSimProven) {
        const sp = simProvenCheck.get(simKey)!;
        console.log(`[AutoOptimizer] ${key}: Backtest found no results, but simulation-proven (${sp.winRate.toFixed(1)}% on ${sp.trades} trades) - keeping active`);
        await this.logHistory(instrument, timeframe, trigger, paramGrid.length, undefined, null, false, Date.now() - startTime);
        return;
      }
      await this.upsertProfile(instrument, timeframe, {
        status: "insufficient_data",
      });
      await this.logHistory(instrument, timeframe, trigger, paramGrid.length, undefined, null, false, Date.now() - startTime);
      return;
    }
    if (best.winRate < MIN_WIN_RATE) {
      if (isSimProven) {
        const sp = simProvenCheck.get(simKey)!;
        console.log(`[AutoOptimizer] ${key}: Backtest WR ${best.winRate.toFixed(1)}% below threshold, but simulation-proven (${sp.winRate.toFixed(1)}% on ${sp.trades} trades) - keeping active`);
        await this.logHistory(instrument, timeframe, trigger, paramGrid.length, best, null, false, Date.now() - startTime);
        return;
      }
      await this.upsertProfile(instrument, timeframe, {
        status: "paused",
        winRate: best.winRate,
        profitFactor: best.profitFactor,
        totalSignals: best.totalSignals,
        wins: best.wins,
        losses: best.losses,
        expectancy: best.expectancy,
        lastOptimizedAt: new Date().toISOString(),
      });
      await this.logHistory(instrument, timeframe, trigger, paramGrid.length, best, null, false, Date.now() - startTime);
      return;
    }

    const validationPoints = await this.precomputeEnhancedAnalyses(validationCandles, instrument, timeframe);
    const wfResult = this.backtestWithCache(
      validationCandles,
      validationPoints,
      instrument,
      best.params,
      timeframe
    );

    const wfWinRate =
      wfResult.totalSignals >= 3 ? wfResult.winRate : best.winRate * 0.9;

    let passesValidation = wfWinRate >= MIN_WALK_FORWARD_WIN_RATE;

    if (!passesValidation && best.profitFactor >= 1.5 && best.winRate >= MIN_WIN_RATE) {
      passesValidation = true;
    }
    if (!passesValidation && wfResult.totalSignals < 3 && best.profitFactor >= 1.3 && best.winRate >= 50) {
      passesValidation = true;
    }
    if (!passesValidation && best.winRate >= 60 && best.profitFactor >= 1.2) {
      passesValidation = true;
    }

    const confidenceScore = this.calculateConfidence(
      best,
      wfWinRate,
      wfResult.totalSignals
    );

    if (passesValidation && best.winRate >= MIN_WIN_RATE) {
      await this.upsertProfile(instrument, timeframe, {
        status: "active",
        minTrendStrength: best.params.minTrendStrength,
        minConfluence: best.params.minConfluence,
        slMultiplier: best.params.slMultiplier,
        rrRatio: best.params.rrRatio,
        maxVolatility: best.params.maxVolatility,
        requireMTFConfluence: best.params.requireMTFConfluence,
        minConfidence: best.params.minConfidence,
        winRate: best.winRate,
        profitFactor: best.profitFactor,
        expectancy: best.expectancy,
        totalSignals: best.totalSignals,
        wins: best.wins,
        losses: best.losses,
        confidenceScore,
        walkForwardWinRate: wfWinRate,
        lastOptimizedAt: new Date().toISOString(),
      });
    } else {
      if (isSimProven) {
        const sp = simProvenCheck.get(simKey)!;
        console.log(`[AutoOptimizer] ${key}: Walk-forward failed but simulation-proven (${sp.winRate.toFixed(1)}% on ${sp.trades} trades) - keeping active`);
      } else {
        await this.upsertProfile(instrument, timeframe, {
          status: "paused",
          winRate: best.winRate,
          profitFactor: best.profitFactor,
          walkForwardWinRate: wfWinRate,
          confidenceScore,
        });
      }
    }

    await this.logHistory(
      instrument,
      timeframe,
      trigger,
      paramGrid.length,
      best,
      wfWinRate,
      passesValidation && best.winRate >= MIN_WIN_RATE,
      Date.now() - startTime
    );
  }

  private getParameterGrid(instrument?: Instrument, timeframe?: Timeframe): StrategyParameters[] {
    const grid: StrategyParameters[] = [];
    const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
    const isSilver = instrument === "XAGUSD";
    const isGold = instrument === "XAUUSD";
    const isHigherTF = timeframe === "1h" || timeframe === "4h";
    const isMidTF = timeframe === "15m";
    const is1m = timeframe === "1m";

    const trendStrengths = is1m
      ? [35, 45, 55, 65, 75]
      : isMetal
      ? (isHigherTF ? [30, 40, 50, 60, 70] : [35, 45, 55, 65, 75])
      : [40, 50, 60, 70, 80];

    const confluences = [1, 2, 3];

    const slMultipliers = is1m
      ? [1.2, 1.5, 1.8, 2.0, 2.5]
      : isSilver
      ? (isHigherTF ? [0.8, 1.0, 1.2, 1.5, 1.8] : isMidTF ? [0.8, 1.0, 1.2, 1.5] : [0.8, 1.0, 1.2, 1.5])
      : isGold
      ? (isHigherTF ? [1.0, 1.2, 1.5, 1.8, 2.0] : isMidTF ? [0.8, 1.0, 1.2, 1.5] : [0.8, 1.0, 1.2, 1.5])
      : [1.0, 1.5, 2.0, 2.5];

    const rrRatios = is1m
      ? [1.0, 1.2, 1.5, 2.0]
      : isSilver
      ? [1.5, 2.0, 2.5]
      : isGold && isHigherTF
      ? [1.5, 2.0, 2.5, 3.0]
      : [1.5, 2.0, 2.5, 3.0];

    const volatilities: ("low" | "medium" | "high")[] = isMetal
      ? ["medium", "high"]
      : is1m
      ? ["medium", "high"]
      : ["low", "medium", "high"];

    const mtfOptions = [true, false];

    const minConfidenceOptions = (isMetal && isHigherTF) || is1m ? [50, 55] : [55];

    for (const minTrendStrength of trendStrengths) {
      for (const minConfluence of confluences) {
        for (const slMultiplier of slMultipliers) {
          for (const rrRatio of rrRatios) {
            for (const maxVolatility of volatilities) {
              for (const requireMTFConfluence of mtfOptions) {
                for (const minConfidence of minConfidenceOptions) {
                  grid.push({
                    minTrendStrength,
                    minConfluence,
                    slMultiplier,
                    rrRatio,
                    maxVolatility,
                    requireMTFConfluence,
                    minConfidence,
                  });
                }
              }
            }
          }
        }
      }
    }

    return grid;
  }

  private async precomputeEnhancedAnalyses(
    candles: Candle[],
    instrument: Instrument,
    timeframe: Timeframe
  ): Promise<Map<number, PrecomputedPoint>> {
    const points = new Map<number, PrecomputedPoint>();
    const range = candles.length - 70;
    const isMetalHigherTF = (instrument === "XAUUSD" || instrument === "XAGUSD") && (timeframe === "15m" || timeframe === "1h" || timeframe === "4h");
    const is1mTF = timeframe === "1m";
    const maxPoints = is1mTF ? 1000 : isMetalHigherTF ? 800 : 500;
    const targetPoints = Math.min(range, maxPoints);
    const step = Math.max(1, Math.floor(range / targetPoints));
    let count = 0;

    for (let i = 50; i < candles.length - 20; i += step) {
      const historicalSlice = candles.slice(Math.max(0, i - 200), i + 1);
      const currentPrice = candles[i].close;
      const analysis = analyzeMarket(instrument, timeframe, historicalSlice, currentPrice);

      const candleSlice = candles.slice(Math.max(0, i - 40), i + 1);

      const divergence = candleSlice.length >= 35
        ? detectRSIDivergence(candleSlice)
        : null;

      const closes = candleSlice.map(c => c.close);
      const rsiValues = calculateRSI(closes);
      const rsiValue = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

      const orderFlow = this.computeOrderFlow(candleSlice.slice(-10));

      const momentumScore = this.computeMomentum(candleSlice);

      points.set(i, {
        analysis,
        candleSlice,
        orderFlowBias: orderFlow.bias,
        orderFlowStrength: orderFlow.strength,
        hasDivergence: divergence !== null,
        divergenceType: divergence?.type ?? null,
        divergenceStrength: divergence?.strength ?? null,
        rsiValue,
        momentumScore,
      });

      count++;
      if (count % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return points;
  }

  private computeOrderFlow(recentCandles: Candle[]): { bias: "bullish" | "bearish" | "neutral"; strength: number } {
    if (recentCandles.length < 5) {
      return { bias: "neutral", strength: 50 };
    }

    let bullishVolume = 0;
    let bearishVolume = 0;

    for (const candle of recentCandles) {
      const bodySize = Math.abs(candle.close - candle.open);
      const isBullish = candle.close > candle.open;
      if (isBullish) {
        bullishVolume += bodySize;
      } else {
        bearishVolume += bodySize;
      }
    }

    const totalVolume = bullishVolume + bearishVolume;
    if (totalVolume === 0) return { bias: "neutral", strength: 50 };

    const bullishRatio = bullishVolume / totalVolume;

    if (bullishRatio > 0.62) {
      return { bias: "bullish", strength: Math.min(90, 50 + (bullishRatio - 0.5) * 100) };
    } else if (bullishRatio < 0.38) {
      return { bias: "bearish", strength: Math.min(90, 50 + (0.5 - bullishRatio) * 100) };
    }
    return { bias: "neutral", strength: 50 };
  }

  private computeMomentum(candles: Candle[]): number {
    if (candles.length < 20) return 0;

    const recent5 = candles.slice(-5);
    const older5 = candles.slice(-15, -10);

    const recentAvg = recent5.reduce((s, c) => s + c.close, 0) / recent5.length;
    const olderAvg = older5.reduce((s, c) => s + c.close, 0) / older5.length;

    const momentum = ((recentAvg - olderAvg) / olderAvg) * 100;
    return momentum;
  }

  private backtestWithCache(
    candles: Candle[],
    points: Map<number, PrecomputedPoint>,
    instrument: Instrument,
    params: StrategyParameters,
    timeframe?: Timeframe
  ): BacktestResult {
    const pipValue = pipValues[instrument] || 0.0001;
    let wins = 0;
    let losses = 0;
    let totalWinPips = 0;
    let totalLossPips = 0;
    let breakEvenSaves = 0;
    let partialCloses = 0;
    let timeExits = 0;

    const indices = Array.from(points.keys()).sort((a, b) => a - b);
    const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
    const is4h = timeframe === "4h";
    const is1m = timeframe === "1m";
    const tf = timeframe || "1h";
    const maxCandlesMap: Record<string, number> = { "1m": 60, "5m": 36, "15m": 24, "1h": 12, "4h": isMetal ? 55 : 24 };
    const stagnationCandlesMap: Record<string, number> = { "1m": 40, "5m": 24, "15m": 16, "1h": 8, "4h": isMetal ? 40 : 16 };
    const maxCandlesInTrade = maxCandlesMap[tf] || 40;
    const stagnationCandles = stagnationCandlesMap[tf] || 30;
    const stagnationThreshold = is1m ? 0.08 : isMetal ? 0.12 : 0.15;

    for (const i of indices) {
      const point = points.get(i)!;
      const signal = this.generateSignalWithParams(point, params, instrument);
      if (!signal) continue;

      const entryATR = this.calculateATR(candles.slice(Math.max(0, i - 13), i + 1));
      const slPips = (entryATR * params.slMultiplier) / pipValue;
      const tpPips = slPips * params.rrRatio;
      const entryPrice = candles[i].close;

      const trade: TradeSimState = {
        direction: signal.direction,
        entryPrice,
        currentSL: signal.direction === "buy"
          ? entryPrice - slPips * pipValue
          : entryPrice + slPips * pipValue,
        tp1Price: signal.direction === "buy"
          ? entryPrice + tpPips * pipValue
          : entryPrice - tpPips * pipValue,
        tp2Price: signal.direction === "buy"
          ? entryPrice + tpPips * 1.5 * pipValue
          : entryPrice - tpPips * 1.5 * pipValue,
        slPips,
        tpPips,
        pipValue,
        breakEvenApplied: false,
        halfProfitLocked: false,
        tp1Hit: false,
        positionSize: 1.0,
        entryATR,
        candlesSinceEntry: 0,
        highestFavorable: entryPrice,
        lowestFavorable: entryPrice,
      };

      let tradePnlPips = 0;
      let tradeResolved = false;

      for (let j = i + 1; j < Math.min(i + maxCandlesInTrade, candles.length); j++) {
        trade.candlesSinceEntry++;
        const high = candles[j].high;
        const low = candles[j].low;

        if (trade.direction === "buy") {
          trade.highestFavorable = Math.max(trade.highestFavorable, high);
        } else {
          trade.lowestFavorable = Math.min(trade.lowestFavorable, low);
        }

        const currentProfit = trade.direction === "buy"
          ? (candles[j].close - trade.entryPrice) / pipValue
          : (trade.entryPrice - candles[j].close) / pipValue;

        let hitSL = false;
        if (trade.direction === "buy") {
          hitSL = low <= trade.currentSL;
        } else {
          hitSL = high >= trade.currentSL;
        }

        if (hitSL) {
          const slPnlPips = trade.direction === "buy"
            ? (trade.currentSL - trade.entryPrice) / pipValue
            : (trade.entryPrice - trade.currentSL) / pipValue;

          if (trade.tp1Hit) {
            const tp1Realized = trade.tpPips * 0.5;
            const remainingPnl = slPnlPips * 0.5;
            tradePnlPips = tp1Realized + remainingPnl;
            wins++;
            totalWinPips += tradePnlPips;
          } else if (trade.breakEvenApplied) {
            tradePnlPips = slPnlPips;
            breakEvenSaves++;
            if (tradePnlPips > 1) {
              wins++;
              totalWinPips += tradePnlPips;
            } else {
              losses++;
              totalLossPips += Math.max(0.5, Math.abs(tradePnlPips));
            }
          } else {
            losses++;
            totalLossPips += trade.slPips;
          }
          tradeResolved = true;
          break;
        }

        let hitTP1 = false;
        if (!trade.tp1Hit) {
          if (trade.direction === "buy") {
            hitTP1 = high >= trade.tp1Price;
          } else {
            hitTP1 = low <= trade.tp1Price;
          }
        }

        if (hitTP1 && !trade.tp1Hit) {
          trade.tp1Hit = true;
          trade.positionSize = 0.5;
          partialCloses++;
          trade.currentSL = trade.entryPrice;
          trade.breakEvenApplied = true;
          continue;
        }

        if (trade.tp1Hit) {
          let hitTP2 = false;
          if (trade.direction === "buy") {
            hitTP2 = high >= trade.tp2Price;
          } else {
            hitTP2 = low <= trade.tp2Price;
          }
          if (hitTP2) {
            const tp1Realized = trade.tpPips * 0.5;
            const tp2Realized = (trade.tpPips * 1.5) * 0.5;
            tradePnlPips = tp1Realized + tp2Realized;
            wins++;
            totalWinPips += tradePnlPips;
            tradeResolved = true;
            break;
          }
        }

        const beThresholdMap: Record<string, number> = { "1m": 0.4, "5m": 0.4, "15m": 0.3, "1h": 0.3, "4h": 0.25 };
        const beThreshold = beThresholdMap[tf] || 0.3;
        const midLockTrigger = isMetal ? 0.65 : 0.60;
        const midLockPct = isMetal ? 0.25 : 0.35;
        const fullLockPct = isMetal ? 0.50 : 0.65;
        const atrMultMap: Record<string, number> = { "1m": 1.3, "5m": 1.3, "15m": 1.5, "1h": 1.5, "4h": 1.8 };
        const atrMult = (atrMultMap[tf] || 1.5) + (isMetal ? 0.2 : 0);

        if (!trade.breakEvenApplied && currentProfit >= trade.tpPips * beThreshold) {
          trade.currentSL = trade.entryPrice;
          trade.breakEvenApplied = true;
        }

        else if (trade.breakEvenApplied && !trade.halfProfitLocked && currentProfit >= trade.tpPips * midLockTrigger && currentProfit < trade.tpPips) {
          const lockDist = trade.tpPips * midLockPct * pipValue;
          trade.currentSL = trade.direction === "buy"
            ? trade.entryPrice + lockDist
            : trade.entryPrice - lockDist;
        }

        else if (trade.breakEvenApplied && !trade.halfProfitLocked && currentProfit >= trade.tpPips) {
          const lockDist = trade.tpPips * fullLockPct * pipValue;
          trade.currentSL = trade.direction === "buy"
            ? trade.entryPrice + lockDist
            : trade.entryPrice - lockDist;
          trade.halfProfitLocked = true;
        }

        if (trade.halfProfitLocked) {
          const slDistAtr = Math.abs(trade.entryPrice - (trade.direction === "buy" ? trade.entryPrice - trade.slPips * pipValue : trade.entryPrice + trade.slPips * pipValue));
          const atrTrailDist = slDistAtr * atrMult;
          let atrTrailSL: number;
          if (trade.direction === "buy") {
            atrTrailSL = trade.highestFavorable - atrTrailDist;
            if (atrTrailSL > trade.currentSL) {
              trade.currentSL = atrTrailSL;
            }
          } else {
            atrTrailSL = trade.lowestFavorable + atrTrailDist;
            if (atrTrailSL < trade.currentSL) {
              trade.currentSL = atrTrailSL;
            }
          }
        }

        const effectiveStagnationCandles = currentProfit > 0 && currentProfit < trade.tpPips * 0.25
          ? Math.round(stagnationCandles * 1.5)
          : stagnationCandles;

        if (trade.candlesSinceEntry >= effectiveStagnationCandles && !trade.tp1Hit && currentProfit > 0) {
          const maxMove = trade.direction === "buy"
            ? (trade.highestFavorable - trade.entryPrice) / pipValue
            : (trade.entryPrice - trade.lowestFavorable) / pipValue;

          if (maxMove < trade.tpPips * stagnationThreshold) {
            const exitPrice = candles[j].close;
            tradePnlPips = trade.direction === "buy"
              ? (exitPrice - trade.entryPrice) / pipValue
              : (trade.entryPrice - exitPrice) / pipValue;

            timeExits++;
            if (tradePnlPips > 1) {
              wins++;
              totalWinPips += tradePnlPips;
            } else {
              losses++;
              totalLossPips += Math.max(0.5, Math.abs(tradePnlPips));
            }
            tradeResolved = true;
            break;
          }
        }
      }

      if (!tradeResolved) {
        const exitCandle = Math.min(i + maxCandlesInTrade - 1, candles.length - 1);
        const exitPrice = candles[exitCandle].close;
        let exitPnl = trade.direction === "buy"
          ? (exitPrice - trade.entryPrice) / pipValue
          : (trade.entryPrice - exitPrice) / pipValue;

        if (trade.tp1Hit) {
          const tp1Realized = trade.tpPips * 0.5;
          exitPnl = tp1Realized + (exitPnl * 0.5);
        }
        tradePnlPips = exitPnl;

        timeExits++;
        if (tradePnlPips > 1) {
          wins++;
          totalWinPips += tradePnlPips;
        } else {
          losses++;
          totalLossPips += Math.max(0.5, Math.abs(tradePnlPips));
        }
      }
    }

    const totalSignals = wins + losses;
    const winRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
    const avgWinPips = wins > 0 ? totalWinPips / wins : 0;
    const avgLossPips = losses > 0 ? totalLossPips / losses : 0;
    const profitFactor = totalLossPips > 0 ? totalWinPips / totalLossPips : 0;
    const expectancy = totalSignals > 0
      ? (winRate / 100) * avgWinPips - (1 - winRate / 100) * avgLossPips
      : 0;
    const score = this.calculateScore(winRate, profitFactor, expectancy, totalSignals);

    return { params, totalSignals, wins, losses, winRate, profitFactor, expectancy, avgWinPips, avgLossPips, score, breakEvenSaves, partialCloses, timeExits };
  }

  private backtest(
    candles: Candle[],
    instrument: Instrument,
    timeframe: Timeframe,
    params: StrategyParameters
  ): BacktestResult {
    const points = new Map<number, PrecomputedPoint>();
    for (let i = 50; i < candles.length - 20; i++) {
      const historicalSlice = candles.slice(0, i + 1);
      const currentPrice = candles[i].close;
      const analysis = analyzeMarket(instrument, timeframe, historicalSlice, currentPrice);
      const candleSlice = candles.slice(Math.max(0, i - 40), i + 1);
      const divergence = candleSlice.length >= 35 ? detectRSIDivergence(candleSlice) : null;
      const closes = candleSlice.map(c => c.close);
      const rsiValues = calculateRSI(closes);
      const rsiValue = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
      const orderFlow = this.computeOrderFlow(candleSlice.slice(-10));
      const momentumScore = this.computeMomentum(candleSlice);

      points.set(i, {
        analysis,
        candleSlice,
        orderFlowBias: orderFlow.bias,
        orderFlowStrength: orderFlow.strength,
        hasDivergence: divergence !== null,
        divergenceType: divergence?.type ?? null,
        divergenceStrength: divergence?.strength ?? null,
        rsiValue,
        momentumScore,
      });
    }
    return this.backtestWithCache(candles, points, instrument, params, timeframe);
  }

  private generateSignalWithParams(
    point: PrecomputedPoint,
    params: StrategyParameters,
    instrument: Instrument
  ): { direction: "buy" | "sell"; confidence: number } | null {
    const { analysis } = point;
    const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";

    if (
      analysis.marketState === "high_risk" ||
      analysis.marketState === "no_trade"
    ) {
      return null;
    }

    if (params.maxVolatility === "low" && analysis.volatility !== "low") {
      return null;
    }
    if (params.maxVolatility === "medium" && analysis.volatility === "high") {
      if (!isMetal) return null;
    }

    let direction: "buy" | "sell" | null = null;
    let confluenceCount = 0;
    let confidence = 50;

    const strongTrend = analysis.trend.strength >= params.minTrendStrength;
    const veryStrongTrend = analysis.trend.strength >= 80;

    const trendStateAligned =
      (analysis.marketState === "uptrend" &&
        analysis.trend.direction === "up") ||
      (analysis.marketState === "downtrend" &&
        analysis.trend.direction === "down");

    if (trendStateAligned && strongTrend) {
      confluenceCount += 2;
      direction = analysis.trend.direction === "up" ? "buy" : "sell";
      confidence += 10;
    } else if (trendStateAligned) {
      confluenceCount += 1;
      direction = analysis.trend.direction === "up" ? "buy" : "sell";
      confidence += 5;
    } else if (
      strongTrend && (analysis.trend.direction === "up" || analysis.trend.direction === "down")
    ) {
      confluenceCount += 1;
      direction = analysis.trend.direction === "up" ? "buy" : "sell";
    }

    if (point.hasDivergence && point.divergenceType && point.divergenceStrength) {
      if (point.divergenceType === "bearish" && analysis.trend.direction === "down") {
        if (!direction || direction === "sell") {
          direction = "sell";
          confluenceCount += point.divergenceStrength === "strong" ? 2 : 1;
          confidence += point.divergenceStrength === "strong" ? 12 : 6;
        }
      } else if (point.divergenceType === "bullish" && analysis.trend.direction === "up") {
        if (!direction || direction === "buy") {
          direction = "buy";
          confluenceCount += point.divergenceStrength === "strong" ? 2 : 1;
          confidence += point.divergenceStrength === "strong" ? 12 : 6;
        }
      }
      if (point.divergenceType === "bearish" && direction === "buy" && strongTrend) {
        // skip counter-trend divergence
      } else if (point.divergenceType === "bullish" && direction === "sell" && strongTrend) {
        // skip counter-trend divergence
      }
    }

    if (!direction) {
      return null;
    }

    const nearestSupport = analysis.supportLevels[0];
    const nearestResistance = analysis.resistanceLevels[0];
    const srProximityThreshold = isMetal ? 1.005 : 1.005;

    if (
      direction === "buy" &&
      nearestSupport &&
      analysis.currentPrice <= nearestSupport.price * srProximityThreshold
    ) {
      confluenceCount++;
      confidence += 8;
    }
    if (
      direction === "sell" &&
      nearestResistance &&
      analysis.currentPrice >= nearestResistance.price * (2 - srProximityThreshold)
    ) {
      confluenceCount++;
      confidence += 8;
    }

    if (nearestSupport && nearestSupport.strength === "strong" && direction === "buy") {
      confluenceCount++;
      confidence += 5;
    }
    if (nearestResistance && nearestResistance.strength === "strong" && direction === "sell") {
      confluenceCount++;
      confidence += 5;
    }

    if (point.orderFlowBias === "bullish" && direction === "buy") {
      confluenceCount++;
      confidence += 6;
    } else if (point.orderFlowBias === "bearish" && direction === "sell") {
      confluenceCount++;
      confidence += 6;
    } else if (
      (point.orderFlowBias === "bullish" && direction === "sell") ||
      (point.orderFlowBias === "bearish" && direction === "buy")
    ) {
      confluenceCount -= 1;
      confidence -= 5;
    }

    const momentumAligned =
      (direction === "buy" && point.momentumScore > 0.1) ||
      (direction === "sell" && point.momentumScore < -0.1);
    const strongMomentum = Math.abs(point.momentumScore) > 0.3;

    if (momentumAligned) {
      confluenceCount++;
      confidence += strongMomentum ? 8 : 4;
    }

    if (point.rsiValue !== null) {
      if (direction === "buy" && point.rsiValue < 35) {
        confluenceCount++;
        confidence += 6;
      } else if (direction === "sell" && point.rsiValue > 65) {
        confluenceCount++;
        confidence += 6;
      }
      if (direction === "buy" && point.rsiValue > 80) {
        confluenceCount -= 1;
        confidence -= 8;
      } else if (direction === "sell" && point.rsiValue < 20) {
        confluenceCount -= 1;
        confidence -= 8;
      }
    }

    if (analysis.volatility === "low") {
      confluenceCount++;
      confidence += 3;
    }
    if (analysis.volatility === "medium" && trendStateAligned) {
      confluenceCount++;
      confidence += 2;
    }
    if (isMetal && analysis.volatility === "high" && trendStateAligned && strongTrend) {
      confluenceCount++;
      confidence += 4;
    }

    if (veryStrongTrend && trendStateAligned) {
      confidence += 5;
    }

    if (isMetal && veryStrongTrend && trendStateAligned) {
      confluenceCount++;
      confidence += 5;
    }

    if (isMetal && strongTrend && trendStateAligned && point.orderFlowStrength >= 60) {
      confluenceCount++;
      confidence += 4;
    }

    if (confluenceCount < params.minConfluence) {
      return null;
    }

    confidence = Math.max(40, Math.min(95, confidence));

    if (confidence < params.minConfidence) {
      return null;
    }

    return { direction, confidence };
  }

  private calculateATR(candles: Candle[]): number {
    if (candles.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      sum += tr;
    }
    return sum / (candles.length - 1);
  }

  private calculateScore(
    winRate: number,
    profitFactor: number,
    expectancy: number,
    totalSignals: number
  ): number {
    if (totalSignals < MIN_SIGNALS) return 0;

    const winRateScore = Math.min(winRate, 85) * 0.3;
    const pfScore = Math.min(profitFactor, 5) * 12 * 0.35;
    const expectancyScore = Math.min(Math.max(expectancy, 0), 50) * 0.2;
    const volumeScore = Math.min(totalSignals / 30, 1) * 10;
    const pfBonus = profitFactor >= 2.0 ? 8 : profitFactor >= 1.5 ? 4 : 0;
    const wrBonus = winRate >= 60 ? 5 : winRate >= 55 ? 3 : 0;

    return winRateScore + pfScore + expectancyScore + volumeScore + pfBonus + wrBonus;
  }

  private calculateConfidence(
    result: BacktestResult,
    wfWinRate: number,
    wfSignals: number
  ): number {
    let confidence = 0;

    if (result.winRate >= 70) confidence += 30;
    else if (result.winRate >= 60) confidence += 20;
    else if (result.winRate >= 55) confidence += 15;
    else if (result.winRate >= 50) confidence += 10;

    if (result.profitFactor >= 2) confidence += 25;
    else if (result.profitFactor >= 1.5) confidence += 18;
    else if (result.profitFactor >= 1.2) confidence += 10;
    else if (result.profitFactor >= 1) confidence += 5;

    if (result.totalSignals >= 50) confidence += 15;
    else if (result.totalSignals >= 30) confidence += 10;
    else if (result.totalSignals >= 10) confidence += 7;
    else if (result.totalSignals >= 5) confidence += 4;

    if (wfSignals >= 3) {
      if (wfWinRate >= 60) confidence += 20;
      else if (wfWinRate >= 50) confidence += 12;
      else if (wfWinRate >= 42) confidence += 5;
      else confidence -= 5;
    }

    const wfDelta = Math.abs(result.winRate - wfWinRate);
    if (wfDelta < 5) confidence += 10;
    else if (wfDelta < 10) confidence += 5;
    else if (wfDelta < 15) confidence += 2;
    else confidence -= 5;

    return Math.max(0, Math.min(100, confidence));
  }

  private async upsertProfile(
    instrument: Instrument,
    timeframe: Timeframe,
    updates: Record<string, unknown>
  ): Promise<void> {
    const existing = await db
      .select()
      .from(autoOptimizedProfiles)
      .where(
        and(
          eq(autoOptimizedProfiles.instrument, instrument),
          eq(autoOptimizedProfiles.timeframe, timeframe)
        )
      );

    const now = new Date().toISOString();

    if (existing.length > 0) {
      const currentCount = existing[0].optimizationCount || 0;
      await db
        .update(autoOptimizedProfiles)
        .set({
          ...updates,
          optimizationCount: currentCount + 1,
          updatedAt: now,
        } as Record<string, unknown>)
        .where(
          and(
            eq(autoOptimizedProfiles.instrument, instrument),
            eq(autoOptimizedProfiles.timeframe, timeframe)
          )
        );
    } else {
      await db.insert(autoOptimizedProfiles).values({
        instrument,
        timeframe,
        ...updates,
      } as typeof autoOptimizedProfiles.$inferInsert);
    }
  }

  private async logHistory(
    instrument: string,
    timeframe: string,
    trigger: string,
    paramsTested: number,
    best: BacktestResult | null | undefined,
    wfWinRate: number | null,
    applied: boolean,
    durationMs: number
  ): Promise<void> {
    try {
      await db.insert(optimizationHistory).values({
        instrument,
        timeframe,
        trigger,
        paramsTested,
        bestWinRate: best?.winRate ?? null,
        bestProfitFactor: best?.profitFactor ?? null,
        bestExpectancy: best?.expectancy ?? null,
        walkForwardWinRate: wfWinRate,
        applied,
        durationMs,
      });
    } catch (error) {
      console.error("[AutoOptimizer] Error logging history:", error);
    }
  }

  private async getSimulationProvenStrategies(): Promise<Map<string, { winRate: number; trades: number; wins: number; pnlPips: number }>> {
    const proven = new Map<string, { winRate: number; trades: number; wins: number; pnlPips: number }>();
    try {
      const closedStatuses = ["tp1_hit", "tp2_hit", "sl_hit", "expired"];
      const allSimTrades = await db
        .select()
        .from(simulatedTradesTable)
        .where(inArray(simulatedTradesTable.status, closedStatuses));

      const grouped = new Map<string, { wins: number; total: number; pnlPips: number }>();
      for (const trade of allSimTrades) {
        const key = `${trade.instrument}_${trade.timeframe}`;
        if (!grouped.has(key)) grouped.set(key, { wins: 0, total: 0, pnlPips: 0 });
        const g = grouped.get(key)!;
        g.total++;
        g.pnlPips += (trade.pnlPips || 0);
        if ((trade.pnlPips || 0) > 0) g.wins++;
      }

      const groupedEntries = Array.from(grouped.entries());
      for (const [key, stats] of groupedEntries) {
        if (stats.total >= SIM_PROVEN_MIN_TRADES) {
          const winRate = (stats.wins / stats.total) * 100;
          if (winRate >= SIM_PROVEN_MIN_WIN_RATE && stats.pnlPips > 0) {
            proven.set(key, { winRate, trades: stats.total, wins: stats.wins, pnlPips: stats.pnlPips });
          }
        }
      }
    } catch (error) {
      console.error("[AutoOptimizer] Error checking simulation-proven strategies:", error);
    }
    return proven;
  }

  async applyActiveProfiles(): Promise<void> {
    const profiles = await db.select().from(autoOptimizedProfiles);

    clearApprovedInstruments();

    const simProven = await this.getSimulationProvenStrategies();
    const simProvenEntries = Array.from(simProven.entries());
    if (simProvenEntries.length > 0) {
      console.log(`[AutoOptimizer] Found ${simProvenEntries.length} simulation-proven strategies:`);
      for (const [key, stats] of simProvenEntries) {
        console.log(`[AutoOptimizer]   ${key}: ${stats.winRate.toFixed(1)}% WR on ${stats.trades} trades (${stats.pnlPips.toFixed(1)} pips)`);
      }
    }

    const activeKeys = new Set<string>();

    const byTimeframe = new Map<
      string,
      { params: StrategyParameters; confidence: number; instrument: string }[]
    >();

    for (const profile of profiles) {
      if (profile.status !== "active") continue;

      const profileKey = `${profile.instrument}_${profile.timeframe}`;
      if (BLOCKED_INSTRUMENT_TIMEFRAMES.has(profileKey)) {
        console.log(`[AutoOptimizer] Blocked ${profile.instrument} ${profile.timeframe} - in blocklist (known poor performer)`);
        addRejectedInstrument(profile.instrument, profile.timeframe);
        continue;
      }

      if (profile.profitFactor !== null && profile.profitFactor < 1.0) {
        console.log(`[AutoOptimizer] Auto-pausing ${profile.instrument} ${profile.timeframe} - PF ${profile.profitFactor} < 1.0 (losing money)`);
        addRejectedInstrument(profile.instrument, profile.timeframe);
        await this.upsertProfile(profile.instrument as Instrument, profile.timeframe as Timeframe, {
          status: "paused",
          winRate: profile.winRate,
          profitFactor: profile.profitFactor,
        });
        continue;
      }

      if (profile.winRate !== null && profile.winRate < PERFORMANCE_DECAY_THRESHOLD) {
        console.log(`[AutoOptimizer] Auto-pausing ${profile.instrument} ${profile.timeframe} - WR ${profile.winRate.toFixed(1)}% < ${PERFORMANCE_DECAY_THRESHOLD}% threshold`);
        addRejectedInstrument(profile.instrument, profile.timeframe);
        await this.upsertProfile(profile.instrument as Instrument, profile.timeframe as Timeframe, {
          status: "paused",
          winRate: profile.winRate,
          profitFactor: profile.profitFactor,
        });
        continue;
      }

      const params: StrategyParameters = {
        minTrendStrength: profile.minTrendStrength,
        minConfluence: profile.minConfluence,
        slMultiplier: profile.slMultiplier,
        rrRatio: profile.rrRatio,
        maxVolatility: profile.maxVolatility as "low" | "medium" | "high",
        requireMTFConfluence: profile.requireMTFConfluence,
        minConfidence: profile.minConfidence,
      };

      activeKeys.add(profileKey);
      updateInstrumentProfile(profile.instrument, profile.timeframe, params);
      console.log(`[AutoOptimizer] Approved ${profile.instrument} ${profile.timeframe} for trading (WR: ${profile.winRate}%, PF: ${profile.profitFactor})`);

      const tf = profile.timeframe;
      if (!byTimeframe.has(tf)) {
        byTimeframe.set(tf, []);
      }
      byTimeframe.get(tf)!.push({
        params,
        confidence: profile.confidenceScore || 0,
        instrument: profile.instrument,
      });
    }

    for (const [key, stats] of simProvenEntries) {
      if (activeKeys.has(key)) continue;
      if (BLOCKED_INSTRUMENT_TIMEFRAMES.has(key)) {
        console.log(`[AutoOptimizer] SIM-PROVEN blocked ${key} - in blocklist (known poor performer)`);
        addRejectedInstrument(key.split("_")[0], key.split("_")[1]);
        continue;
      }

      if (stats.pnlPips <= 0) {
        console.log(`[AutoOptimizer] SIM-PROVEN rejected ${key} - negative total P&L (${stats.pnlPips.toFixed(1)} pips)`);
        addRejectedInstrument(key.split("_")[0], key.split("_")[1]);
        continue;
      }

      const [instrument, timeframe] = key.split("_");

      const dbProfile = profiles.find(p => p.instrument === instrument && p.timeframe === timeframe);
      if (dbProfile && dbProfile.profitFactor !== null && dbProfile.profitFactor < 1.0) {
        console.log(`[AutoOptimizer] SIM-PROVEN rejected ${key} - DB profile PF ${dbProfile.profitFactor.toFixed(2)} < 1.0 (backtest losing money)`);
        addRejectedInstrument(instrument, timeframe);
        continue;
      }
      if (dbProfile && dbProfile.winRate !== null && dbProfile.winRate < PERFORMANCE_DECAY_THRESHOLD) {
        console.log(`[AutoOptimizer] SIM-PROVEN rejected ${key} - DB profile WR ${dbProfile.winRate.toFixed(1)}% < ${PERFORMANCE_DECAY_THRESHOLD}% threshold`);
        addRejectedInstrument(instrument, timeframe);
        continue;
      }

      const recentForProfile = await db
        .select()
        .from(simulatedTradesTable)
        .where(
          and(
            eq(simulatedTradesTable.instrument, instrument),
            eq(simulatedTradesTable.timeframe, timeframe),
            inArray(simulatedTradesTable.status, ["tp1_hit", "tp2_hit", "sl_hit", "expired", "manual_close"]),
          )
        )
        .orderBy(desc(simulatedTradesTable.closedAt))
        .limit(10);

      if (recentForProfile.length >= 5) {
        const recentWins = recentForProfile.filter(t => (t.pnlPips || 0) > 0).length;
        const recentWinRate = (recentWins / recentForProfile.length) * 100;
        const recentTotalPnl = recentForProfile.reduce((s, t) => s + (t.pnlPips || 0), 0);
        const recentWinPips = recentForProfile.filter(t => (t.pnlPips || 0) > 0).reduce((s, t) => s + (t.pnlPips || 0), 0);
        const recentLossPips = Math.abs(recentForProfile.filter(t => (t.pnlPips || 0) < 0).reduce((s, t) => s + (t.pnlPips || 0), 0));
        const recentPF = recentLossPips > 0 ? recentWinPips / recentLossPips : recentWinPips > 0 ? 999 : 0;

        if (recentWinRate < PERFORMANCE_DECAY_THRESHOLD || recentPF < 1.0) {
          console.log(`[AutoOptimizer] SIM-PROVEN rejected ${key} - recent live performance poor (WR=${recentWinRate.toFixed(1)}%, PF=${recentPF.toFixed(2)}, ${recentForProfile.length} recent trades, ${recentTotalPnl.toFixed(1)} pips)`);
          addRejectedInstrument(instrument, timeframe);
          continue;
        }
      }

      const metalParams = METALS_DEFAULT_PARAMS[instrument];
      const params: StrategyParameters = metalParams || {
        minTrendStrength: 55,
        minConfluence: 1,
        slMultiplier: 2.0,
        rrRatio: 2.5,
        maxVolatility: "medium",
        requireMTFConfluence: false,
        minConfidence: 55,
      };

      updateInstrumentProfile(instrument, timeframe, params);
      console.log(`[AutoOptimizer] SIM-PROVEN: Force-approved ${instrument} ${timeframe} (${stats.winRate.toFixed(1)}% WR on ${stats.trades} live sim trades, ${stats.pnlPips.toFixed(1)} pips)`);

      await this.upsertProfile(instrument as Instrument, timeframe as Timeframe, {
        status: "active",
        minTrendStrength: params.minTrendStrength,
        minConfluence: params.minConfluence,
        slMultiplier: params.slMultiplier,
        rrRatio: params.rrRatio,
        maxVolatility: params.maxVolatility,
        requireMTFConfluence: params.requireMTFConfluence,
        minConfidence: params.minConfidence,
        winRate: stats.winRate,
        totalSignals: stats.trades,
        wins: stats.wins,
        losses: stats.trades - stats.wins,
        confidenceScore: Math.round(stats.winRate),
        lastOptimizedAt: new Date().toISOString(),
      });

      activeKeys.add(key);

      if (!byTimeframe.has(timeframe)) {
        byTimeframe.set(timeframe, []);
      }
      byTimeframe.get(timeframe)!.push({
        params,
        confidence: Math.round(stats.winRate),
        instrument,
      });
    }

    type ProfileEntry = { params: StrategyParameters; confidence: number; instrument: string };
    const entries = Array.from(byTimeframe.entries());
    for (const [timeframe, profileList] of entries) {
      if (profileList.length === 0) {
        updateActiveStrategyProfile(timeframe, null);
        continue;
      }

      profileList.sort((a: ProfileEntry, b: ProfileEntry) => b.confidence - a.confidence);
      const best = profileList[0];

      const avgParams: StrategyParameters = {
        minTrendStrength: Math.round(
          profileList.reduce((s: number, p: ProfileEntry) => s + p.params.minTrendStrength, 0) /
            profileList.length
        ),
        minConfluence: Math.round(
          profileList.reduce((s: number, p: ProfileEntry) => s + p.params.minConfluence, 0) /
            profileList.length
        ),
        slMultiplier:
          Math.round(
            (profileList.reduce((s: number, p: ProfileEntry) => s + p.params.slMultiplier, 0) /
              profileList.length) *
              10
          ) / 10,
        rrRatio:
          Math.round(
            (profileList.reduce((s: number, p: ProfileEntry) => s + p.params.rrRatio, 0) /
              profileList.length) *
              10
          ) / 10,
        maxVolatility: best.params.maxVolatility,
        requireMTFConfluence:
          profileList.filter((p: ProfileEntry) => p.params.requireMTFConfluence).length >
          profileList.length / 2,
        minConfidence: Math.round(
          profileList.reduce((s: number, p: ProfileEntry) => s + p.params.minConfidence, 0) /
            profileList.length
        ),
      };

      updateActiveStrategyProfile(timeframe, avgParams);
      console.log(
        `[AutoOptimizer] Applied consensus params for ${timeframe} from ${profileList.length} active profiles`
      );
    }

    const activeTimeframes = entries.map(([tf]) => tf);
    const allOptimizedTimeframes: Timeframe[] = OPTIMIZATION_TIMEFRAMES;
    for (const tf of allOptimizedTimeframes) {
      if (!activeTimeframes.includes(tf)) {
        updateActiveStrategyProfile(tf, null);
      }
    }
  }

  async getStatus(): Promise<OptimizationStatus> {
    const profiles = await db.select().from(autoOptimizedProfiles);
    const active = profiles.filter((p) => p.status === "active").length;
    const paused = profiles.filter(
      (p) => p.status === "paused" || p.status === "insufficient_data"
    ).length;

    let lastRun = this.lastRunAt;
    if (!lastRun) {
      const lastHistory = await db
        .select()
        .from(optimizationHistory)
        .orderBy(desc(optimizationHistory.createdAt))
        .limit(1);
      if (lastHistory.length > 0) {
        lastRun = lastHistory[0].createdAt;
      }
    }

    return {
      isRunning: this.isRunning,
      currentInstrument: this.currentInstrument,
      currentTimeframe: this.currentTimeframe,
      progress: this.progress,
      lastRunAt: lastRun,
      nextRunAt: lastRun
        ? new Date(
            new Date(lastRun).getTime() + OPTIMIZATION_INTERVAL_MS
          ).toISOString()
        : null,
      totalProfiles: profiles.length,
      activeProfiles: active,
      pausedProfiles: paused,
    };
  }

  async getProfiles(): Promise<
    Array<{
      instrument: string;
      timeframe: string;
      status: string;
      winRate: number | null;
      profitFactor: number | null;
      expectancy: number | null;
      confidenceScore: number | null;
      walkForwardWinRate: number | null;
      totalSignals: number | null;
      wins: number | null;
      losses: number | null;
      lastOptimizedAt: string | null;
      optimizationCount: number | null;
      params: StrategyParameters;
    }>
  > {
    const profiles = await db.select().from(autoOptimizedProfiles);

    return profiles.map((p) => ({
      instrument: p.instrument,
      timeframe: p.timeframe,
      status: p.status,
      winRate: p.winRate,
      profitFactor: p.profitFactor,
      expectancy: p.expectancy,
      confidenceScore: p.confidenceScore,
      walkForwardWinRate: p.walkForwardWinRate,
      totalSignals: p.totalSignals,
      wins: p.wins,
      losses: p.losses,
      lastOptimizedAt: p.lastOptimizedAt,
      optimizationCount: p.optimizationCount,
      params: {
        minTrendStrength: p.minTrendStrength,
        minConfluence: p.minConfluence,
        slMultiplier: p.slMultiplier,
        rrRatio: p.rrRatio,
        maxVolatility: p.maxVolatility as "low" | "medium" | "high",
        requireMTFConfluence: p.requireMTFConfluence,
        minConfidence: p.minConfidence,
      },
    }));
  }

  async getHistory(
    limit: number = 50
  ): Promise<
    Array<{
      instrument: string;
      timeframe: string;
      trigger: string;
      paramsTested: number;
      bestWinRate: number | null;
      bestProfitFactor: number | null;
      walkForwardWinRate: number | null;
      applied: boolean;
      durationMs: number | null;
      createdAt: string;
    }>
  > {
    const rows = await db
      .select()
      .from(optimizationHistory)
      .orderBy(desc(optimizationHistory.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      instrument: r.instrument,
      timeframe: r.timeframe,
      trigger: r.trigger,
      paramsTested: r.paramsTested,
      bestWinRate: r.bestWinRate,
      bestProfitFactor: r.bestProfitFactor,
      walkForwardWinRate: r.walkForwardWinRate,
      applied: r.applied,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    }));
  }

  async checkPerformanceDecay(): Promise<void> {
    const profiles = await db
      .select()
      .from(autoOptimizedProfiles)
      .where(eq(autoOptimizedProfiles.status, "active"));

    if (profiles.length === 0) return;

    const closedStatuses = ["tp1_hit", "tp2_hit", "sl_hit", "expired"];
    const recentTrades = await db
      .select()
      .from(simulatedTradesTable)
      .where(inArray(simulatedTradesTable.status, closedStatuses));

    for (const profile of profiles) {
      const profileTrades = recentTrades.filter(
        (t) =>
          t.instrument === profile.instrument &&
          t.timeframe === profile.timeframe
      );

      if (profileTrades.length < 5) continue;

      const recent = profileTrades.slice(-20);
      const wins = recent.filter(
        (t) => (t.pnlPips || 0) > 0
      ).length;
      const liveWinRate = (wins / recent.length) * 100;

      const winPips = recent.filter(t => (t.pnlPips || 0) > 0).reduce((s, t) => s + (t.pnlPips || 0), 0);
      const lossPips = Math.abs(recent.filter(t => (t.pnlPips || 0) < 0).reduce((s, t) => s + (t.pnlPips || 0), 0));
      const livePF = lossPips > 0 ? winPips / lossPips : winPips > 0 ? 999 : 0;

      if (liveWinRate < PERFORMANCE_DECAY_THRESHOLD || livePF < 1.0) {
        console.log(
          `[AutoOptimizer] Performance decay detected for ${profile.instrument}-${profile.timeframe}: live WR=${liveWinRate.toFixed(1)}%, PF=${livePF.toFixed(2)} (${wins}/${recent.length} trades) - pausing regardless of sim-proven status`
        );
        await this.upsertProfile(
          profile.instrument as Instrument,
          profile.timeframe as Timeframe,
          { status: "paused", winRate: liveWinRate, profitFactor: livePF }
        );
        await this.optimizeInstrumentTimeframe(
          profile.instrument as Instrument,
          profile.timeframe as Timeframe,
          "performance_decay"
        );
      }
    }
  }

  getOverallStats(): {
    avgWinRate: number;
    avgConfidence: number;
    totalActiveInstruments: number;
  } | null {
    return null;
  }

  async getOverallStatsAsync(): Promise<{
    avgWinRate: number;
    avgConfidence: number;
    totalActiveInstruments: number;
    totalSignals: number;
    totalWins: number;
    totalLosses: number;
  }> {
    const profiles = await db
      .select()
      .from(autoOptimizedProfiles)
      .where(eq(autoOptimizedProfiles.status, "active"));

    if (profiles.length === 0) {
      return {
        avgWinRate: 0,
        avgConfidence: 0,
        totalActiveInstruments: 0,
        totalSignals: 0,
        totalWins: 0,
        totalLosses: 0,
      };
    }

    const totalWinRate = profiles.reduce((s, p) => s + (p.winRate || 0), 0);
    const totalConfidence = profiles.reduce(
      (s, p) => s + (p.confidenceScore || 0),
      0
    );
    const totalSignals = profiles.reduce(
      (s, p) => s + (p.totalSignals || 0),
      0
    );
    const totalWins = profiles.reduce((s, p) => s + (p.wins || 0), 0);
    const totalLosses = profiles.reduce((s, p) => s + (p.losses || 0), 0);

    return {
      avgWinRate: totalWinRate / profiles.length,
      avgConfidence: totalConfidence / profiles.length,
      totalActiveInstruments: profiles.length,
      totalSignals,
      totalWins,
      totalLosses,
    };
  }
}

export const autoOptimizer = new AutoOptimizer();

export interface RealityCheckStats {
  signalWins: number;
  signalLosses: number;
  signalTotal: number;
  signalWR: number;
  tradeWins: number;
  tradeLosses: number;
  tradeTotal: number;
  tradeWR: number;
  tradePips: number;
  combinedWR: number;
  allTimeTotal: number;
  allTimeWR: number;
  isProven: boolean;
  minThreshold: number;
  action: "kill" | "rescue" | "none";
}

const realityCheckCache: {
  data: Map<string, RealityCheckStats>;
  lastRefreshed: number;
} = { data: new Map(), lastRefreshed: 0 };

const REALITY_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const REALITY_CHECK_WINDOW_DAYS = 14;
const REALITY_CHECK_KILL_WR = 40;
const REALITY_CHECK_RESCUE_WR = 55;
const REALITY_CHECK_NORMAL_THRESHOLD = 10;
const REALITY_CHECK_PROVEN_THRESHOLD = 15;
const REALITY_CHECK_PROVEN_ALL_TIME_MIN = 50;
const REALITY_CHECK_PROVEN_ALL_TIME_WR = 60;

let realityCheckTimer: ReturnType<typeof setInterval> | null = null;

export function getRealityCheckStats(): Map<string, RealityCheckStats> {
  return realityCheckCache.data;
}

export function getRealityCheckStatsForCombo(instrument: string, timeframe: string): RealityCheckStats | undefined {
  return realityCheckCache.data.get(`${instrument}_${timeframe}`);
}

export async function runRealityCheck(): Promise<void> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - REALITY_CHECK_WINDOW_DAYS);
    const cutoffStr = cutoffDate.toISOString();

    const [signalRows, tradeRows, allTimeSignalRows, allTimeTradeRows] = await Promise.all([
      db
        .select({
          instrument: signalHistoryTable.instrument,
          timeframe: signalHistoryTable.timeframe,
          outcome: signalHistoryTable.outcome,
        })
        .from(signalHistoryTable)
        .where(and(
          isNotNull(signalHistoryTable.outcome),
          gte(signalHistoryTable.generatedAt, cutoffStr)
        )),
      db
        .select({
          instrument: simulatedTradesTable.instrument,
          timeframe: simulatedTradesTable.timeframe,
          status: simulatedTradesTable.status,
          pnlPips: simulatedTradesTable.pnlPips,
          closedAt: simulatedTradesTable.closedAt,
        })
        .from(simulatedTradesTable)
        .where(and(
          sql`${simulatedTradesTable.status} != 'open'`,
          gte(simulatedTradesTable.closedAt, cutoffStr)
        )),
      db
        .select({
          instrument: signalHistoryTable.instrument,
          timeframe: signalHistoryTable.timeframe,
          outcome: signalHistoryTable.outcome,
        })
        .from(signalHistoryTable)
        .where(isNotNull(signalHistoryTable.outcome)),
      db
        .select({
          instrument: simulatedTradesTable.instrument,
          timeframe: simulatedTradesTable.timeframe,
          pnlPips: simulatedTradesTable.pnlPips,
        })
        .from(simulatedTradesTable)
        .where(sql`${simulatedTradesTable.status} != 'open'`),
    ]);

    const signalStats = new Map<string, { wins: number; losses: number; total: number }>();
    for (const row of signalRows) {
      const key = `${row.instrument}_${row.timeframe}`;
      if (!signalStats.has(key)) signalStats.set(key, { wins: 0, losses: 0, total: 0 });
      const s = signalStats.get(key)!;
      s.total++;
      if (row.outcome === "tp1_hit" || row.outcome === "tp2_hit" || row.outcome === "managed_close") {
        s.wins++;
      } else if (row.outcome === "sl_hit") {
        s.losses++;
      }
    }

    const tradeStats = new Map<string, { wins: number; losses: number; total: number; pips: number }>();
    for (const row of tradeRows) {
      const key = `${row.instrument}_${row.timeframe}`;
      if (!tradeStats.has(key)) tradeStats.set(key, { wins: 0, losses: 0, total: 0, pips: 0 });
      const s = tradeStats.get(key)!;
      s.total++;
      const pips = row.pnlPips || 0;
      s.pips += pips;
      if (pips > 0) {
        s.wins++;
      } else {
        s.losses++;
      }
    }

    const allTimeStats = new Map<string, { wins: number; total: number }>();
    for (const row of allTimeSignalRows) {
      const key = `${row.instrument}_${row.timeframe}`;
      if (!allTimeStats.has(key)) allTimeStats.set(key, { wins: 0, total: 0 });
      const s = allTimeStats.get(key)!;
      s.total++;
      if (row.outcome === "tp1_hit" || row.outcome === "tp2_hit" || row.outcome === "managed_close") {
        s.wins++;
      }
    }

    const allTimeTradeStats = new Map<string, { wins: number; total: number; pips: number }>();
    for (const row of allTimeTradeRows) {
      const key = `${row.instrument}_${row.timeframe}`;
      if (!allTimeTradeStats.has(key)) allTimeTradeStats.set(key, { wins: 0, total: 0, pips: 0 });
      const s = allTimeTradeStats.get(key)!;
      s.total++;
      const pips = row.pnlPips || 0;
      s.pips += pips;
      if (pips > 0) s.wins++;
    }

    const allKeys = new Set([...signalStats.keys(), ...tradeStats.keys()]);
    const results = new Map<string, RealityCheckStats>();
    const actions: string[] = [];

    for (const key of allKeys) {
      const sig = signalStats.get(key) || { wins: 0, losses: 0, total: 0 };
      const trd = tradeStats.get(key) || { wins: 0, losses: 0, total: 0, pips: 0 };
      const allTime = allTimeStats.get(key) || { wins: 0, total: 0 };
      const allTimeTrd = allTimeTradeStats.get(key) || { wins: 0, total: 0, pips: 0 };

      const sigWR = sig.total > 0 ? (sig.wins / sig.total) * 100 : 0;
      const trdWR = trd.total > 0 ? (trd.wins / trd.total) * 100 : 0;
      const allTimeWR = allTime.total > 0 ? (allTime.wins / allTime.total) * 100 : 0;

      let combinedWR: number;
      if (sig.total > 0 && trd.total > 0) {
        if (trd.total < 5) {
          combinedWR = sigWR * 0.5 + trdWR * 0.5;
        } else {
          combinedWR = sigWR * 0.3 + trdWR * 0.7;
        }
      } else if (sig.total > 0) {
        combinedWR = sigWR;
      } else {
        combinedWR = trdWR;
      }

      const isProven = allTime.total >= REALITY_CHECK_PROVEN_ALL_TIME_MIN && allTimeWR >= REALITY_CHECK_PROVEN_ALL_TIME_WR;
      const minThreshold = isProven ? REALITY_CHECK_PROVEN_THRESHOLD : REALITY_CHECK_NORMAL_THRESHOLD;

      const totalDataPoints = Math.max(sig.total, trd.total);
      let action: "kill" | "rescue" | "none" = "none";
      const tradesSolidProfit = trd.total >= 5 && trdWR >= 50 && trd.pips > 0;
      const allTimeTrdWR = allTimeTrd.total > 0 ? (allTimeTrd.wins / allTimeTrd.total) * 100 : 0;
      const allTimeTradeProven = allTimeTrd.total >= 10 && (allTimeTrdWR >= 60 || allTimeTrd.pips > 500);
      const allTimeSignalProven = allTime.total >= 10 && allTimeWR >= 60;
      const protectedFromKill = tradesSolidProfit || allTimeTradeProven || allTimeSignalProven;

      if (totalDataPoints >= minThreshold) {
        if (combinedWR < REALITY_CHECK_KILL_WR && !protectedFromKill) {
          action = "kill";
        } else if (combinedWR < REALITY_CHECK_KILL_WR && protectedFromKill) {
          action = "rescue";
        } else if (combinedWR >= REALITY_CHECK_RESCUE_WR && trd.pips > 0) {
          action = "rescue";
        } else if (combinedWR >= REALITY_CHECK_RESCUE_WR && trd.total === 0 && sig.total >= minThreshold) {
          action = "rescue";
        }
      }

      results.set(key, {
        signalWins: sig.wins,
        signalLosses: sig.losses,
        signalTotal: sig.total,
        signalWR: Math.round(sigWR),
        tradeWins: trd.wins,
        tradeLosses: trd.losses,
        tradeTotal: trd.total,
        tradeWR: Math.round(trdWR),
        tradePips: Math.round(trd.pips),
        combinedWR: Math.round(combinedWR),
        allTimeTotal: allTime.total,
        allTimeWR: Math.round(allTimeWR),
        isProven,
        minThreshold,
        action,
      });

      const [instrument, timeframe] = key.split("_");
      if (action === "kill") {
        const wasApproved = isInstrumentApprovedForTrading(instrument, timeframe);
        addRejectedInstrument(instrument, timeframe);
        if (wasApproved) {
          updateInstrumentProfile(instrument, timeframe, null);
        }
        actions.push(`[RealityCheck] KILLED ${key} (signal WR ${Math.round(sigWR)}% from ${sig.total} signals, trade WR ${Math.round(trdWR)}% from ${trd.total} trades, combined ${Math.round(combinedWR)}%, ${trd.pips > 0 ? "+" : ""}${Math.round(trd.pips)} pips — ${REALITY_CHECK_WINDOW_DAYS}d window, threshold ${minThreshold}${isProven ? " [proven]" : ""}, allTimeSigWR=${Math.round(allTimeWR)}%/${allTime.total}sig)`);
      } else if (action === "rescue") {
        const wasRejected = isInstrumentRejected(instrument, timeframe);
        const wasApproved = isInstrumentApprovedForTrading(instrument, timeframe);
        if (wasRejected || !wasApproved) {
          const existingProfile = await db
            .select()
            .from(autoOptimizedProfiles)
            .where(and(
              eq(autoOptimizedProfiles.instrument, instrument),
              eq(autoOptimizedProfiles.timeframe, timeframe),
            ))
            .orderBy(desc(autoOptimizedProfiles.confidenceScore))
            .limit(1);

          if (existingProfile.length > 0) {
            const profile = existingProfile[0];
            const params: StrategyParameters = {
              minConfluence: profile.minConfluence ?? 3,
              minTrendStrength: profile.minTrendStrength ?? 55,
              slMultiplier: profile.slMultiplier ?? 1.5,
              tpRatio: profile.tpRatio ?? 2.0,
            };
            updateInstrumentProfile(instrument, timeframe, params);
            if (profile.status !== "active") {
              await db.update(autoOptimizedProfiles)
                .set({ status: "active" })
                .where(eq(autoOptimizedProfiles.id, profile.id));
            }
          }
          const protectReason = allTimeTradeProven ? `all-time trade WR ${Math.round(allTimeTrdWR)}% from ${allTimeTrd.total} trades, +${Math.round(allTimeTrd.pips)}p` : allTimeSignalProven ? `all-time signal WR ${Math.round(allTimeWR)}% from ${allTime.total} signals` : (tradesSolidProfit ? `14d trade profit override` : "");
          actions.push(`[RealityCheck] RESCUED ${key} (signal WR ${Math.round(sigWR)}% from ${sig.total} signals, trade WR ${Math.round(trdWR)}% from ${trd.total} trades, combined ${Math.round(combinedWR)}%, ${trd.pips > 0 ? "+" : ""}${Math.round(trd.pips)} pips — ${REALITY_CHECK_WINDOW_DAYS}d window${isProven ? " [proven]" : ""}${protectReason ? ` [PROTECTED: ${protectReason}]` : ""})`);
        }
      }
    }

    realityCheckCache.data = results;
    realityCheckCache.lastRefreshed = Date.now();

    if (actions.length > 0) {
      for (const a of actions) console.log(a);
    }
    console.log(`[RealityCheck] Completed: ${results.size} combos evaluated, ${actions.length} actions taken (${REALITY_CHECK_WINDOW_DAYS}d window)`);
  } catch (err) {
    console.error("[RealityCheck] Error:", err);
  }
}

export function startRealityCheckTimer(): void {
  if (realityCheckTimer) return;
  realityCheckTimer = setInterval(async () => {
    await runRealityCheck();
  }, REALITY_CHECK_INTERVAL_MS);
  console.log(`[RealityCheck] Timer started: runs every ${REALITY_CHECK_INTERVAL_MS / 1000 / 60} minutes`);
}

export function stopRealityCheckTimer(): void {
  if (realityCheckTimer) {
    clearInterval(realityCheckTimer);
    realityCheckTimer = null;
  }
}
