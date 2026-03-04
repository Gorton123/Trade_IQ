import { z } from "zod";

// Supported trading instruments
export const instruments = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDCHF", "AUDUSD", "NZDUSD", "USDJPY", "USDCAD", "EURGBP", "EURJPY", "GBPJPY"] as const;
export type Instrument = typeof instruments[number];

// Supported timeframes
export const timeframes = ["1m", "5m", "15m", "1h", "4h", "1D", "1W", "1M"] as const;
export type Timeframe = typeof timeframes[number];

// Market state types
export const marketStates = ["uptrend", "downtrend", "ranging", "high_risk", "no_trade"] as const;
export type MarketState = typeof marketStates[number];

// Trade direction
export const tradeDirections = ["buy", "sell", "stand_aside"] as const;
export type TradeDirection = typeof tradeDirections[number];

// OHLCV Candle data
export const candleSchema = z.object({
  timestamp: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
});
export type Candle = z.infer<typeof candleSchema>;

// Support/Resistance level
export const srLevelSchema = z.object({
  price: z.number(),
  strength: z.enum(["weak", "moderate", "strong"]),
  type: z.enum(["support", "resistance"]),
  touches: z.number(),
});
export type SRLevel = z.infer<typeof srLevelSchema>;

// Market analysis result
export const marketAnalysisSchema = z.object({
  instrument: z.enum(instruments),
  timeframe: z.enum(timeframes),
  currentPrice: z.number(),
  previousClose: z.number(),
  changePercent: z.number(),
  marketState: z.enum(marketStates),
  trend: z.object({
    direction: z.enum(["up", "down", "sideways"]),
    strength: z.number().min(0).max(100),
  }),
  supportLevels: z.array(srLevelSchema),
  resistanceLevels: z.array(srLevelSchema),
  volatility: z.enum(["low", "medium", "high"]),
  lastUpdated: z.string(),
});
export type MarketAnalysis = z.infer<typeof marketAnalysisSchema>;

// Trade signal
export const tradeSignalSchema = z.object({
  instrument: z.enum(instruments),
  timeframe: z.enum(timeframes),
  direction: z.enum(tradeDirections),
  confidence: z.number().min(0).max(100),
  entryZone: z.object({
    low: z.number(),
    high: z.number(),
  }),
  stopLoss: z.number(),
  takeProfit1: z.number(),
  takeProfit2: z.number().optional(),
  riskRewardRatio: z.number(),
  reasoning: z.array(z.string()),
  timestamp: z.string(),
});
export type TradeSignal = z.infer<typeof tradeSignalSchema>;

// Position sizing calculation
export const positionSizeInputSchema = z.object({
  accountBalance: z.number().positive(),
  riskPercent: z.number().min(0.1).max(10),
  stopLossPips: z.number().positive(),
  instrument: z.enum(instruments),
});
export type PositionSizeInput = z.infer<typeof positionSizeInputSchema>;

export const positionSizeResultSchema = z.object({
  lotSize: z.number(),
  riskAmount: z.number(),
  pipValue: z.number(),
  potentialLoss: z.number(),
  potentialProfit: z.number().optional(),
});
export type PositionSizeResult = z.infer<typeof positionSizeResultSchema>;

// API response wrapper
export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    timestamp: z.string(),
  });

// Trading sessions
export const tradingSessions = ["asian", "london", "new_york", "closed"] as const;
export type TradingSession = typeof tradingSessions[number];

export const sessionInfoSchema = z.object({
  currentSession: z.enum(tradingSessions),
  sessionStart: z.string(),
  sessionEnd: z.string(),
  nextSession: z.enum(tradingSessions),
  nextSessionStart: z.string(),
  typicalVolatility: z.enum(["low", "medium", "high"]),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

// Trade journal entry
export const journalEntrySchema = z.object({
  id: z.string(),
  instrument: z.enum(instruments),
  direction: z.enum(["buy", "sell"]),
  entryPrice: z.number(),
  exitPrice: z.number().optional(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  lotSize: z.number(),
  status: z.enum(["open", "closed", "cancelled"]),
  outcome: z.enum(["win", "loss", "breakeven"]).optional(),
  pnl: z.number().optional(),
  pnlPercent: z.number().optional(),
  notes: z.string().optional(),
  entryTime: z.string(),
  exitTime: z.string().optional(),
  signalConfidence: z.number().optional(),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

export const insertJournalEntrySchema = journalEntrySchema.omit({ id: true, outcome: true, pnl: true, pnlPercent: true, exitTime: true, exitPrice: true });
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;

// Price alerts
export const priceAlertSchema = z.object({
  id: z.string(),
  instrument: z.enum(instruments),
  targetPrice: z.number(),
  condition: z.enum(["above", "below", "crosses"]),
  isActive: z.boolean(),
  isTriggered: z.boolean(),
  createdAt: z.string(),
  triggeredAt: z.string().optional(),
  note: z.string().optional(),
});
export type PriceAlert = z.infer<typeof priceAlertSchema>;

export const insertPriceAlertSchema = priceAlertSchema.omit({ id: true, isTriggered: true, triggeredAt: true });
export type InsertPriceAlert = z.infer<typeof insertPriceAlertSchema>;

// User settings/preferences
export const userSettingsSchema = z.object({
  defaultBalance: z.number().positive().default(10000),
  defaultRiskPercent: z.number().min(0.1).max(10).default(1),
  defaultStopLossPips: z.number().positive().default(20),
  preferredInstruments: z.array(z.enum(instruments)).default(["XAUUSD", "EURUSD"]),
  preferredTimeframe: z.enum(timeframes).default("1h"),
  theme: z.enum(["dark", "light"]).default("dark"),
  notifications: z.boolean().default(true),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

// Economic calendar event
export const economicEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  country: z.string(),
  impact: z.enum(["low", "medium", "high"]),
  dateTime: z.string(),
  forecast: z.string().optional(),
  previous: z.string().optional(),
  actual: z.string().optional(),
  affectedPairs: z.array(z.string()),
});
export type EconomicEvent = z.infer<typeof economicEventSchema>;

// Institutional/Smart Money levels
export const institutionalLevelSchema = z.object({
  price: z.number(),
  type: z.enum(["psychological", "liquidity_buy", "liquidity_sell", "session_high", "session_low", "order_block"]),
  label: z.string(),
  significance: z.enum(["minor", "major", "critical"]),
});
export type InstitutionalLevel = z.infer<typeof institutionalLevelSchema>;

export const smartMoneyDataSchema = z.object({
  psychologicalLevels: z.array(institutionalLevelSchema),
  liquidityZones: z.array(institutionalLevelSchema),
  sessionLevels: z.array(institutionalLevelSchema),
  orderFlow: z.object({
    bias: z.enum(["bullish", "bearish", "neutral"]),
    strength: z.number().min(0).max(100),
    description: z.string(),
  }),
  nextTargetUp: z.number().optional(),
  nextTargetDown: z.number().optional(),
});
export type SmartMoneyData = z.infer<typeof smartMoneyDataSchema>;

// Signal performance tracking
export const signalPerformanceSchema = z.object({
  totalSignals: z.number(),
  winningSignals: z.number(),
  losingSignals: z.number(),
  winRate: z.number(),
  avgRiskReward: z.number(),
  profitFactor: z.number().optional(),
  byInstrument: z.record(z.object({
    total: z.number(),
    wins: z.number(),
    winRate: z.number(),
  })),
});
export type SignalPerformance = z.infer<typeof signalPerformanceSchema>;

// Simulated trade status
export const simTradeStatuses = ["open", "tp1_hit", "tp2_hit", "sl_hit", "expired", "cancelled", "manual_close"] as const;
export type SimTradeStatus = typeof simTradeStatuses[number];

// Signal conditions - captured when signal is generated for learning
export const signalConditionsSchema = z.object({
  trendStrength: z.number().min(0).max(100),
  trendDirection: z.enum(["up", "down", "sideways"]),
  volatility: z.enum(["low", "medium", "high"]),
  marketState: z.enum(marketStates),
  nearSupport: z.boolean(),
  nearResistance: z.boolean(),
  confidenceLevel: z.enum(["low", "medium", "high"]), // <60, 60-75, >75
});
export type SignalConditions = z.infer<typeof signalConditionsSchema>;

// Simulated trade - auto-tracked from signals
export const simulatedTradeSchema = z.object({
  id: z.string(),
  userId: z.string().optional(), // Per-user trade isolation (undefined = system/legacy)
  signalId: z.string(),
  instrument: z.enum(instruments),
  timeframe: z.enum(timeframes),
  direction: z.enum(tradeDirections),
  entryPrice: z.number(),
  stopLoss: z.number(),
  takeProfit1: z.number(),
  takeProfit2: z.number().optional(),
  status: z.enum(simTradeStatuses),
  openedAt: z.string(),
  closedAt: z.string().optional(),
  closePrice: z.number().optional(),
  pnlPips: z.number().optional(),
  pnlPercent: z.number().optional(),
  lotSize: z.number().optional(),
  pnlMoney: z.number().optional(),
  highestPrice: z.number().optional(),
  lowestPrice: z.number().optional(),
  // Signal conditions for learning
  conditions: signalConditionsSchema.optional(),
  // Trailing stop fields
  oandaTradeId: z.string().optional(), // OANDA trade ID for real execution
  breakEvenApplied: z.boolean().optional(), // SL moved to entry
  halfProfitLocked: z.boolean().optional(), // SL moved to 50% profit
});
export type SimulatedTrade = z.infer<typeof simulatedTradeSchema>;

export const paperAccountCurrencies = ["GBP", "USD", "EUR"] as const;
export type PaperAccountCurrency = (typeof paperAccountCurrencies)[number];

export const paperAccountSchema = z.object({
  startingBalance: z.number().min(10).max(1000000).default(300),
  currentBalance: z.number().default(300),
  currency: z.enum(paperAccountCurrencies).default("GBP"),
  riskPercent: z.number().min(0.1).max(10).default(1),
  createdAt: z.string().optional(),
  maxDrawdown: z.number().default(0),
  peakBalance: z.number().default(300),
  totalDeposited: z.number().default(300),
});
export type PaperAccount = z.infer<typeof paperAccountSchema>;

// Learning performance - win rates by condition
export const learningPerformanceSchema = z.object({
  byTrendStrength: z.record(z.object({ total: z.number(), wins: z.number(), winRate: z.number() })),
  byVolatility: z.record(z.object({ total: z.number(), wins: z.number(), winRate: z.number() })),
  byMarketState: z.record(z.object({ total: z.number(), wins: z.number(), winRate: z.number() })),
  byTimeframe: z.record(z.object({ total: z.number(), wins: z.number(), winRate: z.number() })),
  byConfidenceLevel: z.record(z.object({ total: z.number(), wins: z.number(), winRate: z.number() })),
  bestSetups: z.array(z.object({
    description: z.string(),
    winRate: z.number(),
    totalTrades: z.number(),
    avgPnlPips: z.number(),
  })),
  worstSetups: z.array(z.object({
    description: z.string(),
    winRate: z.number(),
    totalTrades: z.number(),
    avgPnlPips: z.number(),
  })),
  overallAdjustment: z.number(), // Confidence adjustment based on learning
  minTradesForLearning: z.number(), // Minimum trades needed before adjustments apply
});
export type LearningPerformance = z.infer<typeof learningPerformanceSchema>;

// Simulation statistics
export const simulationStatsSchema = z.object({
  totalTrades: z.number(),
  openTrades: z.number(),
  closedTrades: z.number(),
  wins: z.number(),
  losses: z.number(),
  winRate: z.number(),
  totalPnlPips: z.number(),
  avgWinPips: z.number(),
  avgLossPips: z.number(),
  bestTradePips: z.number(),
  worstTradePips: z.number(),
  profitFactor: z.number(),
  byInstrument: z.record(z.object({
    total: z.number(),
    wins: z.number(),
    losses: z.number(),
    winRate: z.number(),
    pnlPips: z.number(),
  })),
  byTimeframe: z.record(z.object({
    total: z.number(),
    wins: z.number(),
    losses: z.number(),
    winRate: z.number(),
  })),
});
export type SimulationStats = z.infer<typeof simulationStatsSchema>;

// COT (Commitment of Traders) data - institutional positioning
export const cotDataSchema = z.object({
  instrument: z.string(),
  reportDate: z.string(),
  longPositions: z.number(),
  shortPositions: z.number(),
  netPosition: z.number(),
  changeFromPrevious: z.number(),
  commercialLong: z.number(),
  commercialShort: z.number(),
  nonCommercialLong: z.number(), // Speculators/hedge funds
  nonCommercialShort: z.number(),
  openInterest: z.number(),
  bias: z.enum(["bullish", "bearish", "neutral"]),
});
export type COTData = z.infer<typeof cotDataSchema>;

// Retail sentiment data
export const retailSentimentSchema = z.object({
  instrument: z.enum(instruments),
  longPercentage: z.number().min(0).max(100),
  shortPercentage: z.number().min(0).max(100),
  longVolume: z.number().optional(),
  shortVolume: z.number().optional(),
  extremeWarning: z.boolean(), // True when >75% on one side
  contrarianSignal: z.enum(["buy", "sell", "none"]).optional(),
  lastUpdated: z.string(),
});
export type RetailSentiment = z.infer<typeof retailSentimentSchema>;

// Liquidity hunt / stop hunt detection
export const liquidityHuntSchema = z.object({
  type: z.enum(["stop_hunt_up", "stop_hunt_down", "liquidity_grab"]),
  price: z.number(),
  description: z.string(),
  timestamp: z.string(),
  significance: z.enum(["minor", "moderate", "major"]),
});
export type LiquidityHunt = z.infer<typeof liquidityHuntSchema>;

// Order block detection
export const orderBlockSchema = z.object({
  price: z.number(),
  type: z.enum(["bullish", "bearish"]),
  strength: z.number().min(0).max(100),
  priceHigh: z.number(),
  priceLow: z.number(),
  timestamp: z.string(),
  stillValid: z.boolean(),
});
export type OrderBlock = z.infer<typeof orderBlockSchema>;

// Enhanced whale zone data
export const whaleZoneDataSchema = z.object({
  institutionalLevels: z.array(institutionalLevelSchema),
  orderBlocks: z.array(orderBlockSchema),
  recentLiquidityHunts: z.array(liquidityHuntSchema),
  estimatedStopClusters: z.array(z.object({
    price: z.number(),
    side: z.enum(["above", "below"]),
    estimatedVolume: z.enum(["low", "medium", "high"]),
  })),
  whaleActivity: z.enum(["accumulating", "distributing", "neutral"]),
});
export type WhaleZoneData = z.infer<typeof whaleZoneDataSchema>;

// Risk management settings
export const riskManagementSchema = z.object({
  dailyLossLimitPercent: z.number().min(1).max(20).default(5),
  maxOpenPositions: z.number().min(1).max(10).default(3),
  correlationWarningEnabled: z.boolean().default(true),
  sessionFilterEnabled: z.boolean().default(false),
  preferredSessions: z.array(z.enum(tradingSessions)).default(["london", "new_york"]),
  newsBlackoutMinutes: z.number().min(0).max(120).default(30),
  consecutiveLossLimit: z.number().min(2).max(10).default(3),
  minAccountBalance: z.number().min(10).max(1000).default(50),
});
export type RiskManagement = z.infer<typeof riskManagementSchema>;

// Daily P/L tracking with consecutive loss counter
export const dailyPnLSchema = z.object({
  date: z.string(),
  startingBalance: z.number(),
  currentPnL: z.number(),
  currentPnLPercent: z.number(),
  tradesExecuted: z.number(),
  consecutiveLosses: z.number().default(0),
  isLimitReached: z.boolean(),
  isConsecutiveLossLockout: z.boolean().default(false),
  limitReachedAt: z.string().optional(),
  lockoutReason: z.string().optional(),
});
export type DailyPnL = z.infer<typeof dailyPnLSchema>;

// Correlation data between pairs
export const correlationDataSchema = z.object({
  pair1: z.enum(instruments),
  pair2: z.enum(instruments),
  correlation: z.number().min(-1).max(1), // -1 to 1
  strength: z.enum(["weak", "moderate", "strong"]),
  warning: z.string().optional(),
});
export type CorrelationData = z.infer<typeof correlationDataSchema>;

// Real-time price from WebSocket
export const livePrice = z.object({
  instrument: z.enum(instruments),
  bid: z.number(),
  ask: z.number(),
  timestamp: z.string(),
  source: z.enum(["websocket", "api", "simulated"]),
});
export type LivePrice = z.infer<typeof livePrice>;

// Users table (keeping existing for potential auth later)
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Permanent historical data storage - fetched once, used for unlimited backtesting
export const historicalDataStore = pgTable("historical_data_store", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  instrument: text("instrument").notNull(),
  timeframe: text("timeframe").notNull(),
  candles: jsonb("candles").notNull(), // Array of OHLCV candles
  candleCount: integer("candle_count").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  source: text("source").notNull(), // "twelvedata" or "generated"
});

export const insertHistoricalDataSchema = createInsertSchema(historicalDataStore).omit({ id: true });
export type InsertHistoricalData = z.infer<typeof insertHistoricalDataSchema>;
export type HistoricalDataStore = typeof historicalDataStore.$inferSelect;

// Batch backtest results storage
export const backtestResults = pgTable("backtest_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: text("batch_id").notNull(), // Group multiple tests together
  instrument: text("instrument").notNull(),
  timeframe: text("timeframe").notNull(),
  testPeriodStart: text("test_period_start").notNull(),
  testPeriodEnd: text("test_period_end").notNull(),
  totalSignals: integer("total_signals").notNull(),
  wins: integer("wins").notNull(),
  losses: integer("losses").notNull(),
  winRate: real("win_rate").notNull(),
  profitFactor: real("profit_factor"),
  avgWinPips: real("avg_win_pips"),
  avgLossPips: real("avg_loss_pips"),
  maxDrawdown: real("max_drawdown"),
  bestPattern: text("best_pattern"),
  worstPattern: text("worst_pattern"),
  createdAt: text("created_at").notNull(),
});

export const insertBacktestResultSchema = createInsertSchema(backtestResults).omit({ id: true });
export type InsertBacktestResult = z.infer<typeof insertBacktestResultSchema>;
export type BacktestResult = typeof backtestResults.$inferSelect;

// Market regime types for backtest tagging
export const marketRegimes = ["trending_up", "trending_down", "ranging", "volatile"] as const;
export type MarketRegime = typeof marketRegimes[number];

// Signal type for categorizing different trade setups
export const signalTypeSchema = z.object({
  direction: z.enum(["buy", "sell"]),
  regime: z.enum(marketRegimes),
  confidence: z.enum(["high", "medium", "low"]),
});
export type SignalType = z.infer<typeof signalTypeSchema>;

// Strategy performance summary (aggregated from batch results)
export const strategyPerformanceSchema = z.object({
  overallWinRate: z.number(),
  totalTests: z.number(),
  totalSignals: z.number(),
  profitFactor: z.number(),
  strategyScore: z.number().min(0).max(100), // Overall reliability score
  sampleSizeStatus: z.enum(["insufficient", "minimal", "good", "excellent"]), // Based on test count
  byInstrument: z.record(z.object({
    winRate: z.number(),
    tests: z.number(),
    signals: z.number(),
    recentWinRate: z.number().optional(), // Last 3 months weighted
    sampleSufficient: z.boolean(), // 20+ tests
    confidenceAdjustment: z.number().optional(), // Boost/reduce for signals
  })),
  byTimeframe: z.record(z.object({
    winRate: z.number(),
    tests: z.number(),
    signals: z.number(),
    recentWinRate: z.number().optional(),
    sampleSufficient: z.boolean(),
    confidenceAdjustment: z.number().optional(),
  })),
  byConfidence: z.object({
    high: z.object({ winRate: z.number(), count: z.number() }),
    medium: z.object({ winRate: z.number(), count: z.number() }),
    low: z.object({ winRate: z.number(), count: z.number() }),
  }),
  byMarketRegime: z.object({
    trending_up: z.object({ winRate: z.number(), count: z.number(), recommendation: z.string() }),
    trending_down: z.object({ winRate: z.number(), count: z.number(), recommendation: z.string() }),
    ranging: z.object({ winRate: z.number(), count: z.number(), recommendation: z.string() }),
    volatile: z.object({ winRate: z.number(), count: z.number(), recommendation: z.string() }),
  }),
  bySignalType: z.record(z.object({
    winRate: z.number(),
    count: z.number(),
    sampleSufficient: z.boolean(),
    recommendation: z.string(),
  })),
  recencyAnalysis: z.object({
    recent3Months: z.object({ winRate: z.number(), tests: z.number(), weight: z.number() }),
    months3to12: z.object({ winRate: z.number(), tests: z.number(), weight: z.number() }),
    older12Months: z.object({ winRate: z.number(), tests: z.number(), weight: z.number() }),
    weightedWinRate: z.number(), // Recency-weighted overall win rate
  }),
  confidenceAdjustments: z.record(z.number()), // Key = "XAUUSD-4h", value = adjustment percentage
  recommendations: z.array(z.string()),
  warnings: z.array(z.string()), // Issues to address
  lastUpdated: z.string(),
});
export type StrategyPerformance = z.infer<typeof strategyPerformanceSchema>;

// Strategy Lab - Timeframe strategy profiles with optimized parameters (legacy)
export const timeframeStrategyProfiles = pgTable("timeframe_strategy_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timeframe: text("timeframe").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  minTrendStrength: integer("min_trend_strength").notNull().default(65),
  minConfluence: integer("min_confluence").notNull().default(2),
  slMultiplier: real("sl_multiplier").notNull().default(1.5),
  rrRatio: real("rr_ratio").notNull().default(2.0),
  maxVolatility: text("max_volatility").notNull().default("medium"),
  requireMTFConfluence: boolean("require_mtf_confluence").notNull().default(true),
  minConfidence: integer("min_confidence").notNull().default(70),
  optimizedWinRate: real("optimized_win_rate"),
  optimizedProfitFactor: real("optimized_profit_factor"),
  totalBacktests: integer("total_backtests").default(0),
  lastOptimizedAt: text("last_optimized_at"),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at"),
});

export const insertTimeframeStrategyProfileSchema = createInsertSchema(timeframeStrategyProfiles).omit({ id: true, createdAt: true });
export type InsertTimeframeStrategyProfile = z.infer<typeof insertTimeframeStrategyProfileSchema>;
export type TimeframeStrategyProfile = typeof timeframeStrategyProfiles.$inferSelect;

// Auto-optimized strategy profiles - per instrument+timeframe, fully automatic
export const autoOptimizedProfiles = pgTable("auto_optimized_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  instrument: text("instrument").notNull(),
  timeframe: text("timeframe").notNull(),
  status: text("status").notNull().default("optimizing"), // "active", "optimizing", "paused", "insufficient_data"
  minTrendStrength: integer("min_trend_strength").notNull().default(65),
  minConfluence: integer("min_confluence").notNull().default(2),
  slMultiplier: real("sl_multiplier").notNull().default(1.5),
  rrRatio: real("rr_ratio").notNull().default(2.0),
  maxVolatility: text("max_volatility").notNull().default("medium"),
  requireMTFConfluence: boolean("require_mtf_confluence").notNull().default(true),
  minConfidence: integer("min_confidence").notNull().default(70),
  winRate: real("win_rate"),
  profitFactor: real("profit_factor"),
  expectancy: real("expectancy"),
  totalSignals: integer("total_signals").default(0),
  wins: integer("wins").default(0),
  losses: integer("losses").default(0),
  confidenceScore: real("confidence_score").default(0),
  walkForwardWinRate: real("walk_forward_win_rate"),
  lastOptimizedAt: text("last_optimized_at"),
  optimizationCount: integer("optimization_count").default(0),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at"),
});

export const insertAutoOptimizedProfileSchema = createInsertSchema(autoOptimizedProfiles).omit({ id: true, createdAt: true });
export type InsertAutoOptimizedProfile = z.infer<typeof insertAutoOptimizedProfileSchema>;
export type AutoOptimizedProfile = typeof autoOptimizedProfiles.$inferSelect;

// Optimization history log - tracks each optimization run
export const optimizationHistory = pgTable("optimization_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  instrument: text("instrument").notNull(),
  timeframe: text("timeframe").notNull(),
  trigger: text("trigger").notNull(), // "scheduled", "performance_decay", "initial", "manual"
  paramsTested: integer("params_tested").notNull(),
  bestWinRate: real("best_win_rate"),
  bestProfitFactor: real("best_profit_factor"),
  bestExpectancy: real("best_expectancy"),
  walkForwardWinRate: real("walk_forward_win_rate"),
  applied: boolean("applied").notNull().default(false),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

export const insertOptimizationHistorySchema = createInsertSchema(optimizationHistory).omit({ id: true, createdAt: true });
export type InsertOptimizationHistory = z.infer<typeof insertOptimizationHistorySchema>;
export type OptimizationHistoryRecord = typeof optimizationHistory.$inferSelect;

// Optimization run results - stores individual parameter test results (legacy)
export const optimizationResults = pgTable("optimization_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: text("run_id").notNull(),
  timeframe: text("timeframe").notNull(),
  instrument: text("instrument"),
  trendStrength: integer("trend_strength").notNull(),
  confluence: integer("confluence").notNull(),
  slMultiplier: real("sl_multiplier").notNull(),
  rrRatio: real("rr_ratio").notNull(),
  maxVolatility: text("max_volatility").notNull(),
  totalSignals: integer("total_signals").notNull(),
  wins: integer("wins").notNull(),
  losses: integer("losses").notNull(),
  winRate: real("win_rate").notNull(),
  profitFactor: real("profit_factor"),
  avgWinPips: real("avg_win_pips"),
  avgLossPips: real("avg_loss_pips"),
  expectancy: real("expectancy"),
  score: real("score"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

export const insertOptimizationResultSchema = createInsertSchema(optimizationResults).omit({ id: true, createdAt: true });
export type InsertOptimizationResult = z.infer<typeof insertOptimizationResultSchema>;
export type OptimizationResult = typeof optimizationResults.$inferSelect;

// Strategy parameters schema for API
export const strategyParametersSchema = z.object({
  minTrendStrength: z.number().min(40).max(90).default(65),
  minConfluence: z.number().min(1).max(5).default(2),
  slMultiplier: z.number().min(0.5).max(5).default(1.5),
  rrRatio: z.number().min(1).max(5).default(2),
  maxVolatility: z.enum(["low", "medium", "high"]).default("medium"),
  requireMTFConfluence: z.boolean().default(true),
  minConfidence: z.number().min(50).max(90).default(70),
});
export type StrategyParameters = z.infer<typeof strategyParametersSchema>;

// Optimization run status (legacy)
export const optimizationRunSchema = z.object({
  runId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  timeframe: z.string(),
  totalCombinations: z.number(),
  completedCombinations: z.number(),
  bestWinRate: z.number().optional(),
  bestParameters: strategyParametersSchema.optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});
export type OptimizationRun = z.infer<typeof optimizationRunSchema>;

// Re-export auth models (users table is now in shared/models/auth.ts)
export * from "./models/auth";

// User OANDA credentials - per-user broker connection
export const userOandaCredentials = pgTable("user_oanda_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(), // References auth user
  apiKey: text("api_key").notNull(),
  accountId: text("account_id").notNull(),
  environment: text("environment").notNull().default("demo"), // "demo" or "live"
  isConnected: boolean("is_connected").notNull().default(false),
  lastConnected: text("last_connected"),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at"),
});

export const insertUserOandaCredentialsSchema = createInsertSchema(userOandaCredentials).omit({ id: true, createdAt: true });
export type InsertUserOandaCredentials = z.infer<typeof insertUserOandaCredentialsSchema>;
export type UserOandaCredentialsRecord = typeof userOandaCredentials.$inferSelect;

// Push notification subscriptions - persistent storage for web push subscriptions
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  instruments: jsonb("instruments").notNull().default(["XAUUSD", "GBPUSD", "EURUSD"]),
  minConfidence: integer("min_confidence").notNull().default(70),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at"),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptionsTable).omit({ id: true, createdAt: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscriptionRecord = typeof pushSubscriptionsTable.$inferSelect;

// Persistent trade journal - actual trades taken by user (per-user)
export const tradeJournalTable = pgTable("trade_journal", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // Per-user trade isolation (null = system/legacy)
  instrument: text("instrument").notNull(),
  direction: text("direction").notNull(), // "buy" or "sell"
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  stopLoss: real("stop_loss"),
  takeProfit: real("take_profit"),
  lotSize: real("lot_size").notNull(),
  status: text("status").notNull().default("closed"), // "open", "closed", "cancelled"
  outcome: text("outcome"), // "win", "loss", "breakeven"
  pnlGBP: real("pnl_gbp"), // Profit/loss in GBP
  pnlPips: real("pnl_pips"), // Profit/loss in pips
  notes: text("notes"),
  signalConfidence: integer("signal_confidence"),
  timeframe: text("timeframe"),
  entryTime: text("entry_time").notNull(),
  exitTime: text("exit_time"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

export const insertTradeJournalSchema = createInsertSchema(tradeJournalTable).omit({ id: true, createdAt: true });
export type InsertTradeJournal = z.infer<typeof insertTradeJournalSchema>;
export type TradeJournalRecord = typeof tradeJournalTable.$inferSelect;

// Persistent signal history - all signals generated by the app
export const signalHistoryTable = pgTable("signal_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  instrument: text("instrument").notNull(),
  timeframe: text("timeframe").notNull(),
  direction: text("direction").notNull(), // "buy", "sell", "stand_aside"
  confidence: integer("confidence").notNull(),
  entryLow: real("entry_low").notNull(),
  entryHigh: real("entry_high").notNull(),
  stopLoss: real("stop_loss").notNull(),
  takeProfit1: real("take_profit_1").notNull(),
  takeProfit2: real("take_profit_2"),
  riskRewardRatio: real("risk_reward_ratio").notNull(),
  reasoning: jsonb("reasoning").notNull(), // Array of strings
  marketState: text("market_state"),
  trendStrength: integer("trend_strength"),
  volatility: text("volatility"),
  outcome: text("outcome"), // "tp1_hit", "tp2_hit", "sl_hit", "expired", null if still active
  outcomePrice: real("outcome_price"),
  outcomeTime: text("outcome_time"),
  generatedAt: text("generated_at").notNull(),
  expiresAt: text("expires_at"),
});

export const insertSignalHistorySchema = createInsertSchema(signalHistoryTable).omit({ id: true });
export type InsertSignalHistory = z.infer<typeof insertSignalHistorySchema>;
export type SignalHistoryRecord = typeof signalHistoryTable.$inferSelect;

// Simulated trades table - persistent storage for auto-tracked trades (per-user)
export const simulatedTradesTable = pgTable("simulated_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // Per-user trade isolation (null = system/legacy)
  signalId: text("signal_id").notNull(),
  instrument: text("instrument").notNull(),
  timeframe: text("timeframe").notNull(),
  direction: text("direction").notNull(), // "buy", "sell"
  entryPrice: real("entry_price").notNull(),
  stopLoss: real("stop_loss").notNull(),
  takeProfit1: real("take_profit_1").notNull(),
  takeProfit2: real("take_profit_2"),
  status: text("status").notNull().default("open"), // "open", "tp1_hit", "tp2_hit", "sl_hit", "expired", "cancelled"
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
  closePrice: real("close_price"),
  pnlPips: real("pnl_pips"),
  pnlPercent: real("pnl_percent"),
  lotSize: real("lot_size"),
  pnlMoney: real("pnl_money"),
  highestPrice: real("highest_price"),
  lowestPrice: real("lowest_price"),
  // Signal conditions for learning - stored as JSON
  conditions: jsonb("conditions"), // SignalConditions object
  // Trailing stop fields
  oandaTradeId: text("oanda_trade_id"), // OANDA trade ID for real execution
  breakEvenApplied: boolean("break_even_applied").default(false), // SL moved to entry
  halfProfitLocked: boolean("half_profit_locked").default(false), // SL moved to 50% profit
});

export const insertSimulatedTradeSchema = createInsertSchema(simulatedTradesTable).omit({ id: true });
export type InsertSimulatedTrade = z.infer<typeof insertSimulatedTradeSchema>;
export type SimulatedTradeRecord = typeof simulatedTradesTable.$inferSelect;

// User settings table - persistent storage for risk management and preferences (per-user)
export const userSettingsTable = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").unique(), // Per-user settings (null = system defaults)
  dailyLossLimitPercent: real("daily_loss_limit_percent").notNull().default(5),
  maxOpenPositions: integer("max_open_positions").notNull().default(3),
  correlationWarningEnabled: boolean("correlation_warning_enabled").notNull().default(true),
  sessionFilterEnabled: boolean("session_filter_enabled").notNull().default(false),
  preferredSessions: jsonb("preferred_sessions").notNull().default(["london", "new_york"]),
  newsBlackoutMinutes: integer("news_blackout_minutes").notNull().default(30),
  consecutiveLossLimit: integer("consecutive_loss_limit").notNull().default(3),
  minAccountBalance: real("min_account_balance").notNull().default(50),
  defaultAccountBalance: real("default_account_balance").notNull().default(10000),
  defaultRiskPercent: real("default_risk_percent").notNull().default(1),
  simulationEnabled: boolean("simulation_enabled").notNull().default(true),
  autoExecuteEnabled: boolean("auto_execute_enabled").notNull().default(false), // Per-user auto-trade toggle
  maxAutoExecuteRiskPercent: real("max_auto_execute_risk_percent").notNull().default(0), // 0 = match user's risk percent (strictest), >0 = custom limit, block if actual risk exceeds this %
  maxDailyTrades: integer("max_daily_trades").notNull().default(10),
  paperStartingBalance: real("paper_starting_balance").notNull().default(300),
  paperCurrentBalance: real("paper_current_balance").notNull().default(300),
  paperCurrency: text("paper_currency").notNull().default("GBP"),
  paperRiskPercent: real("paper_risk_percent").notNull().default(1),
  paperPeakBalance: real("paper_peak_balance").notNull().default(300),
  paperMaxDrawdown: real("paper_max_drawdown").notNull().default(0),
  paperCreatedAt: text("paper_created_at"),
  showOnLeaderboard: boolean("show_on_leaderboard").notNull().default(true),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  displayName: text("display_name"),
  simulationInstruments: jsonb("simulation_instruments"),
  simulationTimeframes: jsonb("simulation_timeframes"),
  oandaInstruments: jsonb("oanda_instruments"),
  oandaTimeframes: jsonb("oanda_timeframes"),
  telegramEnabled: boolean("telegram_enabled").default(false),
  telegramChatId: text("telegram_chat_id"),
  telegramAutoExecute: boolean("telegram_auto_execute").default(false),
  telegramRiskPercent: real("telegram_risk_percent").notNull().default(0.5),
  telegramAccountType: text("telegram_account_type").notNull().default("paper"),
  confidenceBoostThreshold: real("confidence_boost_threshold"),
  confidenceBoostMultiplier: real("confidence_boost_multiplier"),
  guardianEnabled: boolean("guardian_enabled").notNull().default(true),
  maxTradeDurationHours: real("max_trade_duration_hours").notNull().default(8),
  timeframeDurations: jsonb("timeframe_durations"),
  updatedAt: text("updated_at"),
});

export type UserSettingsRecord = typeof userSettingsTable.$inferSelect;
export const insertUserSettingsSchema = createInsertSchema(userSettingsTable).omit({ id: true });
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;

// User audit log - tracks all user actions for accountability
export const userAuditLogTable = pgTable("user_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  action: text("action").notNull(), // "login", "logout", "oanda_connect", "trade_execute", "settings_update", etc.
  details: jsonb("details"), // Additional context (instrument, trade ID, etc.)
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

export const insertUserAuditLogSchema = createInsertSchema(userAuditLogTable).omit({ id: true, createdAt: true });
export type InsertUserAuditLog = z.infer<typeof insertUserAuditLogSchema>;
export type UserAuditLogRecord = typeof userAuditLogTable.$inferSelect;

// Micro-scalper trades table - rapid-fire trades from the Instant Profit Trapper
export const microScalperTradesTable = pgTable("micro_scalper_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  instrument: text("instrument").notNull(),
  direction: text("direction").notNull(),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  stopLoss: real("stop_loss").notNull(),
  takeProfit: real("take_profit").notNull(),
  status: text("status").notNull().default("open"),
  lotSize: real("lot_size").notNull(),
  pnlPips: real("pnl_pips"),
  pnlMoney: real("pnl_money"),
  spread: real("spread"),
  momentumPips: real("momentum_pips"),
  breakEvenApplied: boolean("break_even_applied").default(false),
  trailingStopPrice: real("trailing_stop_price"),
  oandaTradeId: text("oanda_trade_id"),
  exitReason: text("exit_reason"),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
});

export const insertMicroScalperTradeSchema = createInsertSchema(microScalperTradesTable).omit({ id: true });
export type InsertMicroScalperTrade = z.infer<typeof insertMicroScalperTradeSchema>;
export type MicroScalperTradeRecord = typeof microScalperTradesTable.$inferSelect;

// Micro-scalper account settings - separate paper account for scalper
export const microScalperSettingsTable = pgTable("micro_scalper_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  startingBalance: real("starting_balance").notNull().default(500),
  currentBalance: real("current_balance").notNull().default(500),
  currency: text("currency").notNull().default("GBP"),
  riskPercent: real("risk_percent").notNull().default(0.5),
  peakBalance: real("peak_balance").notNull().default(500),
  maxDrawdown: real("max_drawdown").notNull().default(0),
  maxTradesPerHour: integer("max_trades_per_hour").notNull().default(25),
  dailyLossLimit: real("daily_loss_limit").notNull().default(25),
  maxSpreadPips: real("max_spread_pips").notNull().default(2),
  momentumThresholdPips: real("momentum_threshold_pips").notNull().default(3),
  momentumWindowSeconds: integer("momentum_window_seconds").notNull().default(5),
  takeProfitPips: real("take_profit_pips").notNull().default(8),
  trailingDistancePips: real("trailing_distance_pips").notNull().default(3),
  maxTradeSeconds: integer("max_trade_seconds").notNull().default(60),
  tradingPairs: jsonb("trading_pairs").notNull().default(["EURUSD", "GBPUSD", "USDCHF"]),
  sessionFilter: boolean("session_filter").notNull().default(true),
  profileType: text("profile_type").notNull().default("balanced"),
  oandaEnabled: boolean("oanda_enabled").notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at"),
});

export const insertMicroScalperSettingsSchema = createInsertSchema(microScalperSettingsTable).omit({ id: true, createdAt: true });
export type InsertMicroScalperSettings = z.infer<typeof insertMicroScalperSettingsSchema>;
export type MicroScalperSettingsRecord = typeof microScalperSettingsTable.$inferSelect;

export const oandaActivityLogTable = pgTable("oanda_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  action: text("action").notNull(),
  instrument: text("instrument"),
  direction: text("direction"),
  details: text("details"),
  tradeId: text("trade_id"),
  pnl: real("pnl"),
  units: integer("units"),
  source: text("source").notNull().default("system"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

export type OandaActivityLogRecord = typeof oandaActivityLogTable.$inferSelect;

export const oandaBalanceSnapshots = pgTable("oanda_balance_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  balance: real("balance").notNull(),
  equity: real("equity").notNull(),
  unrealizedPL: real("unrealized_pl").notNull().default(0),
  openTradeCount: integer("open_trade_count").notNull().default(0),
  currency: text("currency").notNull().default("GBP"),
  environment: text("environment").notNull().default("demo"),
  snapshotAt: text("snapshot_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("idx_balance_snapshots_user_time").on(table.userId, table.snapshotAt),
]);

export type OandaBalanceSnapshot = typeof oandaBalanceSnapshots.$inferSelect;

// Commission balances - tracks each user's commission deposit balance
export const commissionBalances = pgTable("commission_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  balance: real("balance").notNull().default(0),
  initialDeposit: real("initial_deposit").notNull().default(0),
  autoTopUpEnabled: boolean("auto_top_up_enabled").notNull().default(true),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  tradingPaused: boolean("trading_paused").notNull().default(false),
  gracePeriodStart: text("grace_period_start"),
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at"),
});

export const insertCommissionBalanceSchema = createInsertSchema(commissionBalances).omit({ id: true, createdAt: true });
export type InsertCommissionBalance = z.infer<typeof insertCommissionBalanceSchema>;
export type CommissionBalanceRecord = typeof commissionBalances.$inferSelect;

// Commission ledger - tracks every deposit, deduction, and top-up
export const commissionLedger = pgTable("commission_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(), // "deposit", "commission_deduction", "auto_top_up", "manual_credit", "refund"
  amount: real("amount").notNull(), // positive for deposits, negative for deductions
  balanceAfter: real("balance_after").notNull(),
  tradeId: text("trade_id"), // linked trade for commission deductions
  instrument: text("instrument"),
  tradePnl: real("trade_pnl"), // the profit from the trade
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  description: text("description"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

export const insertCommissionLedgerSchema = createInsertSchema(commissionLedger).omit({ id: true, createdAt: true });
export type InsertCommissionLedger = z.infer<typeof insertCommissionLedgerSchema>;
export type CommissionLedgerRecord = typeof commissionLedger.$inferSelect;

export const quizProgress = pgTable("quiz_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  totalScore: integer("total_score").notNull().default(0),
  bestStreak: integer("best_streak").notNull().default(0),
  quizAnswered: integer("quiz_answered").notNull().default(0),
  candleAnswered: integer("candle_answered").notNull().default(0),
  tradeAnswered: integer("trade_answered").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
});

export type QuizProgressRecord = typeof quizProgress.$inferSelect;
