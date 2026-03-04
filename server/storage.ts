import type { 
  User, 
  UpsertUser, 
  MarketAnalysis, 
  TradeSignal, 
  Candle,
  Instrument,
  Timeframe,
  SimulatedTrade,
  SimulationStats,
  SimTradeStatus,
  LearningPerformance,
  SignalConditions,
  RiskManagement,
  DailyPnL,
  COTData,
  RetailSentiment,
  CorrelationData,
  PaperAccount
} from "@shared/schema";
import { instruments, simulatedTradesTable, userSettingsTable } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  
  // Market data cache
  getCachedAnalysis(instrument: Instrument, timeframe: Timeframe): MarketAnalysis | undefined;
  setCachedAnalysis(analysis: MarketAnalysis): void;
  getAllCachedAnalyses(): MarketAnalysis[];
  
  getCachedSignal(instrument: Instrument, timeframe: Timeframe): TradeSignal | undefined;
  setCachedSignal(signal: TradeSignal): void;
  getAllCachedSignals(): TradeSignal[];
  
  getCachedCandles(instrument: Instrument, timeframe: Timeframe): Candle[];
  setCachedCandles(instrument: Instrument, timeframe: Timeframe, candles: Candle[]): void;
  
  getLastRefreshTime(): Date | undefined;
  setLastRefreshTime(time: Date): void;
  clearAllCaches(): void;
  
  // Simulated trades - now async for database
  getSimulatedTrades(): Promise<SimulatedTrade[]>;
  getOpenSimulatedTrades(): Promise<SimulatedTrade[]>;
  addSimulatedTrade(trade: SimulatedTrade): Promise<void>;
  updateSimulatedTrade(id: string, updates: Partial<SimulatedTrade>): Promise<void>;
  getSimulationStats(): Promise<SimulationStats>;
  isSimulationEnabled(): boolean;
  setSimulationEnabled(enabled: boolean): Promise<void>;
  
  // Learning engine
  getLearningPerformance(): Promise<LearningPerformance>;
  getConfidenceAdjustment(conditions: SignalConditions): Promise<number>;
  
  // Risk management
  getRiskManagement(): RiskManagement;
  setRiskManagement(settings: Partial<RiskManagement>): Promise<void>;
  getDailyPnL(): DailyPnL;
  updateDailyPnL(pnl: number): void;
  isDailyLimitReached(): boolean;
  resetConsecutiveLosses(): void;
  isTradingLocked(): { locked: boolean; reason?: string };
  
  // Paper account
  getPaperAccount(userId?: string): Promise<PaperAccount>;
  updatePaperAccount(updates: Partial<PaperAccount>, userId?: string): Promise<void>;
  resetPaperAccount(startingBalance: number, currency: string, userId?: string): Promise<void>;
  
  // Institutional data
  getCOTData(instrument: Instrument): COTData | undefined;
  getAllCOTData(): COTData[];
  getRetailSentiment(instrument: Instrument): RetailSentiment | undefined;
  getAllRetailSentiment(): RetailSentiment[];
  getCorrelations(): CorrelationData[];
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private analysisCache: Map<string, MarketAnalysis>;
  private signalCache: Map<string, TradeSignal>;
  private candleCache: Map<string, Candle[]>;
  private lastRefreshTime: Date | undefined;
  private simulationEnabled: boolean;
  private riskManagement: RiskManagement;
  private dailyPnL: DailyPnL;
  private cotData: Map<string, COTData>;
  private retailSentiment: Map<Instrument, RetailSentiment>;

  constructor() {
    this.users = new Map();
    this.analysisCache = new Map();
    this.signalCache = new Map();
    this.candleCache = new Map();
    this.simulationEnabled = true;
    this.riskManagement = {
      dailyLossLimitPercent: 5,
      maxOpenPositions: 3,
      correlationWarningEnabled: true,
      sessionFilterEnabled: false,
      preferredSessions: ["london", "new_york"],
      newsBlackoutMinutes: 0,  // Disabled - calendar data is generated/not real, was falsely blocking trades
      consecutiveLossLimit: 3,
      minAccountBalance: 50,
    };
    this.dailyPnL = {
      date: new Date().toISOString().split("T")[0],
      startingBalance: 10000,
      currentPnL: 0,
      currentPnLPercent: 0,
      tradesExecuted: 0,
      consecutiveLosses: 0,
      isLimitReached: false,
      isConsecutiveLossLockout: false,
    };
    this.cotData = new Map();
    this.retailSentiment = new Map();
    this.initializeCOTData();
    this.initializeRetailSentiment();
    console.log("[TradeSimulation] Using database for persistent trade storage");
    // Load settings from database asynchronously
    this.loadRiskManagementFromDB();
    // Reconcile paper account balances from actual trade data on startup
    this.reconcilePaperBalances();
  }

  private initializeCOTData() {
    const cotDataSets: COTData[] = [
      {
        instrument: "Gold",
        reportDate: new Date().toISOString(),
        longPositions: 287500,
        shortPositions: 125000,
        netPosition: 162500,
        changeFromPrevious: 8500,
        commercialLong: 145000,
        commercialShort: 195000,
        nonCommercialLong: 245000,
        nonCommercialShort: 82500,
        openInterest: 525000,
        bias: "bullish",
      },
      {
        instrument: "EURUSD",
        reportDate: new Date().toISOString(),
        longPositions: 185000,
        shortPositions: 210000,
        netPosition: -25000,
        changeFromPrevious: -12000,
        commercialLong: 95000,
        commercialShort: 85000,
        nonCommercialLong: 125000,
        nonCommercialShort: 165000,
        openInterest: 395000,
        bias: "bearish",
      },
      {
        instrument: "GBPUSD",
        reportDate: new Date().toISOString(),
        longPositions: 95000,
        shortPositions: 78000,
        netPosition: 17000,
        changeFromPrevious: 5200,
        commercialLong: 45000,
        commercialShort: 52000,
        nonCommercialLong: 68000,
        nonCommercialShort: 42000,
        openInterest: 173000,
        bias: "bullish",
      },
    ];
    cotDataSets.forEach(cot => this.cotData.set(cot.instrument, cot));
  }

  private initializeRetailSentiment() {
    instruments.forEach(inst => {
      const longPct = 40 + Math.random() * 40;
      const shortPct = 100 - longPct;
      this.retailSentiment.set(inst, {
        instrument: inst,
        longPercentage: Math.round(longPct),
        shortPercentage: Math.round(shortPct),
        extremeWarning: longPct > 75 || shortPct > 75,
        contrarianSignal: longPct > 75 ? "sell" : shortPct > 75 ? "buy" : "none",
        lastUpdated: new Date().toISOString(),
      });
    });
  }

  private getCacheKey(instrument: Instrument, timeframe: Timeframe): string {
    return `${instrument}_${timeframe}`;
  }

  // Convert database record to SimulatedTrade type
  private dbRecordToSimulatedTrade(record: any): SimulatedTrade {
    return {
      id: record.id,
      userId: record.userId || undefined, // Per-user trade isolation
      signalId: record.signalId,
      instrument: record.instrument as Instrument,
      timeframe: record.timeframe as Timeframe,
      direction: record.direction as "buy" | "sell" | "stand_aside",
      entryPrice: record.entryPrice,
      stopLoss: record.stopLoss,
      takeProfit1: record.takeProfit1,
      takeProfit2: record.takeProfit2 || undefined,
      status: record.status as SimTradeStatus,
      openedAt: record.openedAt,
      closedAt: record.closedAt || undefined,
      closePrice: record.closePrice || undefined,
      pnlPips: record.pnlPips || undefined,
      pnlPercent: record.pnlPercent || undefined,
      highestPrice: record.highestPrice || undefined,
      lowestPrice: record.lowestPrice || undefined,
      conditions: record.conditions as SignalConditions | undefined,
      oandaTradeId: record.oandaTradeId || undefined,
      breakEvenApplied: record.breakEvenApplied || false,
      halfProfitLocked: record.halfProfitLocked || false,
      lotSize: record.lotSize || undefined,
      pnlMoney: record.pnlMoney || undefined,
    };
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === username,
    );
  }

  async createUser(upsertUser: UpsertUser): Promise<User> {
    const id = upsertUser.id || randomUUID();
    const user: User = { 
      id,
      email: upsertUser.email || null,
      firstName: upsertUser.firstName || null,
      lastName: upsertUser.lastName || null,
      profileImageUrl: upsertUser.profileImageUrl || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  getCachedAnalysis(instrument: Instrument, timeframe: Timeframe): MarketAnalysis | undefined {
    return this.analysisCache.get(this.getCacheKey(instrument, timeframe));
  }

  setCachedAnalysis(analysis: MarketAnalysis): void {
    this.analysisCache.set(this.getCacheKey(analysis.instrument, analysis.timeframe), analysis);
  }

  getAllCachedAnalyses(): MarketAnalysis[] {
    return Array.from(this.analysisCache.values());
  }

  getCachedSignal(instrument: Instrument, timeframe: Timeframe): TradeSignal | undefined {
    return this.signalCache.get(this.getCacheKey(instrument, timeframe));
  }

  setCachedSignal(signal: TradeSignal): void {
    this.signalCache.set(this.getCacheKey(signal.instrument, signal.timeframe), signal);
  }

  getAllCachedSignals(): TradeSignal[] {
    return Array.from(this.signalCache.values());
  }

  getCachedCandles(instrument: Instrument, timeframe: Timeframe): Candle[] {
    return this.candleCache.get(this.getCacheKey(instrument, timeframe)) || [];
  }

  setCachedCandles(instrument: Instrument, timeframe: Timeframe, candles: Candle[]): void {
    this.candleCache.set(this.getCacheKey(instrument, timeframe), candles);
  }

  getLastRefreshTime(): Date | undefined {
    return this.lastRefreshTime;
  }

  setLastRefreshTime(time: Date): void {
    this.lastRefreshTime = time;
  }

  clearAllCaches(): void {
    this.analysisCache.clear();
    this.signalCache.clear();
    this.candleCache.clear();
  }

  // Simulated trades methods - now using database
  async getSimulatedTrades(userId?: string): Promise<SimulatedTrade[]> {
    try {
      let records;
      if (userId) {
        records = await db.select().from(simulatedTradesTable)
          .where(eq(simulatedTradesTable.userId, userId));
      } else {
        records = await db.select().from(simulatedTradesTable);
      }
      return records
        .map(r => this.dbRecordToSimulatedTrade(r))
        .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
    } catch (error) {
      console.error("[TradeSimulation] Error fetching trades from database:", error);
      return [];
    }
  }

  async getOpenSimulatedTrades(userId?: string): Promise<SimulatedTrade[]> {
    try {
      let records;
      if (userId) {
        records = await db.select().from(simulatedTradesTable)
          .where(and(eq(simulatedTradesTable.status, "open"), eq(simulatedTradesTable.userId, userId)));
      } else {
        records = await db.select().from(simulatedTradesTable)
          .where(eq(simulatedTradesTable.status, "open"));
      }
      return records.map(r => this.dbRecordToSimulatedTrade(r));
    } catch (error) {
      console.error("[TradeSimulation] Error fetching open trades:", error);
      return [];
    }
  }

  async addSimulatedTrade(trade: SimulatedTrade): Promise<void> {
    try {
      await db.insert(simulatedTradesTable).values({
        id: trade.id,
        userId: trade.userId || null,
        signalId: trade.signalId,
        instrument: trade.instrument,
        timeframe: trade.timeframe,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit1: trade.takeProfit1,
        takeProfit2: trade.takeProfit2 || null,
        status: trade.status,
        openedAt: trade.openedAt,
        closedAt: trade.closedAt || null,
        closePrice: trade.closePrice || null,
        pnlPips: trade.pnlPips || null,
        pnlPercent: trade.pnlPercent || null,
        highestPrice: trade.highestPrice || null,
        lowestPrice: trade.lowestPrice || null,
        conditions: trade.conditions || null,
        lotSize: trade.lotSize || null,
        pnlMoney: trade.pnlMoney || null,
      });
      console.log(`[TradeSimulation] Added trade ${trade.id} to database`);
    } catch (error) {
      console.error("[TradeSimulation] Error adding trade to database:", error);
    }
  }

  async updateSimulatedTrade(id: string, updates: Partial<SimulatedTrade>): Promise<void> {
    try {
      const updateValues: any = {};
      if (updates.status !== undefined) updateValues.status = updates.status;
      if (updates.closedAt !== undefined) updateValues.closedAt = updates.closedAt;
      if (updates.closePrice !== undefined) updateValues.closePrice = updates.closePrice;
      if (updates.pnlPips !== undefined) updateValues.pnlPips = updates.pnlPips;
      if (updates.pnlPercent !== undefined) updateValues.pnlPercent = updates.pnlPercent;
      if (updates.highestPrice !== undefined) updateValues.highestPrice = updates.highestPrice;
      if (updates.lowestPrice !== undefined) updateValues.lowestPrice = updates.lowestPrice;
      if (updates.lotSize !== undefined) updateValues.lotSize = updates.lotSize;
      if (updates.pnlMoney !== undefined) updateValues.pnlMoney = updates.pnlMoney;
      if (updates.oandaTradeId !== undefined) updateValues.oandaTradeId = updates.oandaTradeId;
      if (updates.userId !== undefined) updateValues.userId = updates.userId;
      if (updates.breakEvenApplied !== undefined) updateValues.breakEvenApplied = updates.breakEvenApplied;
      if (updates.halfProfitLocked !== undefined) updateValues.halfProfitLocked = updates.halfProfitLocked;
      if (updates.stopLoss !== undefined) updateValues.stopLoss = updates.stopLoss;
      
      await db.update(simulatedTradesTable)
        .set(updateValues)
        .where(eq(simulatedTradesTable.id, id));
      console.log(`[TradeSimulation] Updated trade ${id} in database`);
    } catch (error) {
      console.error("[TradeSimulation] Error updating trade in database:", error);
    }
  }

  async getSimulationStats(userId?: string): Promise<SimulationStats> {
    const trades = await this.getSimulatedTrades(userId);
    const closedTrades = trades.filter(t => t.status !== "open");
    const wins = closedTrades.filter(t => (t.pnlPips || 0) > 0);
    const losses = closedTrades.filter(t => (t.pnlPips || 0) <= 0);

    const totalPnlPips = closedTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
    const winPips = wins.map(t => t.pnlPips || 0);
    const lossPips = losses.map(t => Math.abs(t.pnlPips || 0));

    const avgWinPips = winPips.length > 0 ? winPips.reduce((a, b) => a + b, 0) / winPips.length : 0;
    const avgLossPips = lossPips.length > 0 ? lossPips.reduce((a, b) => a + b, 0) / lossPips.length : 0;
    const totalWinPips = winPips.reduce((a, b) => a + b, 0);
    const totalLossPips = lossPips.reduce((a, b) => a + b, 0);

    // Calculate by instrument
    const byInstrument: Record<string, { total: number; wins: number; losses: number; winRate: number; pnlPips: number }> = {};
    closedTrades.forEach(t => {
      if (!byInstrument[t.instrument]) {
        byInstrument[t.instrument] = { total: 0, wins: 0, losses: 0, winRate: 0, pnlPips: 0 };
      }
      byInstrument[t.instrument].total++;
      byInstrument[t.instrument].pnlPips += t.pnlPips || 0;
      if ((t.pnlPips || 0) > 0) byInstrument[t.instrument].wins++;
      if ((t.pnlPips || 0) <= 0) byInstrument[t.instrument].losses++;
    });
    Object.values(byInstrument).forEach(v => {
      v.winRate = v.total > 0 ? (v.wins / v.total) * 100 : 0;
    });

    // Calculate by timeframe
    const byTimeframe: Record<string, { total: number; wins: number; losses: number; winRate: number }> = {};
    closedTrades.forEach(t => {
      if (!byTimeframe[t.timeframe]) {
        byTimeframe[t.timeframe] = { total: 0, wins: 0, losses: 0, winRate: 0 };
      }
      byTimeframe[t.timeframe].total++;
      if ((t.pnlPips || 0) > 0) byTimeframe[t.timeframe].wins++;
      if ((t.pnlPips || 0) <= 0) byTimeframe[t.timeframe].losses++;
    });
    Object.values(byTimeframe).forEach(v => {
      v.winRate = v.total > 0 ? (v.wins / v.total) * 100 : 0;
    });

    return {
      totalTrades: trades.length,
      openTrades: trades.length - closedTrades.length,
      closedTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
      totalPnlPips,
      avgWinPips,
      avgLossPips,
      bestTradePips: winPips.length > 0 ? Math.max(...winPips) : 0,
      worstTradePips: lossPips.length > 0 ? -Math.max(...lossPips) : 0,
      profitFactor: totalLossPips > 0 ? totalWinPips / totalLossPips : totalWinPips > 0 ? Infinity : 0,
      byInstrument,
      byTimeframe,
    };
  }

  isSimulationEnabled(): boolean {
    return this.simulationEnabled;
  }

  async setSimulationEnabled(enabled: boolean): Promise<void> {
    this.simulationEnabled = enabled;
    await this.saveRiskManagementToDB();
  }

  // Learning engine - analyze closed trades to find patterns
  async getLearningPerformance(): Promise<LearningPerformance> {
    const allTrades = await this.getSimulatedTrades();
    const trades = allTrades.filter(t => t.status !== "open" && t.conditions);
    const minTrades = 15; // Need at least 15 trades before learning kicks in (was 5, too aggressive on small samples)
    
    const initRecord = () => ({ total: 0, wins: 0, winRate: 0 });
    
    // Analyze by different conditions
    const byTrendStrength: Record<string, { total: number; wins: number; winRate: number }> = {
      "weak": initRecord(), // 0-40
      "moderate": initRecord(), // 40-70
      "strong": initRecord(), // 70-100
    };
    
    const byVolatility: Record<string, { total: number; wins: number; winRate: number }> = {
      "low": initRecord(),
      "medium": initRecord(),
      "high": initRecord(),
    };
    
    const byMarketState: Record<string, { total: number; wins: number; winRate: number }> = {
      "uptrend": initRecord(),
      "downtrend": initRecord(),
      "ranging": initRecord(),
    };
    
    const byTimeframe: Record<string, { total: number; wins: number; winRate: number }> = {};
    const byConfidenceLevel: Record<string, { total: number; wins: number; winRate: number }> = {
      "low": initRecord(),
      "medium": initRecord(),
      "high": initRecord(),
    };
    
    // Process each trade
    trades.forEach(trade => {
      if (!trade.conditions) return;
      const isWin = (trade.pnlPips || 0) > 0;
      
      // Trend strength buckets
      const trendBucket = trade.conditions.trendStrength < 40 ? "weak" :
                         trade.conditions.trendStrength < 70 ? "moderate" : "strong";
      byTrendStrength[trendBucket].total++;
      if (isWin) byTrendStrength[trendBucket].wins++;
      
      // Volatility
      byVolatility[trade.conditions.volatility].total++;
      if (isWin) byVolatility[trade.conditions.volatility].wins++;
      
      // Market state
      if (byMarketState[trade.conditions.marketState]) {
        byMarketState[trade.conditions.marketState].total++;
        if (isWin) byMarketState[trade.conditions.marketState].wins++;
      }
      
      // Timeframe
      if (!byTimeframe[trade.timeframe]) byTimeframe[trade.timeframe] = initRecord();
      byTimeframe[trade.timeframe].total++;
      if (isWin) byTimeframe[trade.timeframe].wins++;
      
      // Confidence level
      byConfidenceLevel[trade.conditions.confidenceLevel].total++;
      if (isWin) byConfidenceLevel[trade.conditions.confidenceLevel].wins++;
    });
    
    // Calculate win rates
    [byTrendStrength, byVolatility, byMarketState, byTimeframe, byConfidenceLevel].forEach(category => {
      Object.values(category).forEach(v => {
        v.winRate = v.total > 0 ? (v.wins / v.total) * 100 : 0;
      });
    });
    
    // Find best and worst setups (combinations)
    const setupStats: Map<string, { total: number; wins: number; pnlPips: number }> = new Map();
    
    trades.forEach(trade => {
      if (!trade.conditions) return;
      const isWin = (trade.pnlPips || 0) > 0;
      const pnl = trade.pnlPips || 0;
      
      // Create setup key: marketState + volatility + trendStrength bucket
      const trendBucket = trade.conditions.trendStrength < 40 ? "weak" :
                         trade.conditions.trendStrength < 70 ? "moderate" : "strong";
      const key = `${trade.conditions.marketState}_${trade.conditions.volatility}_${trendBucket}`;
      
      const existing = setupStats.get(key) || { total: 0, wins: 0, pnlPips: 0 };
      existing.total++;
      if (isWin) existing.wins++;
      existing.pnlPips += pnl;
      setupStats.set(key, existing);
    });
    
    // Convert to best/worst arrays
    const allSetups = Array.from(setupStats.entries())
      .filter(([_, v]) => v.total >= 3) // Need at least 3 trades
      .map(([key, v]) => ({
        description: key.replace(/_/g, " + ").replace(/weak/g, "weak trend").replace(/moderate/g, "moderate trend").replace(/strong/g, "strong trend"),
        winRate: v.total > 0 ? (v.wins / v.total) * 100 : 0,
        totalTrades: v.total,
        avgPnlPips: v.total > 0 ? v.pnlPips / v.total : 0,
      }))
      .sort((a, b) => b.winRate - a.winRate);
    
    const bestSetups = allSetups.slice(0, 3);
    const worstSetups = allSetups.slice(-3).reverse();
    
    // Calculate overall confidence adjustment
    const totalClosedTrades = trades.length;
    const overallWinRate = totalClosedTrades > 0 ? 
      (trades.filter(t => (t.pnlPips || 0) > 0).length / totalClosedTrades) * 100 : 50;
    
    // Adjust confidence: if win rate > 55%, boost confidence; if < 45%, reduce it
    // Scale adjustment by trade count confidence (more trades = more weight)
    const tradeCountFactor = Math.min(1, totalClosedTrades / 30); // Full weight at 30+ trades
    const overallAdjustment = totalClosedTrades >= minTrades ? 
      Math.round((overallWinRate - 50) * 0.2 * tradeCountFactor) : 0; // ±10% max adjustment, scaled by sample size
    
    return {
      byTrendStrength,
      byVolatility,
      byMarketState,
      byTimeframe,
      byConfidenceLevel,
      bestSetups,
      worstSetups,
      overallAdjustment,
      minTradesForLearning: minTrades,
    };
  }

  // Get confidence adjustment for specific conditions
  async getConfidenceAdjustment(conditions: SignalConditions): Promise<number> {
    const learning = await this.getLearningPerformance();
    const allTrades = await this.getSimulatedTrades();
    const trades = allTrades.filter(t => t.status !== "open" && t.conditions);
    
    if (trades.length < learning.minTradesForLearning) {
      return 0; // Not enough data to learn from
    }
    
    let adjustment = learning.overallAdjustment;
    
    // Sub-category adjustments: require more data (5+ trades per bucket) and smaller penalties
    const volPerf = learning.byVolatility[conditions.volatility];
    if (volPerf && volPerf.total >= 5) {
      if (volPerf.winRate > 60) adjustment += 3;
      else if (volPerf.winRate < 35) adjustment -= 3;
    }
    
    const statePerf = learning.byMarketState[conditions.marketState];
    if (statePerf && statePerf.total >= 5) {
      if (statePerf.winRate > 60) adjustment += 3;
      else if (statePerf.winRate < 35) adjustment -= 3;
    }
    
    const trendBucket = conditions.trendStrength < 40 ? "weak" :
                       conditions.trendStrength < 70 ? "moderate" : "strong";
    const trendPerf = learning.byTrendStrength[trendBucket];
    if (trendPerf && trendPerf.total >= 5) {
      if (trendPerf.winRate > 60) adjustment += 3;
      else if (trendPerf.winRate < 35) adjustment -= 3;
    }
    
    // Cap adjustment at ±15% (reduced from ±20 to prevent over-filtering)
    return Math.max(-15, Math.min(15, adjustment));
  }

  // Risk management methods - now using database for persistence
  getRiskManagement(): RiskManagement {
    return { ...this.riskManagement };
  }

  async loadRiskManagementFromDB(): Promise<void> {
    try {
      const records = await db.select().from(userSettingsTable).where(eq(userSettingsTable.id, "default"));
      if (records.length > 0) {
        const r = records[0];
        this.riskManagement = {
          dailyLossLimitPercent: r.dailyLossLimitPercent,
          maxOpenPositions: r.maxOpenPositions,
          correlationWarningEnabled: r.correlationWarningEnabled,
          sessionFilterEnabled: r.sessionFilterEnabled,
          preferredSessions: (r.preferredSessions as ("asian" | "london" | "new_york" | "closed")[]) || ["london", "new_york"],
          newsBlackoutMinutes: r.newsBlackoutMinutes,
          consecutiveLossLimit: r.consecutiveLossLimit,
          minAccountBalance: r.minAccountBalance,
        };
        this.simulationEnabled = r.simulationEnabled;
        console.log("[Settings] Loaded settings from database");
      } else {
        // Create default settings row
        await this.saveRiskManagementToDB();
        console.log("[Settings] Created default settings in database");
      }
    } catch (error) {
      console.error("[Settings] Error loading settings from database:", error);
    }
  }

  async saveRiskManagementToDB(): Promise<void> {
    try {
      const existing = await db.select().from(userSettingsTable).where(eq(userSettingsTable.id, "default"));
      if (existing.length > 0) {
        await db.update(userSettingsTable)
          .set({
            dailyLossLimitPercent: this.riskManagement.dailyLossLimitPercent,
            maxOpenPositions: this.riskManagement.maxOpenPositions,
            correlationWarningEnabled: this.riskManagement.correlationWarningEnabled,
            sessionFilterEnabled: this.riskManagement.sessionFilterEnabled,
            preferredSessions: this.riskManagement.preferredSessions,
            newsBlackoutMinutes: this.riskManagement.newsBlackoutMinutes,
            consecutiveLossLimit: this.riskManagement.consecutiveLossLimit,
            minAccountBalance: this.riskManagement.minAccountBalance,
            simulationEnabled: this.simulationEnabled,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(userSettingsTable.id, "default"));
      } else {
        await db.insert(userSettingsTable).values({
          id: "default",
          dailyLossLimitPercent: this.riskManagement.dailyLossLimitPercent,
          maxOpenPositions: this.riskManagement.maxOpenPositions,
          correlationWarningEnabled: this.riskManagement.correlationWarningEnabled,
          sessionFilterEnabled: this.riskManagement.sessionFilterEnabled,
          preferredSessions: this.riskManagement.preferredSessions,
          newsBlackoutMinutes: this.riskManagement.newsBlackoutMinutes,
          consecutiveLossLimit: this.riskManagement.consecutiveLossLimit,
          minAccountBalance: this.riskManagement.minAccountBalance,
          simulationEnabled: this.simulationEnabled,
          updatedAt: new Date().toISOString(),
        });
      }
      console.log("[Settings] Saved settings to database");
    } catch (error) {
      console.error("[Settings] Error saving settings to database:", error);
    }
  }

  async setRiskManagement(settings: Partial<RiskManagement>): Promise<void> {
    this.riskManagement = { ...this.riskManagement, ...settings };
    await this.saveRiskManagementToDB();
  }

  getDailyPnL(): DailyPnL {
    const today = new Date().toISOString().split("T")[0];
    if (this.dailyPnL.date !== today) {
      this.dailyPnL = {
        date: today,
        startingBalance: this.dailyPnL.startingBalance + this.dailyPnL.currentPnL,
        currentPnL: 0,
        currentPnLPercent: 0,
        tradesExecuted: 0,
        consecutiveLosses: 0,
        isLimitReached: false,
        isConsecutiveLossLockout: false,
      };
    }
    return { ...this.dailyPnL };
  }

  updateDailyPnL(pnl: number): void {
    this.dailyPnL.currentPnL += pnl;
    this.dailyPnL.currentPnLPercent = (this.dailyPnL.currentPnL / this.dailyPnL.startingBalance) * 100;
    this.dailyPnL.tradesExecuted++;
    
    if (pnl < 0) {
      this.dailyPnL.consecutiveLosses++;
      if (this.dailyPnL.consecutiveLosses >= this.riskManagement.consecutiveLossLimit) {
        this.dailyPnL.isConsecutiveLossLockout = true;
        this.dailyPnL.lockoutReason = `${this.dailyPnL.consecutiveLosses} consecutive losses - take a break`;
      }
    } else if (pnl > 0) {
      this.dailyPnL.consecutiveLosses = 0;
      this.dailyPnL.isConsecutiveLossLockout = false;
      this.dailyPnL.lockoutReason = undefined;
    }
    
    if (this.dailyPnL.currentPnLPercent <= -this.riskManagement.dailyLossLimitPercent) {
      this.dailyPnL.isLimitReached = true;
      this.dailyPnL.limitReachedAt = new Date().toISOString();
      this.dailyPnL.lockoutReason = `Daily loss limit reached (${this.riskManagement.dailyLossLimitPercent}%)`;
    }
  }

  resetConsecutiveLosses(): void {
    this.dailyPnL.consecutiveLosses = 0;
    this.dailyPnL.isConsecutiveLossLockout = false;
    this.dailyPnL.lockoutReason = undefined;
  }

  isTradingLocked(): { locked: boolean; reason?: string } {
    const pnl = this.getDailyPnL();
    if (pnl.isLimitReached) {
      return { locked: true, reason: pnl.lockoutReason || "Daily loss limit reached" };
    }
    if (pnl.isConsecutiveLossLockout) {
      return { locked: true, reason: pnl.lockoutReason || `${pnl.consecutiveLosses} consecutive losses` };
    }
    return { locked: false };
  }

  isDailyLimitReached(): boolean {
    return this.getDailyPnL().isLimitReached;
  }

  async getPaperAccount(userId?: string): Promise<PaperAccount> {
    try {
      if (userId) {
        const userRecords = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
        if (userRecords.length > 0) {
          const r = userRecords[0];
          return {
            startingBalance: r.paperStartingBalance,
            currentBalance: r.paperCurrentBalance,
            currency: r.paperCurrency as "GBP" | "USD" | "EUR",
            riskPercent: r.paperRiskPercent,
            peakBalance: r.paperPeakBalance,
            maxDrawdown: r.paperMaxDrawdown,
            createdAt: r.paperCreatedAt || new Date().toISOString(),
            totalDeposited: r.paperStartingBalance,
          };
        }
        
        // Auto-create a fresh paper account for new users
        const defaultBalance = 500;
        const defaultCurrency = "GBP";
        const now = new Date().toISOString();
        await db.insert(userSettingsTable).values({
          id: `user_${userId}`,
          userId,
          paperStartingBalance: defaultBalance,
          paperCurrentBalance: defaultBalance,
          paperCurrency: defaultCurrency,
          paperRiskPercent: 1,
          paperPeakBalance: defaultBalance,
          paperMaxDrawdown: 0,
          paperCreatedAt: now,
          updatedAt: now,
        });
        console.log(`[PaperAccount] Auto-created fresh ${defaultCurrency} ${defaultBalance} account for user ${userId.slice(0,8)}`);
        return {
          startingBalance: defaultBalance,
          currentBalance: defaultBalance,
          currency: defaultCurrency,
          riskPercent: 1,
          peakBalance: defaultBalance,
          maxDrawdown: 0,
          createdAt: now,
          totalDeposited: defaultBalance,
        };
      }
    } catch (error) {
      console.error("[PaperAccount] Error loading:", error);
    }
    return {
      startingBalance: 500,
      currentBalance: 500,
      currency: "GBP",
      riskPercent: 1,
      peakBalance: 500,
      maxDrawdown: 0,
      createdAt: new Date().toISOString(),
      totalDeposited: 500,
    };
  }

  async updatePaperAccount(updates: Partial<PaperAccount>, userId?: string): Promise<void> {
    try {
      const setData: Record<string, unknown> = {};
      if (updates.currentBalance !== undefined) setData.paperCurrentBalance = updates.currentBalance;
      if (updates.startingBalance !== undefined) setData.paperStartingBalance = updates.startingBalance;
      if (updates.currency !== undefined) setData.paperCurrency = updates.currency;
      if (updates.riskPercent !== undefined) setData.paperRiskPercent = updates.riskPercent;
      if (updates.peakBalance !== undefined) setData.paperPeakBalance = updates.peakBalance;
      if (updates.maxDrawdown !== undefined) setData.paperMaxDrawdown = updates.maxDrawdown;
      if (updates.createdAt !== undefined) setData.paperCreatedAt = updates.createdAt;
      setData.updatedAt = new Date().toISOString();

      if (userId) {
        await db.update(userSettingsTable)
          .set(setData)
          .where(eq(userSettingsTable.userId, userId));
      } else {
        await db.update(userSettingsTable)
          .set(setData)
          .where(eq(userSettingsTable.id, "default"));
      }
    } catch (error) {
      console.error("[PaperAccount] Error updating:", error);
    }
  }

  async resetPaperAccount(startingBalance: number, currency: string, userId?: string): Promise<void> {
    await this.updatePaperAccount({
      startingBalance,
      currentBalance: startingBalance,
      currency: currency as "GBP" | "USD" | "EUR",
      peakBalance: startingBalance,
      maxDrawdown: 0,
      createdAt: new Date().toISOString(),
    }, userId);
    console.log(`[PaperAccount] Reset to ${currency} ${startingBalance}${userId ? ` for user ${userId.slice(0,8)}` : ''}`);
  }

  private async reconcilePaperBalances(): Promise<void> {
    try {
      // One-time fix: Update OANDA trade #291 (XAGUSD sell) with actual manual close data
      // Trade was expired by simulation at £26.61 but user manually closed on OANDA at £313.90
      const fixTrade = await db.select().from(simulatedTradesTable)
        .where(eq(simulatedTradesTable.oandaTradeId, "291"));
      if (fixTrade.length > 0 && fixTrade[0].status === "expired" && fixTrade[0].pnlMoney !== null && Number(fixTrade[0].pnlMoney) < 100) {
        await db.update(simulatedTradesTable)
          .set({
            status: "manual_close",
            closePrice: 75.10,
            pnlPips: 227.475,
            pnlMoney: 313.90,
            pnlPercent: 40.67,
            closedAt: "2026-02-17T08:00:48.000Z",
          })
          .where(eq(simulatedTradesTable.oandaTradeId, "291"));
        console.log("[DataFix] Updated OANDA trade #291 with manual close data: £313.90 profit");
      }

      // Fix any closed trades missing pnlMoney (from the trade replacement bug)
      const allTradesRaw = await db.select().from(simulatedTradesTable);
      const missingMoneyTrades = allTradesRaw.filter(t => 
        t.status !== "open" && t.pnlPips !== null && t.pnlPips !== undefined &&
        (t.pnlMoney === null || t.pnlMoney === undefined) && t.lotSize && t.userId
      );
      
      if (missingMoneyTrades.length > 0) {
        const PIP_VALUES: Record<string, number> = {
          XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, GBPUSD: 0.0001,
          USDCHF: 0.0001, AUDUSD: 0.0001, NZDUSD: 0.0001,
          USDJPY: 0.01, USDCAD: 0.0001, EURGBP: 0.0001, EURJPY: 0.01, GBPJPY: 0.01,
        };
        const CONTRACT_SIZES: Record<string, number> = {
          XAUUSD: 100, XAGUSD: 5000, EURUSD: 100000, GBPUSD: 100000,
          USDCHF: 100000, AUDUSD: 100000, NZDUSD: 100000,
          USDJPY: 100000, USDCAD: 100000, EURGBP: 100000, EURJPY: 100000, GBPJPY: 100000,
        };
        
        const allSettingsForFix = await db.select().from(userSettingsTable);
        
        for (const trade of missingMoneyTrades) {
          const userCfg = allSettingsForFix.find(s => s.userId === trade.userId);
          if (!userCfg) {
            console.log(`[DataFix] Skipping trade ${trade.id} - no user settings found for ${trade.userId?.slice(0,8)}`);
            continue;
          }
          const currency = userCfg.paperCurrency;
          const pipSize = PIP_VALUES[trade.instrument] || 0.0001;
          const contractSize = CONTRACT_SIZES[trade.instrument] || 100000;
          let pipValueUsd = pipSize * contractSize;
          
          const isJpyQuote = trade.instrument.endsWith("JPY");
          const isChfQuote = trade.instrument.endsWith("CHF");
          const closePrice = trade.closePrice ? Number(trade.closePrice) : 0;
          if ((isJpyQuote || isChfQuote) && closePrice > 0) {
            pipValueUsd = pipValueUsd / closePrice;
          }
          
          let pipValuePerLot: number;
          if (currency === "GBP") {
            pipValuePerLot = pipValueUsd * 0.735;
          } else if (currency === "EUR") {
            pipValuePerLot = pipValueUsd * 0.84;
          } else {
            pipValuePerLot = pipValueUsd;
          }
          
          const pnlMoney = Math.round(Number(trade.pnlPips) * Number(trade.lotSize) * pipValuePerLot * 100) / 100;
          
          await db.update(simulatedTradesTable)
            .set({ pnlMoney })
            .where(eq(simulatedTradesTable.id, trade.id));
          
          console.log(`[DataFix] Fixed missing pnlMoney for ${trade.instrument} ${trade.timeframe} (${trade.userId?.slice(0,8)}): ${Number(trade.pnlPips).toFixed(1)} pips -> ${currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$'}${pnlMoney.toFixed(2)}`);
        }
        console.log(`[DataFix] Fixed ${missingMoneyTrades.length} trade(s) with missing pnlMoney`);
      }

      const allSettings = await db.select().from(userSettingsTable);
      const allTrades = await db.select().from(simulatedTradesTable);
      const closedTrades = allTrades.filter(t => t.status !== "open" && t.pnlMoney !== null && t.pnlMoney !== undefined);

      const userIdSet = new Set<string>();
      allTrades.forEach(t => { if (t.userId) userIdSet.add(t.userId); });
      const userIdList = Array.from(userIdSet);

      for (let i = 0; i < userIdList.length; i++) {
        const userId = userIdList[i];
        const userTrades = closedTrades.filter(t => t.userId === userId);
        const totalPnl = userTrades.reduce((sum, t) => sum + (Number(t.pnlMoney) || 0), 0);

        const userSettings = allSettings.find(s => s.userId === userId);
        if (!userSettings) continue;

        const expectedBalance = userSettings.paperStartingBalance + totalPnl;
        const roundedExpected = Math.round(expectedBalance * 100) / 100;

        if (Math.abs(userSettings.paperCurrentBalance - roundedExpected) > 0.01) {
          const drift = Math.abs(userSettings.paperCurrentBalance - roundedExpected);
          const oldBalance = userSettings.paperCurrentBalance;
          
          const newPeak = Math.max(userSettings.paperPeakBalance, roundedExpected);
          const newDrawdown = newPeak > 0 ? ((newPeak - roundedExpected) / newPeak) * 100 : 0;
          
          await db.update(userSettingsTable)
            .set({ 
              paperCurrentBalance: roundedExpected,
              paperPeakBalance: newPeak,
              paperMaxDrawdown: Math.round(Math.max(userSettings.paperMaxDrawdown, newDrawdown) * 100) / 100,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(userSettingsTable.userId, userId));
          
          console.log(`[PaperAccount] Balance CORRECTED for user ${userId.slice(0,8)}: ${userSettings.paperCurrency} ${oldBalance} -> ${roundedExpected} (drift=${drift.toFixed(2)}, ${userTrades.length} closed trades, peak=${newPeak.toFixed(2)})`);
        }
      }

      const orphanTrades = allTrades.filter(t => !t.userId);
      if (orphanTrades.length > 0 && userIdList.length === 1) {
        const primaryUserId = userIdList[0];
        for (const trade of orphanTrades) {
          await db.update(simulatedTradesTable)
            .set({ userId: primaryUserId })
            .where(eq(simulatedTradesTable.id, trade.id));
        }
        console.log(`[PaperAccount] Assigned ${orphanTrades.length} orphaned trades to user ${primaryUserId.slice(0,8)}`);
      } else if (orphanTrades.length > 0) {
        console.log(`[PaperAccount] WARNING: ${orphanTrades.length} orphaned trades found but multiple users exist - manual assignment needed`);
      }

      console.log(`[PaperAccount] Balance check complete - ${userIdList.length} user(s) verified`);
    } catch (error) {
      console.error("[PaperAccount] Error during balance reconciliation:", error);
    }
  }

  // COT Data methods
  getCOTData(instrument: Instrument): COTData | undefined {
    const mapping: Record<string, string> = {
      XAUUSD: "Gold",
      EURUSD: "EURUSD",
      GBPUSD: "GBPUSD",
    };
    return this.cotData.get(mapping[instrument] || instrument);
  }

  getAllCOTData(): COTData[] {
    return Array.from(this.cotData.values());
  }

  // Retail sentiment methods
  getRetailSentiment(instrument: Instrument): RetailSentiment | undefined {
    return this.retailSentiment.get(instrument);
  }

  getAllRetailSentiment(): RetailSentiment[] {
    return Array.from(this.retailSentiment.values());
  }

  // Correlation data
  getCorrelations(): CorrelationData[] {
    return [
      { pair1: "EURUSD", pair2: "GBPUSD", correlation: 0.85, strength: "strong", warning: "High correlation - reduce combined exposure" },
      { pair1: "EURUSD", pair2: "USDCHF", correlation: -0.92, strength: "strong", warning: "Negative correlation - opposing trades cancel out" },
      { pair1: "AUDUSD", pair2: "NZDUSD", correlation: 0.88, strength: "strong", warning: "High correlation - treat as single exposure" },
      { pair1: "XAUUSD", pair2: "EURUSD", correlation: 0.45, strength: "moderate" },
      { pair1: "GBPUSD", pair2: "AUDUSD", correlation: 0.52, strength: "moderate" },
      { pair1: "XAUUSD", pair2: "USDCHF", correlation: -0.38, strength: "weak" },
    ];
  }
}

export const storage = new MemStorage();
