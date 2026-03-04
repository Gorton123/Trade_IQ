import { 
  instruments, 
  type Instrument, 
  type Timeframe,
  type Candle,
  type StrategyParameters,
  type OptimizationRun,
  type MarketAnalysis,
  type TradeSignal
} from "@shared/schema";
import { analyzeMarket } from "./analysis";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

const DATA_FILE_PATH = path.join(process.cwd(), "historical-data-cache.json");

const pipValues: Record<Instrument, number> = {
  "XAUUSD": 0.1,
  "XAGUSD": 0.01,
  "EURUSD": 0.0001,
  "GBPUSD": 0.0001,
  "USDCHF": 0.0001,
  "AUDUSD": 0.0001,
  "NZDUSD": 0.0001,
};

interface StoredHistoricalData {
  instrument: Instrument;
  timeframe: Timeframe;
  candles: Candle[];
  candleCount: number;
}

interface OptimizationTestResult {
  parameters: StrategyParameters;
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  avgWinPips: number;
  avgLossPips: number;
  expectancy: number;
  score: number;
}

interface OptimizationProgress {
  runId: string;
  timeframe: string;
  status: "pending" | "running" | "completed" | "failed";
  totalCombinations: number;
  completedCombinations: number;
  currentBest: OptimizationTestResult | null;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

class StrategyOptimizer {
  private historicalDataStore: Map<string, StoredHistoricalData> = new Map();
  private activeRuns: Map<string, OptimizationProgress> = new Map();

  constructor() {
    this.loadHistoricalData();
  }

  private loadHistoricalData(): void {
    try {
      if (fs.existsSync(DATA_FILE_PATH)) {
        const raw = fs.readFileSync(DATA_FILE_PATH, 'utf8');
        const data = JSON.parse(raw) as Record<string, StoredHistoricalData>;
        Object.entries(data).forEach(([key, value]) => {
          this.historicalDataStore.set(key, value);
        });
        console.log(`[StrategyOptimizer] Loaded ${Object.keys(data).length} historical datasets`);
      }
    } catch (error) {
      console.error('[StrategyOptimizer] Error loading historical data:', error);
    }
  }

  getAvailableData(): { timeframe: string; instruments: string[]; candleCount: number }[] {
    const byTimeframe: Map<string, { instruments: string[]; totalCandles: number }> = new Map();
    
    this.historicalDataStore.forEach((data, key) => {
      const [instrument, timeframe] = key.split('-');
      const existing = byTimeframe.get(timeframe) || { instruments: [], totalCandles: 0 };
      existing.instruments.push(instrument);
      existing.totalCandles += data.candleCount;
      byTimeframe.set(timeframe, existing);
    });

    return Array.from(byTimeframe.entries()).map(([timeframe, data]) => ({
      timeframe,
      instruments: data.instruments,
      candleCount: data.totalCandles,
    }));
  }

  private getParameterGrid(): StrategyParameters[] {
    const grid: StrategyParameters[] = [];
    
    const trendStrengths = [50, 55, 60, 65, 70, 75, 80];
    const confluences = [1, 2, 3];
    const slMultipliers = [1.0, 1.5, 2.0, 2.5];
    const rrRatios = [1.5, 2.0, 2.5, 3.0];
    const volatilities: ("low" | "medium" | "high")[] = ["medium", "high"];
    const mtfOptions = [true, false];

    for (const minTrendStrength of trendStrengths) {
      for (const minConfluence of confluences) {
        for (const slMultiplier of slMultipliers) {
          for (const rrRatio of rrRatios) {
            for (const maxVolatility of volatilities) {
              for (const requireMTFConfluence of mtfOptions) {
                grid.push({
                  minTrendStrength,
                  minConfluence,
                  slMultiplier,
                  rrRatio,
                  maxVolatility,
                  requireMTFConfluence,
                  minConfidence: 60,
                });
              }
            }
          }
        }
      }
    }

    return grid;
  }

  private generateSignalWithParams(
    analysis: MarketAnalysis,
    candles: Candle[],
    params: StrategyParameters
  ): { direction: "buy" | "sell"; confidence: number } | null {
    if (analysis.marketState === "high_risk" || analysis.marketState === "no_trade") {
      return null;
    }

    if (analysis.marketState === "ranging") {
      return null;
    }

    if (params.maxVolatility === "low" && analysis.volatility !== "low") {
      return null;
    }
    if (params.maxVolatility === "medium" && analysis.volatility === "high") {
      return null;
    }

    if (analysis.trend.strength < params.minTrendStrength) {
      return null;
    }

    let direction: "buy" | "sell" | null = null;
    let confluenceCount = 0;
    let confidence = 50;

    const trendStateAligned = 
      (analysis.marketState === "uptrend" && analysis.trend.direction === "up") ||
      (analysis.marketState === "downtrend" && analysis.trend.direction === "down");

    if (trendStateAligned) {
      confluenceCount += 2;
      direction = analysis.trend.direction === "up" ? "buy" : "sell";
    }

    const nearestSupport = analysis.supportLevels[0];
    const nearestResistance = analysis.resistanceLevels[0];
    
    if (direction === "buy" && nearestSupport && 
        analysis.currentPrice <= nearestSupport.price * 1.003) {
      confluenceCount++;
    }
    if (direction === "sell" && nearestResistance && 
        analysis.currentPrice >= nearestResistance.price * 0.997) {
      confluenceCount++;
    }

    if (analysis.volatility === "low") {
      confluenceCount++;
    }

    if (confluenceCount < params.minConfluence) {
      return null;
    }

    confidence = 55 + (confluenceCount * 8);
    
    if (confidence < params.minConfidence) {
      return null;
    }

    if (!direction) {
      return null;
    }

    return { direction, confidence };
  }

  private runBacktestWithParams(
    candles: Candle[],
    instrument: Instrument,
    timeframe: Timeframe,
    params: StrategyParameters
  ): OptimizationTestResult {
    const pipValue = pipValues[instrument];
    let wins = 0;
    let losses = 0;
    let totalWinPips = 0;
    let totalLossPips = 0;

    for (let i = 50; i < candles.length - 20; i++) {
      const historicalSlice = candles.slice(0, i + 1);
      const currentPrice = candles[i].close;

      const analysis = analyzeMarket(instrument, timeframe, historicalSlice, currentPrice);
      const signal = this.generateSignalWithParams(analysis, historicalSlice, params);

      if (!signal) continue;

      const atr = this.calculateATR(historicalSlice.slice(-14));
      const slPips = (atr * params.slMultiplier) / pipValue;
      const tpPips = slPips * params.rrRatio;

      const entryPrice = currentPrice;
      const slPrice = signal.direction === "buy" 
        ? entryPrice - (slPips * pipValue)
        : entryPrice + (slPips * pipValue);
      const tpPrice = signal.direction === "buy"
        ? entryPrice + (tpPips * pipValue)
        : entryPrice - (tpPips * pipValue);

      let outcome: "win" | "loss" | null = null;
      
      for (let j = i + 1; j < Math.min(i + 20, candles.length); j++) {
        const high = candles[j].high;
        const low = candles[j].low;

        if (signal.direction === "buy") {
          if (low <= slPrice) {
            outcome = "loss";
            break;
          }
          if (high >= tpPrice) {
            outcome = "win";
            break;
          }
        } else {
          if (high >= slPrice) {
            outcome = "loss";
            break;
          }
          if (low <= tpPrice) {
            outcome = "win";
            break;
          }
        }
      }

      if (outcome === "win") {
        wins++;
        totalWinPips += tpPips;
        i += 5;
      } else if (outcome === "loss") {
        losses++;
        totalLossPips += slPips;
        i += 5;
      }
    }

    const totalSignals = wins + losses;
    const winRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
    const avgWinPips = wins > 0 ? totalWinPips / wins : 0;
    const avgLossPips = losses > 0 ? totalLossPips / losses : 0;
    const profitFactor = totalLossPips > 0 ? totalWinPips / totalLossPips : 0;
    
    const expectancy = totalSignals > 0 
      ? (winRate / 100 * avgWinPips) - ((1 - winRate / 100) * avgLossPips)
      : 0;

    const score = this.calculateScore(winRate, profitFactor, expectancy, totalSignals);

    return {
      parameters: params,
      totalSignals,
      wins,
      losses,
      winRate,
      profitFactor,
      avgWinPips,
      avgLossPips,
      expectancy,
      score,
    };
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

  private calculateScore(winRate: number, profitFactor: number, expectancy: number, totalSignals: number): number {
    if (totalSignals < 10) return 0;
    
    const winRateScore = Math.min(winRate, 80) * 0.4;
    const pfScore = Math.min(profitFactor, 3) * 20 * 0.3;
    const expectancyScore = Math.min(Math.max(expectancy, 0), 50) * 0.2;
    const volumeScore = Math.min(totalSignals / 50, 1) * 10;

    return winRateScore + pfScore + expectancyScore + volumeScore;
  }

  async runOptimization(
    timeframe: Timeframe,
    instrumentFilter?: Instrument
  ): Promise<OptimizationProgress> {
    const runId = randomUUID();
    const parameterGrid = this.getParameterGrid();

    const progress: OptimizationProgress = {
      runId,
      timeframe,
      status: "running",
      totalCombinations: parameterGrid.length,
      completedCombinations: 0,
      currentBest: null,
      startedAt: new Date().toISOString(),
    };

    this.activeRuns.set(runId, progress);

    console.log(`[StrategyOptimizer] Starting optimization for ${timeframe} with ${parameterGrid.length} parameter combinations`);

    const instrumentsToTest = instrumentFilter 
      ? [instrumentFilter] 
      : instruments.filter(inst => this.historicalDataStore.has(`${inst}-${timeframe}`));

    if (instrumentsToTest.length === 0) {
      progress.status = "failed";
      progress.error = `No historical data available for ${timeframe}`;
      progress.completedAt = new Date().toISOString();
      return progress;
    }

    const results: OptimizationTestResult[] = [];

    for (const params of parameterGrid) {
      let aggregatedResult: OptimizationTestResult = {
        parameters: params,
        totalSignals: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        profitFactor: 0,
        avgWinPips: 0,
        avgLossPips: 0,
        expectancy: 0,
        score: 0,
      };

      for (const instrument of instrumentsToTest) {
        const key = `${instrument}-${timeframe}`;
        const data = this.historicalDataStore.get(key);
        
        if (!data || data.candles.length < 100) continue;

        const result = this.runBacktestWithParams(
          data.candles,
          instrument,
          timeframe,
          params
        );

        aggregatedResult.totalSignals += result.totalSignals;
        aggregatedResult.wins += result.wins;
        aggregatedResult.losses += result.losses;
        aggregatedResult.avgWinPips += result.avgWinPips * result.wins;
        aggregatedResult.avgLossPips += result.avgLossPips * result.losses;
      }

      if (aggregatedResult.totalSignals > 0) {
        aggregatedResult.winRate = (aggregatedResult.wins / aggregatedResult.totalSignals) * 100;
        aggregatedResult.avgWinPips = aggregatedResult.wins > 0 
          ? aggregatedResult.avgWinPips / aggregatedResult.wins 
          : 0;
        aggregatedResult.avgLossPips = aggregatedResult.losses > 0 
          ? aggregatedResult.avgLossPips / aggregatedResult.losses 
          : 0;
        
        const totalWinPips = aggregatedResult.avgWinPips * aggregatedResult.wins;
        const totalLossPips = aggregatedResult.avgLossPips * aggregatedResult.losses;
        aggregatedResult.profitFactor = totalLossPips > 0 ? totalWinPips / totalLossPips : 0;
        
        aggregatedResult.expectancy = 
          (aggregatedResult.winRate / 100 * aggregatedResult.avgWinPips) - 
          ((1 - aggregatedResult.winRate / 100) * aggregatedResult.avgLossPips);

        aggregatedResult.score = this.calculateScore(
          aggregatedResult.winRate,
          aggregatedResult.profitFactor,
          aggregatedResult.expectancy,
          aggregatedResult.totalSignals
        );

        results.push(aggregatedResult);
      }

      progress.completedCombinations++;
      
      if (!progress.currentBest || aggregatedResult.score > progress.currentBest.score) {
        progress.currentBest = aggregatedResult;
      }
    }

    results.sort((a, b) => b.score - a.score);

    progress.status = "completed";
    progress.completedAt = new Date().toISOString();
    progress.currentBest = results[0] || null;

    console.log(`[StrategyOptimizer] Optimization complete for ${timeframe}. Best win rate: ${progress.currentBest?.winRate.toFixed(1)}%`);

    return progress;
  }

  getOptimizationProgress(runId: string): OptimizationProgress | null {
    return this.activeRuns.get(runId) || null;
  }

  async getTopResults(
    timeframe: Timeframe,
    limit: number = 10
  ): Promise<OptimizationTestResult[]> {
    const progress = await this.runOptimization(timeframe);
    
    if (!progress.currentBest) {
      return [];
    }

    return [progress.currentBest];
  }

  getDefaultParameters(timeframe: Timeframe): StrategyParameters {
    const defaults: Record<string, StrategyParameters> = {
      "1m": {
        minTrendStrength: 45,
        minConfluence: 1,
        slMultiplier: 1.8,
        rrRatio: 1.2,
        maxVolatility: "medium",
        requireMTFConfluence: false,
        minConfidence: 50,
      },
      "5m": {
        minTrendStrength: 60,
        minConfluence: 2,
        slMultiplier: 1.5,
        rrRatio: 2.0,
        maxVolatility: "medium",
        requireMTFConfluence: true,
        minConfidence: 65,
      },
      "15m": {
        minTrendStrength: 60,
        minConfluence: 2,
        slMultiplier: 1.5,
        rrRatio: 2.0,
        maxVolatility: "medium",
        requireMTFConfluence: true,
        minConfidence: 65,
      },
      "1h": {
        minTrendStrength: 65,
        minConfluence: 2,
        slMultiplier: 1.5,
        rrRatio: 2.0,
        maxVolatility: "medium",
        requireMTFConfluence: true,
        minConfidence: 70,
      },
      "4h": {
        minTrendStrength: 65,
        minConfluence: 2,
        slMultiplier: 2.0,
        rrRatio: 2.5,
        maxVolatility: "high",
        requireMTFConfluence: false,
        minConfidence: 70,
      },
    };

    return defaults[timeframe] || defaults["1h"];
  }
}

export const strategyOptimizer = new StrategyOptimizer();
