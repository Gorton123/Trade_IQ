import { storage } from "./storage";
import { instruments, type Instrument, type Timeframe, type TradeSignal, type MarketAnalysis } from "@shared/schema";

type MarketRegime = "trending" | "ranging" | "volatile";
type TradingSession = "asian" | "london" | "new_york";

interface RegimeClassification {
  regime: MarketRegime;
  confidence: number;
  trendStrength: number;
  atrRatio: number;
  lastUpdated: string;
}

interface PerformanceRecord {
  wins: number;
  losses: number;
  totalPips: number;
  recentWins: number;
  recentLosses: number;
}

interface FilterDecision {
  allowed: boolean;
  reason: string;
  adjustedConfidence?: number;
}

class StrategyIntelligence {
  private regimeCache: Map<string, RegimeClassification> = new Map();
  private performanceByCombo: Map<string, PerformanceRecord> = new Map();
  private performanceBySession: Map<string, PerformanceRecord> = new Map();
  private exhaustionCooldown: Map<string, number> = new Map();
  private lastRegimeUpdate: number = 0;
  private lastPerformanceSync: number = 0;
  private regimeInterval: ReturnType<typeof setInterval> | null = null;

  private readonly REGIME_UPDATE_INTERVAL_MS = 15 * 60 * 1000;
  private readonly MIN_TRADES_FOR_SUPPRESSION = 10;
  private readonly MIN_SESSION_TRADES = 5;
  private readonly RECENCY_WINDOW_DAYS = 7;
  private readonly FULL_WINDOW_DAYS = 14;
  private readonly EXHAUSTION_COOLDOWN_CYCLES = 2;

  start(): void {
    console.log("[StrategyIntel] Starting AI Strategy Intelligence System (15-min updates)");
    this.updateAllRegimes();
    this.syncPerformanceData();

    this.regimeInterval = setInterval(() => {
      this.updateAllRegimes();
      this.syncPerformanceData();
    }, this.REGIME_UPDATE_INTERVAL_MS);
  }

  stop(): void {
    if (this.regimeInterval) {
      clearInterval(this.regimeInterval);
      this.regimeInterval = null;
    }
    console.log("[StrategyIntel] Stopped");
  }

  private classifyRegime(analysis: MarketAnalysis): RegimeClassification {
    const trendStrength = analysis.trend.strength;
    const volatility = analysis.volatility;
    const marketState = analysis.marketState;

    let regime: MarketRegime = "ranging";
    let confidence = 50;

    if (volatility === "high" || marketState === "high_risk") {
      regime = "volatile";
      confidence = volatility === "high" ? 75 : 65;
    } else if (
      (marketState === "uptrend" || marketState === "downtrend") &&
      trendStrength >= 60
    ) {
      regime = "trending";
      confidence = Math.min(90, 50 + trendStrength * 0.5);
    } else if (marketState === "ranging" || trendStrength < 45) {
      regime = "ranging";
      confidence = trendStrength < 35 ? 80 : 60;
    }

    return {
      regime,
      confidence,
      trendStrength,
      atrRatio: volatility === "high" ? 1.5 : volatility === "medium" ? 1.0 : 0.6,
      lastUpdated: new Date().toISOString(),
    };
  }

  private updateAllRegimes(): void {
    let classified = 0;
    const regimeSummary: Record<MarketRegime, string[]> = {
      trending: [],
      ranging: [],
      volatile: [],
    };

    for (const inst of instruments) {
      const keyTimeframes: Timeframe[] = ["1m", "5m", "15m", "1h", "4h"];
      for (const tf of keyTimeframes) {
        const analysis = storage.getCachedAnalysis(inst, tf);
        if (!analysis) continue;

        const classification = this.classifyRegime(analysis);
        const key = `${inst}_${tf}`;
        this.regimeCache.set(key, classification);
        classified++;
        regimeSummary[classification.regime].push(`${inst}/${tf}`);

        this.checkExhaustion(inst, tf, analysis);
      }
    }

    this.lastRegimeUpdate = Date.now();
    this.cleanupExpiredCooldowns();

    if (classified > 0) {
      console.log(
        `[StrategyIntel] Regime update: ${classified} classified — ` +
        `Trending: ${regimeSummary.trending.length}, ` +
        `Ranging: ${regimeSummary.ranging.length}, ` +
        `Volatile: ${regimeSummary.volatile.length}`
      );
      if (regimeSummary.trending.length > 0 && regimeSummary.trending.length <= 8) {
        console.log(`[StrategyIntel]   Trending: ${regimeSummary.trending.join(", ")}`);
      }
      if (regimeSummary.volatile.length > 0 && regimeSummary.volatile.length <= 8) {
        console.log(`[StrategyIntel]   Volatile: ${regimeSummary.volatile.join(", ")}`);
      }
      if (this.exhaustionCooldown.size > 0) {
        console.log(`[StrategyIntel]   Exhaustion cooldowns active: ${this.exhaustionCooldown.size}`);
      }
    }
  }

  private checkExhaustion(instrument: Instrument, timeframe: Timeframe, analysis: MarketAnalysis): void {
    const changePercent = Math.abs(analysis.changePercent || 0);
    const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
    const threshold = isMetal ? 1.5 : 0.8;

    if (changePercent > threshold * 2 && analysis.trend.strength > 70) {
      const key = `${instrument}_${timeframe}_${analysis.trend.direction}`;
      const expiresAt = Date.now() + (this.EXHAUSTION_COOLDOWN_CYCLES * this.REGIME_UPDATE_INTERVAL_MS);
      this.exhaustionCooldown.set(key, expiresAt);
      console.log(`[StrategyIntel] EXHAUSTION detected: ${instrument}/${timeframe} ${analysis.trend.direction} (${changePercent.toFixed(2)}% move) — cooldown for ${this.EXHAUSTION_COOLDOWN_CYCLES * 15}min`);
    }
  }

  private cleanupExpiredCooldowns(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.exhaustionCooldown.entries()) {
      if (now >= expiresAt) {
        this.exhaustionCooldown.delete(key);
      }
    }
  }

  private async syncPerformanceData(): Promise<void> {
    try {
      const allTrades = await storage.getSimulatedTrades();
      const closedTrades = allTrades.filter(
        (t) => t.status !== "open" && t.pnlPips !== null && t.pnlPips !== undefined
      );

      this.performanceByCombo.clear();
      this.performanceBySession.clear();

      const now = Date.now();
      const recencyCutoff = now - (this.RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const fullCutoff = now - (this.FULL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const recentTrades = closedTrades.filter(t => {
        const closedAt = t.closedAt ? new Date(t.closedAt).getTime() : 0;
        return closedAt > fullCutoff;
      });

      for (const trade of recentTrades) {
        const regime = this.regimeCache.get(`${trade.instrument}_${trade.timeframe}`);
        const regimeLabel = regime?.regime || "unknown";
        const comboKey = `${trade.instrument}_${trade.timeframe}_${regimeLabel}`;

        const existing = this.performanceByCombo.get(comboKey) || { wins: 0, losses: 0, totalPips: 0, recentWins: 0, recentLosses: 0 };
        const isWin = (trade.pnlPips || 0) > 0;
        const closedAt = trade.closedAt ? new Date(trade.closedAt).getTime() : 0;
        const isRecent = closedAt > recencyCutoff;

        if (isWin) {
          existing.wins++;
          if (isRecent) existing.recentWins++;
        } else {
          existing.losses++;
          if (isRecent) existing.recentLosses++;
        }
        existing.totalPips += trade.pnlPips || 0;
        this.performanceByCombo.set(comboKey, existing);

        const session = this.getSessionFromTimestamp(trade.openedAt);
        if (session) {
          const sessionKey = `${trade.instrument}_${session}`;
          const sessRec = this.performanceBySession.get(sessionKey) || { wins: 0, losses: 0, totalPips: 0, recentWins: 0, recentLosses: 0 };
          if (isWin) {
            sessRec.wins++;
            if (isRecent) sessRec.recentWins++;
          } else {
            sessRec.losses++;
            if (isRecent) sessRec.recentLosses++;
          }
          sessRec.totalPips += trade.pnlPips || 0;
          this.performanceBySession.set(sessionKey, sessRec);
        }
      }

      this.lastPerformanceSync = Date.now();
      console.log(
        `[StrategyIntel] Performance sync: ${recentTrades.length} trades (${this.FULL_WINDOW_DAYS}d window), ` +
        `${this.performanceByCombo.size} combo records, ${this.performanceBySession.size} session records`
      );
    } catch (err) {
      console.error("[StrategyIntel] Performance sync error:", err);
    }
  }

  private getWeightedWinRate(perf: PerformanceRecord): number {
    const olderWins = perf.wins - perf.recentWins;
    const olderLosses = perf.losses - perf.recentLosses;
    const weightedWins = olderWins + (perf.recentWins * 2);
    const weightedLosses = olderLosses + (perf.recentLosses * 2);
    const weightedTotal = weightedWins + weightedLosses;
    if (weightedTotal === 0) return 50;
    return (weightedWins / weightedTotal) * 100;
  }

  private getSessionFromTimestamp(timestamp: string): TradingSession | null {
    try {
      const date = new Date(timestamp);
      const utcHour = date.getUTCHours();
      if (utcHour >= 0 && utcHour < 8) return "asian";
      if (utcHour >= 8 && utcHour < 13) return "london";
      if (utcHour >= 13 && utcHour < 22) return "new_york";
      return "asian";
    } catch {
      return null;
    }
  }

  private getCurrentSession(): TradingSession {
    const utcHour = new Date().getUTCHours();
    if (utcHour >= 0 && utcHour < 8) return "asian";
    if (utcHour >= 8 && utcHour < 13) return "london";
    return "new_york";
  }

  evaluateSignal(signal: TradeSignal, analysis: MarketAnalysis): FilterDecision {
    const instrument = signal.instrument as Instrument;
    const timeframe = signal.timeframe as Timeframe;
    const key = `${instrument}_${timeframe}`;
    const regime = this.regimeCache.get(key);

    if (!regime) {
      return { allowed: true, reason: "No regime data — allowing signal" };
    }

    const shortTimeframes: Timeframe[] = ["1m", "5m", "15m"];
    const isShortTF = shortTimeframes.includes(timeframe);

    const exhaustionDir = signal.direction.toLowerCase() === "buy" ? "up" : signal.direction.toLowerCase() === "sell" ? "down" : null;
    if (!exhaustionDir) {
      return { allowed: false, reason: "Stand-aside signal — no trade" };
    }
    const exhaustionKey = `${instrument}_${timeframe}_${exhaustionDir}`;
    if (this.exhaustionCooldown.has(exhaustionKey)) {
      console.log(
        `[StrategyIntel] BLOCKED ${instrument}/${timeframe} ${signal.direction} — exhaustion cooldown active`
      );
      return {
        allowed: false,
        reason: `Exhaustion cooldown: big move detected, waiting for market to settle`,
      };
    }

    if (regime.regime === "ranging" && isShortTF) {
      console.log(
        `[StrategyIntel] BLOCKED ${instrument}/${timeframe} — ranging regime on short timeframe (trend str: ${regime.trendStrength})`
      );
      return {
        allowed: false,
        reason: `Ranging market — short timeframe ${timeframe} signals blocked (trend-following doesn't work in sideways markets)`,
      };
    }

    const comboKey = `${instrument}_${timeframe}_${regime.regime}`;
    const perf = this.performanceByCombo.get(comboKey);
    if (perf && perf.wins + perf.losses >= this.MIN_TRADES_FOR_SUPPRESSION) {
      const weightedWR = this.getWeightedWinRate(perf);
      if (weightedWR < 35) {
        console.log(
          `[StrategyIntel] BLOCKED ${instrument}/${timeframe} — weighted WR ${weightedWR.toFixed(1)}% on ${perf.wins + perf.losses} trades (regime: ${regime.regime})`
        );
        return {
          allowed: false,
          reason: `Poor weighted win rate: ${weightedWR.toFixed(1)}% on ${perf.wins + perf.losses} trades in ${regime.regime} regime`,
        };
      }
      if (weightedWR < 45) {
        const requiredConfidence = 70;
        if (signal.confidence < requiredConfidence) {
          console.log(
            `[StrategyIntel] BLOCKED ${instrument}/${timeframe} — WR ${weightedWR.toFixed(1)}% needs ${requiredConfidence}%+ confidence, signal has ${signal.confidence}%`
          );
          return {
            allowed: false,
            reason: `Low WR (${weightedWR.toFixed(1)}%) requires ${requiredConfidence}%+ confidence, signal only ${signal.confidence}%`,
          };
        }
        return {
          allowed: true,
          reason: `Weak WR ${weightedWR.toFixed(1)}% but signal confidence ${signal.confidence}% meets threshold`,
          adjustedConfidence: Math.max(30, signal.confidence - 10),
        };
      }
    }

    const currentSession = this.getCurrentSession();
    const sessionKey = `${instrument}_${currentSession}`;
    const sessionPerf = this.performanceBySession.get(sessionKey);
    if (sessionPerf && sessionPerf.wins + sessionPerf.losses >= this.MIN_SESSION_TRADES) {
      const sessionWR = this.getWeightedWinRate(sessionPerf);
      if (sessionWR < 35) {
        console.log(
          `[StrategyIntel] BLOCKED ${instrument} during ${currentSession} session — ${sessionWR.toFixed(1)}% weighted WR on ${sessionPerf.wins + sessionPerf.losses} trades`
        );
        return {
          allowed: false,
          reason: `Poor ${currentSession} session performance: ${sessionWR.toFixed(1)}% weighted win rate`,
        };
      }
      if (sessionWR < 45) {
        return {
          allowed: true,
          reason: `Weak ${currentSession} session performance penalty`,
          adjustedConfidence: Math.max(30, signal.confidence - 8),
        };
      }
    }

    if (regime.regime === "volatile") {
      const volPerf = this.performanceByCombo.get(comboKey);
      if (volPerf && volPerf.wins + volPerf.losses >= this.MIN_TRADES_FOR_SUPPRESSION) {
        const volWR = this.getWeightedWinRate(volPerf);
        if (volWR < 40) {
          console.log(
            `[StrategyIntel] BLOCKED ${instrument}/${timeframe} — volatile regime with ${volWR.toFixed(1)}% weighted WR`
          );
          return {
            allowed: false,
            reason: `Volatile regime with ${volWR.toFixed(1)}% historical win rate`,
          };
        }
      }
    }

    if (regime.regime === "trending" && regime.confidence >= 70) {
      const trendPerf = this.performanceByCombo.get(comboKey);
      if (trendPerf && trendPerf.wins + trendPerf.losses >= this.MIN_TRADES_FOR_SUPPRESSION) {
        const trendWR = this.getWeightedWinRate(trendPerf);
        if (trendWR >= 60) {
          return {
            allowed: true,
            reason: `Strong trending regime with ${trendWR.toFixed(1)}% WR — boosted`,
            adjustedConfidence: Math.min(95, signal.confidence + 5),
          };
        }
      }
    }

    if (regime.regime === "ranging" && !isShortTF) {
      return {
        allowed: true,
        reason: `Ranging market but longer TF ${timeframe} — allowed with caution`,
        adjustedConfidence: Math.max(30, signal.confidence - 5),
      };
    }

    return { allowed: true, reason: "Passed all strategy intelligence checks" };
  }

  getRegime(instrument: Instrument, timeframe: Timeframe): RegimeClassification | undefined {
    return this.regimeCache.get(`${instrument}_${timeframe}`);
  }

  getAllRegimes(): Record<string, RegimeClassification> {
    const result: Record<string, RegimeClassification> = {};
    this.regimeCache.forEach((v, k) => {
      result[k] = v;
    });
    return result;
  }

  getPerformanceStats(): {
    comboStats: Record<string, { wins: number; losses: number; winRate: number; weightedWinRate: number; totalPips: number }>;
    sessionStats: Record<string, { wins: number; losses: number; winRate: number; weightedWinRate: number; totalPips: number }>;
  } {
    const comboStats: Record<string, { wins: number; losses: number; winRate: number; weightedWinRate: number; totalPips: number }> = {};
    this.performanceByCombo.forEach((v, k) => {
      const total = v.wins + v.losses;
      comboStats[k] = {
        wins: v.wins,
        losses: v.losses,
        winRate: total > 0 ? (v.wins / total) * 100 : 0,
        weightedWinRate: this.getWeightedWinRate(v),
        totalPips: v.totalPips,
      };
    });

    const sessionStats: Record<string, { wins: number; losses: number; winRate: number; weightedWinRate: number; totalPips: number }> = {};
    this.performanceBySession.forEach((v, k) => {
      const total = v.wins + v.losses;
      sessionStats[k] = {
        wins: v.wins,
        losses: v.losses,
        winRate: total > 0 ? (v.wins / total) * 100 : 0,
        weightedWinRate: this.getWeightedWinRate(v),
        totalPips: v.totalPips,
      };
    });

    return { comboStats, sessionStats };
  }

  recordTradeResult(instrument: string, timeframe: string, pnlPips: number, openedAt: string): void {
    const regime = this.regimeCache.get(`${instrument}_${timeframe}`);
    const regimeLabel = regime?.regime || "unknown";
    const comboKey = `${instrument}_${timeframe}_${regimeLabel}`;

    const existing = this.performanceByCombo.get(comboKey) || { wins: 0, losses: 0, totalPips: 0, recentWins: 0, recentLosses: 0 };
    const isRecent = (Date.now() - new Date(openedAt).getTime()) < (this.RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (pnlPips > 0) {
      existing.wins++;
      if (isRecent) existing.recentWins++;
    } else {
      existing.losses++;
      if (isRecent) existing.recentLosses++;
    }
    existing.totalPips += pnlPips;
    this.performanceByCombo.set(comboKey, existing);

    const session = this.getSessionFromTimestamp(openedAt);
    if (session) {
      const sessionKey = `${instrument}_${session}`;
      const sessRec = this.performanceBySession.get(sessionKey) || { wins: 0, losses: 0, totalPips: 0, recentWins: 0, recentLosses: 0 };
      if (pnlPips > 0) {
        sessRec.wins++;
        if (isRecent) sessRec.recentWins++;
      } else {
        sessRec.losses++;
        if (isRecent) sessRec.recentLosses++;
      }
      sessRec.totalPips += pnlPips;
      this.performanceBySession.set(sessionKey, sessRec);
    }
  }
}

export const strategyIntelligence = new StrategyIntelligence();
