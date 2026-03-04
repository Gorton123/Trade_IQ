import type { 
  Candle, 
  MarketAnalysis, 
  MarketState, 
  SRLevel, 
  TradeSignal,
  Instrument,
  Timeframe,
  TradeDirection,
  SmartMoneyData,
  InstitutionalLevel
} from "@shared/schema";

// Strategy parameters interface - can be customized per timeframe
export interface StrategyParameters {
  minTrendStrength: number;  // Default 65%
  minConfluence: number;     // Default 2
  slMultiplier: number;      // Default 1.5x ATR
  rrRatio: number;           // Default 2.0 R:R
  maxVolatility: string;     // "low", "medium", or "high"
  requireMTFConfluence: boolean;
  minConfidence: number;     // Default 70%
}

// Default strategy parameters (the production-proven settings)
export const DEFAULT_STRATEGY_PARAMS: StrategyParameters = {
  minTrendStrength: 55,
  minConfluence: 2,
  slMultiplier: 1.5,
  rrRatio: 2.0,
  maxVolatility: "medium",
  requireMTFConfluence: true,
  minConfidence: 70,
};

// Cache for active strategy profiles per timeframe (consensus across instruments)
let activeStrategyProfiles: Map<string, StrategyParameters> = new Map();

// Cache for active strategy profiles per instrument+timeframe (specific to each pair)
let activeInstrumentProfiles: Map<string, StrategyParameters> = new Map();

// Track which instrument+timeframe combos have been validated by the optimizer
let approvedInstrumentTimeframes: Set<string> = new Set();

// Function to update cached profiles (called from routes when profiles change)
export function updateActiveStrategyProfile(timeframe: string, params: StrategyParameters | null) {
  if (params) {
    activeStrategyProfiles.set(timeframe, params);
    console.log(`[StrategyParams] Updated profile for ${timeframe}:`, params);
  } else {
    activeStrategyProfiles.delete(timeframe);
    console.log(`[StrategyParams] Removed profile for ${timeframe}, using defaults`);
  }
}

// Function to update per-instrument+timeframe profiles
export function updateInstrumentProfile(instrument: string, timeframe: string, params: StrategyParameters | null) {
  const key = `${instrument}_${timeframe}`;
  if (params) {
    activeInstrumentProfiles.set(key, params);
    approvedInstrumentTimeframes.add(key);
  } else {
    activeInstrumentProfiles.delete(key);
    approvedInstrumentTimeframes.delete(key);
  }
}

// Check if an instrument+timeframe combo has been approved by the optimizer
export function isInstrumentApprovedForTrading(instrument: string, timeframe: string): boolean {
  return approvedInstrumentTimeframes.has(`${instrument}_${timeframe}`);
}

// Get all approved instrument+timeframe combos
export function getApprovedInstrumentTimeframes(): string[] {
  return Array.from(approvedInstrumentTimeframes);
}

// Clear all approved instruments (called before re-applying profiles)
export function clearApprovedInstruments() {
  approvedInstrumentTimeframes.clear();
  activeInstrumentProfiles.clear();
  rejectedInstrumentTimeframes.clear();
}

const rejectedInstrumentTimeframes = new Set<string>();

export function addRejectedInstrument(instrument: string, timeframe: string) {
  rejectedInstrumentTimeframes.add(`${instrument}_${timeframe}`);
}

export function isInstrumentRejected(instrument: string, timeframe: string): boolean {
  return rejectedInstrumentTimeframes.has(`${instrument}_${timeframe}`);
}

// Get strategy parameters for a specific instrument+timeframe, fallback to timeframe consensus, then defaults
export function getStrategyParamsForInstrument(instrument: string, timeframe: string): StrategyParameters {
  return activeInstrumentProfiles.get(`${instrument}_${timeframe}`) || 
         activeStrategyProfiles.get(timeframe) || 
         DEFAULT_STRATEGY_PARAMS;
}

// Get strategy parameters for a timeframe (uses active profile or defaults)
export function getStrategyParamsForTimeframe(timeframe: string): StrategyParameters {
  return activeStrategyProfiles.get(timeframe) || DEFAULT_STRATEGY_PARAMS;
}

export function analyzeMarket(
  instrument: Instrument,
  timeframe: Timeframe,
  candles: Candle[],
  currentPrice: number
): MarketAnalysis {
  if (candles.length < 20) {
    return createDefaultAnalysis(instrument, timeframe, currentPrice);
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  // Calculate trend
  const trendResult = calculateTrend(closes);
  
  // Detect market state
  const marketState = detectMarketState(closes, highs, lows);
  
  // Calculate volatility
  const volatility = calculateVolatility(closes);
  
  // Detect support/resistance levels
  const { supportLevels, resistanceLevels } = detectSRLevels(candles, currentPrice);

  // Calculate previous close for change percent
  const previousClose = candles.length > 1 ? candles[1].close : currentPrice;
  const changePercent = ((currentPrice - previousClose) / previousClose) * 100;

  return {
    instrument,
    timeframe,
    currentPrice,
    previousClose,
    changePercent,
    marketState,
    trend: trendResult,
    supportLevels,
    resistanceLevels,
    volatility,
    lastUpdated: new Date().toISOString(),
  };
}

function createDefaultAnalysis(
  instrument: Instrument,
  timeframe: Timeframe,
  currentPrice: number
): MarketAnalysis {
  return {
    instrument,
    timeframe,
    currentPrice,
    previousClose: currentPrice,
    changePercent: 0,
    marketState: "ranging",
    trend: { direction: "sideways", strength: 50 },
    supportLevels: [],
    resistanceLevels: [],
    volatility: "medium",
    lastUpdated: new Date().toISOString(),
  };
}

function calculateTrend(closes: number[]): { direction: "up" | "down" | "sideways"; strength: number } {
  if (closes.length < 20) {
    return { direction: "sideways", strength: 50 };
  }

  // Calculate EMAs
  const ema10 = calculateEMA(closes, 10);
  const ema20 = calculateEMA(closes, 20);

  // Calculate price momentum
  const recentCloses = closes.slice(0, 10);
  const olderCloses = closes.slice(10, 20);
  const recentAvg = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
  const olderAvg = olderCloses.reduce((a, b) => a + b, 0) / olderCloses.length;

  const priceMomentum = ((recentAvg - olderAvg) / olderAvg) * 100;
  const emaDiff = ((ema10 - ema20) / ema20) * 100;

  // Determine direction
  let direction: "up" | "down" | "sideways" = "sideways";
  if (ema10 > ema20 && priceMomentum > 0.05) {
    direction = "up";
  } else if (ema10 < ema20 && priceMomentum < -0.05) {
    direction = "down";
  }

  // Calculate strength (0-100)
  const strength = Math.min(100, Math.max(0, 50 + Math.abs(emaDiff) * 10 + Math.abs(priceMomentum) * 5));

  return { direction, strength: Math.round(strength) };
}

function calculateEMA(data: number[], period: number): number {
  if (data.length < period) return data[0] || 0;
  
  const k = 2 / (period + 1);
  let ema = data.slice(-period).reduce((a, b) => a + b, 0) / period;

  for (let i = data.length - period - 1; i >= 0; i--) {
    ema = data[i] * k + ema * (1 - k);
  }

  return ema;
}

function detectMarketState(closes: number[], highs: number[], lows: number[]): MarketState {
  if (closes.length < 20) return "ranging";

  const trend = calculateTrend(closes);
  const volatility = calculateVolatilityValue(closes);
  const avgVolatility = volatility.reduce((a, b) => a + b, 0) / volatility.length;

  // Check for high volatility (high risk)
  const recentVolatility = volatility.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  if (recentVolatility > avgVolatility * 2) {
    return "high_risk";
  }

  // Determine trend states
  if (trend.direction === "up" && trend.strength > 60) {
    return "uptrend";
  }
  if (trend.direction === "down" && trend.strength > 60) {
    return "downtrend";
  }

  // Check for ranging market (ADX-like concept)
  const rangeRatio = calculateRangeRatio(highs, lows, closes);
  if (rangeRatio < 0.3) {
    return "ranging";
  }

  // Default to no clear state
  if (trend.strength < 40) {
    return "no_trade";
  }

  return "ranging";
}

function calculateRangeRatio(highs: number[], lows: number[], closes: number[]): number {
  const period = Math.min(14, closes.length);
  let upMove = 0;
  let downMove = 0;

  for (let i = 0; i < period - 1; i++) {
    const diff = closes[i] - closes[i + 1];
    if (diff > 0) upMove += diff;
    else downMove -= diff;
  }

  if (upMove + downMove === 0) return 0;
  return Math.abs(upMove - downMove) / (upMove + downMove);
}

function calculateVolatility(closes: number[]): "low" | "medium" | "high" {
  const volatility = calculateVolatilityValue(closes);
  const avgVolatility = volatility.reduce((a, b) => a + b, 0) / volatility.length;
  
  const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
  const normalizedVol = (avgVolatility / avgPrice) * 100;

  if (normalizedVol < 0.3) return "low";
  if (normalizedVol > 0.8) return "high";
  return "medium";
}

function calculateVolatilityValue(closes: number[]): number[] {
  const volatility: number[] = [];
  for (let i = 0; i < closes.length - 1; i++) {
    volatility.push(Math.abs(closes[i] - closes[i + 1]));
  }
  return volatility;
}

function detectSRLevels(
  candles: Candle[],
  currentPrice: number
): { supportLevels: SRLevel[]; resistanceLevels: SRLevel[] } {
  const supportLevels: SRLevel[] = [];
  const resistanceLevels: SRLevel[] = [];

  if (candles.length < 10) {
    return { supportLevels, resistanceLevels };
  }

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const prices = [...highs, ...lows];
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const tolerance = avgPrice * 0.002; // 0.2% tolerance for grouping

  // Find swing highs and lows
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const isSwingHigh = candles[i].high > candles[i - 1].high && 
                        candles[i].high > candles[i - 2].high &&
                        candles[i].high > candles[i + 1].high &&
                        candles[i].high > candles[i + 2].high;
    
    const isSwingLow = candles[i].low < candles[i - 1].low && 
                       candles[i].low < candles[i - 2].low &&
                       candles[i].low < candles[i + 1].low &&
                       candles[i].low < candles[i + 2].low;

    if (isSwingHigh) swingHighs.push(candles[i].high);
    if (isSwingLow) swingLows.push(candles[i].low);
  }

  // Group nearby levels
  const groupedResistance = groupLevels(swingHighs, tolerance);
  const groupedSupport = groupLevels(swingLows, tolerance);

  // Convert to SR levels
  groupedResistance.forEach(({ price, count }) => {
    if (price > currentPrice) {
      resistanceLevels.push({
        price,
        strength: count >= 3 ? "strong" : count >= 2 ? "moderate" : "weak",
        type: "resistance",
        touches: count,
      });
    }
  });

  groupedSupport.forEach(({ price, count }) => {
    if (price < currentPrice) {
      supportLevels.push({
        price,
        strength: count >= 3 ? "strong" : count >= 2 ? "moderate" : "weak",
        type: "support",
        touches: count,
      });
    }
  });

  // Limit to top 3 each
  return {
    supportLevels: supportLevels.sort((a, b) => b.price - a.price).slice(0, 3),
    resistanceLevels: resistanceLevels.sort((a, b) => a.price - b.price).slice(0, 3),
  };
}

function groupLevels(prices: number[], tolerance: number): { price: number; count: number }[] {
  const groups: { price: number; count: number }[] = [];

  prices.forEach(price => {
    const existingGroup = groups.find(g => Math.abs(g.price - price) <= tolerance);
    if (existingGroup) {
      existingGroup.price = (existingGroup.price * existingGroup.count + price) / (existingGroup.count + 1);
      existingGroup.count++;
    } else {
      groups.push({ price, count: 1 });
    }
  });

  return groups.filter(g => g.count >= 1);
}

// RSI Calculation - Key indicator for divergence detection
export function calculateRSI(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) return [];
  
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  // Calculate initial gains and losses
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // Calculate first average gain/loss
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  // First RSI value
  if (avgLoss === 0) {
    rsi.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  
  // Calculate remaining RSI values using smoothed averages
  for (let i = period; i < gains.length; i++) {
    avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  
  return rsi;
}

// RSI Divergence Detection - Catches big reversal moves like the Gold sell
export interface DivergenceSignal {
  type: "bullish" | "bearish";
  strength: "strong" | "regular" | "hidden";
  description: string;
}

export function detectRSIDivergence(candles: Candle[], lookback: number = 20): DivergenceSignal | null {
  if (candles.length < lookback + 14) return null;
  
  const closes = candles.slice(0, lookback + 14).map(c => c.close).reverse();
  const highs = candles.slice(0, lookback + 14).map(c => c.high).reverse();
  const lows = candles.slice(0, lookback + 14).map(c => c.low).reverse();
  const rsiValues = calculateRSI(closes);
  
  if (rsiValues.length < lookback) return null;
  
  // Align RSI with price data (RSI starts at period+1)
  const alignedRSI = rsiValues.slice(-lookback);
  const alignedHighs = highs.slice(-lookback);
  const alignedLows = lows.slice(-lookback);
  
  // Find swing points in last lookback period
  const swingHighs: { index: number; price: number; rsi: number }[] = [];
  const swingLows: { index: number; price: number; rsi: number }[] = [];
  
  for (let i = 2; i < alignedHighs.length - 2; i++) {
    // Swing high
    if (alignedHighs[i] > alignedHighs[i-1] && alignedHighs[i] > alignedHighs[i-2] &&
        alignedHighs[i] > alignedHighs[i+1] && alignedHighs[i] > alignedHighs[i+2]) {
      swingHighs.push({ index: i, price: alignedHighs[i], rsi: alignedRSI[i] });
    }
    // Swing low  
    if (alignedLows[i] < alignedLows[i-1] && alignedLows[i] < alignedLows[i-2] &&
        alignedLows[i] < alignedLows[i+1] && alignedLows[i] < alignedLows[i+2]) {
      swingLows.push({ index: i, price: alignedLows[i], rsi: alignedRSI[i] });
    }
  }
  
  // Check for bearish divergence (price higher high, RSI lower high) - SELL signal
  // This is what caught the Gold ATH reversal!
  if (swingHighs.length >= 2) {
    const recent = swingHighs[swingHighs.length - 1];
    const previous = swingHighs[swingHighs.length - 2];
    
    // Price making higher high but RSI making lower high
    if (recent.price > previous.price && recent.rsi < previous.rsi - 3) {
      const strength = recent.rsi > 70 ? "strong" : (recent.rsi < previous.rsi - 8) ? "strong" : "regular";
      return {
        type: "bearish",
        strength,
        description: `Bearish divergence: Price higher high ($${recent.price.toFixed(2)}) but RSI lower (${recent.rsi.toFixed(0)} < ${previous.rsi.toFixed(0)})`
      };
    }
  }
  
  // Check for bullish divergence (price lower low, RSI higher low) - BUY signal
  if (swingLows.length >= 2) {
    const recent = swingLows[swingLows.length - 1];
    const previous = swingLows[swingLows.length - 2];
    
    // Price making lower low but RSI making higher low
    if (recent.price < previous.price && recent.rsi > previous.rsi + 3) {
      const strength = recent.rsi < 30 ? "strong" : (recent.rsi > previous.rsi + 8) ? "strong" : "regular";
      return {
        type: "bullish",
        strength,
        description: `Bullish divergence: Price lower low ($${recent.price.toFixed(2)}) but RSI higher (${recent.rsi.toFixed(0)} > ${previous.rsi.toFixed(0)})`
      };
    }
  }
  
  return null;
}

// Smart Money / Institutional Analysis
export function analyzeSmartMoney(
  instrument: Instrument,
  currentPrice: number,
  candles: Candle[]
): SmartMoneyData {
  const isMetal = instrument === "XAUUSD" || instrument === "XAGUSD";
  
  // Calculate psychological levels (round numbers institutions watch)
  const psychologicalLevels = calculatePsychologicalLevels(currentPrice, isMetal, instrument);
  
  // Calculate liquidity zones (where retail stops cluster)
  const liquidityZones = calculateLiquidityZones(currentPrice, candles, isMetal, instrument);
  
  // Calculate session levels
  const sessionLevels = calculateSessionLevels(currentPrice, candles, isMetal, instrument);
  
  // Analyze order flow from candles
  const orderFlow = analyzeOrderFlow(candles);
  
  // Find next targets based on analysis
  const nextTargetUp = findNextTarget(currentPrice, [...psychologicalLevels, ...liquidityZones], "up");
  const nextTargetDown = findNextTarget(currentPrice, [...psychologicalLevels, ...liquidityZones], "down");

  return {
    psychologicalLevels,
    liquidityZones,
    sessionLevels,
    orderFlow,
    nextTargetUp,
    nextTargetDown,
  };
}

function calculatePsychologicalLevels(currentPrice: number, isMetal: boolean, instrument: Instrument): InstitutionalLevel[] {
  const levels: InstitutionalLevel[] = [];
  
  if (instrument === "XAUUSD") {
    // For gold, major levels at $50 intervals, critical at $100
    const base = Math.floor(currentPrice / 100) * 100;
    
    // Add levels around current price
    for (let offset = -200; offset <= 200; offset += 50) {
      const price = base + offset;
      if (Math.abs(price - currentPrice) < 5) continue; // Skip if too close to current
      
      const isCritical = price % 100 === 0;
      const isMajor = price % 50 === 0 && !isCritical;
      
      levels.push({
        price,
        type: "psychological",
        label: `$${price.toLocaleString()}`,
        significance: isCritical ? "critical" : isMajor ? "major" : "minor",
      });
    }
  } else if (instrument === "XAGUSD") {
    // For silver, major levels at $1 intervals
    const base = Math.floor(currentPrice);
    
    // Add levels around current price
    for (let offset = -5; offset <= 5; offset += 1) {
      const price = base + offset;
      if (Math.abs(price - currentPrice) < 0.5) continue; // Skip if too close to current
      
      const isCritical = price % 5 === 0;
      const isMajor = !isCritical;
      
      levels.push({
        price,
        type: "psychological",
        label: `$${price.toFixed(2)}`,
        significance: isCritical ? "critical" : isMajor ? "major" : "minor",
      });
    }
  } else if (instrument.includes("JPY")) {
    const base = Math.floor(currentPrice);
    
    for (let offset = -5; offset <= 5; offset += 0.5) {
      const price = base + offset;
      if (Math.abs(price - currentPrice) < 0.1) continue;
      
      const isCritical = price % 5 === 0;
      const isMajor = price % 1 === 0 && !isCritical;
      
      levels.push({
        price,
        type: "psychological",
        label: price.toFixed(2),
        significance: isCritical ? "critical" : isMajor ? "major" : "minor",
      });
    }
  } else {
    const base = Math.floor(currentPrice * 100) / 100;
    
    for (let offset = -0.02; offset <= 0.02; offset += 0.005) {
      const price = Math.round((base + offset) * 10000) / 10000;
      if (Math.abs(price - currentPrice) < 0.0005) continue;
      
      const isCritical = Math.round(price * 100) % 1 === 0;
      const isMajor = Math.round(price * 1000) % 5 === 0 && !isCritical;
      
      levels.push({
        price,
        type: "psychological",
        label: price.toFixed(4),
        significance: isCritical ? "critical" : isMajor ? "major" : "minor",
      });
    }
  }
  
  return levels.sort((a, b) => a.price - b.price);
}

function calculateLiquidityZones(currentPrice: number, candles: Candle[], isMetal: boolean, instrument: Instrument): InstitutionalLevel[] {
  const levels: InstitutionalLevel[] = [];
  
  if (candles.length < 10) {
    // Generate mock liquidity zones based on current price
    const isJpy = instrument.includes("JPY");
    const buffer = instrument === "XAUUSD" ? 20 : isMetal ? 1.5 : isJpy ? 0.3 : 0.003;
    
    levels.push({
      price: currentPrice + buffer,
      type: "liquidity_sell",
      label: "Buy stops above",
      significance: "major",
    });
    
    levels.push({
      price: currentPrice - buffer,
      type: "liquidity_buy",
      label: "Sell stops below",
      significance: "major",
    });
    
    return levels;
  }
  
  // Find recent swing highs (liquidity for buys - stop hunts)
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  
  for (let i = 2; i < Math.min(candles.length - 2, 30); i++) {
    const isSwingHigh = candles[i].high > candles[i - 1].high && 
                        candles[i].high > candles[i - 2].high &&
                        candles[i].high > candles[i + 1].high &&
                        candles[i].high > candles[i + 2].high;
    
    const isSwingLow = candles[i].low < candles[i - 1].low && 
                       candles[i].low < candles[i - 2].low &&
                       candles[i].low < candles[i + 1].low &&
                       candles[i].low < candles[i + 2].low;
    
    if (isSwingHigh && candles[i].high > currentPrice) {
      swingHighs.push(candles[i].high);
    }
    if (isSwingLow && candles[i].low < currentPrice) {
      swingLows.push(candles[i].low);
    }
  }
  
  // Take closest swing highs/lows as liquidity zones
  swingHighs.sort((a, b) => a - b).slice(0, 2).forEach((price, i) => {
    levels.push({
      price,
      type: "liquidity_sell",
      label: `Buy stops $${isMetal ? price.toFixed(2) : price.toFixed(5)}`,
      significance: i === 0 ? "critical" : "major",
    });
  });
  
  swingLows.sort((a, b) => b - a).slice(0, 2).forEach((price, i) => {
    levels.push({
      price,
      type: "liquidity_buy",
      label: `Sell stops $${isMetal ? price.toFixed(2) : price.toFixed(5)}`,
      significance: i === 0 ? "critical" : "major",
    });
  });
  
  return levels;
}

function calculateSessionLevels(currentPrice: number, candles: Candle[], isMetal: boolean, instrument: Instrument): InstitutionalLevel[] {
  const levels: InstitutionalLevel[] = [];
  
  // Simulate session highs/lows based on recent candles or current price
  if (candles.length < 5) {
    const sessionRange = instrument === "XAUUSD" ? 25 : isMetal ? 2 : 0.004;
    
    levels.push({
      price: currentPrice + sessionRange * 0.8,
      type: "session_high",
      label: "Asian Session High",
      significance: "major",
    });
    
    levels.push({
      price: currentPrice - sessionRange * 0.6,
      type: "session_low", 
      label: "Asian Session Low",
      significance: "major",
    });
    
    levels.push({
      price: currentPrice + sessionRange * 1.2,
      type: "session_high",
      label: "London Session High",
      significance: "critical",
    });
    
    levels.push({
      price: currentPrice - sessionRange * 1.0,
      type: "session_low",
      label: "London Session Low", 
      significance: "critical",
    });
    
    return levels;
  }
  
  // Use recent candle data
  const recentCandles = candles.slice(0, 24); // Last 24 candles
  const highOfDay = Math.max(...recentCandles.map(c => c.high));
  const lowOfDay = Math.min(...recentCandles.map(c => c.low));
  
  if (highOfDay > currentPrice) {
    levels.push({
      price: highOfDay,
      type: "session_high",
      label: "Day High",
      significance: "critical",
    });
  }
  
  if (lowOfDay < currentPrice) {
    levels.push({
      price: lowOfDay,
      type: "session_low",
      label: "Day Low",
      significance: "critical",
    });
  }
  
  return levels;
}

function analyzeOrderFlow(candles: Candle[]): { bias: "bullish" | "bearish" | "neutral"; strength: number; description: string } {
  if (candles.length < 10) {
    return { bias: "neutral", strength: 50, description: "Insufficient data for order flow analysis" };
  }
  
  const recentCandles = candles.slice(0, 10);
  
  // Count bullish vs bearish candles
  let bullishCount = 0;
  let bearishCount = 0;
  let bullishVolume = 0;
  let bearishVolume = 0;
  
  recentCandles.forEach(candle => {
    const isBullish = candle.close > candle.open;
    const bodySize = Math.abs(candle.close - candle.open);
    
    if (isBullish) {
      bullishCount++;
      bullishVolume += bodySize;
    } else {
      bearishCount++;
      bearishVolume += bodySize;
    }
  });
  
  const totalVolume = bullishVolume + bearishVolume;
  const bullishRatio = totalVolume > 0 ? bullishVolume / totalVolume : 0.5;
  
  let bias: "bullish" | "bearish" | "neutral";
  let strength: number;
  let description: string;
  
  if (bullishRatio > 0.65) {
    bias = "bullish";
    strength = Math.min(90, 50 + (bullishRatio - 0.5) * 100);
    description = `Strong buying pressure detected. ${bullishCount}/10 candles bullish with ${Math.round(bullishRatio * 100)}% volume.`;
  } else if (bullishRatio < 0.35) {
    bias = "bearish";
    strength = Math.min(90, 50 + (0.5 - bullishRatio) * 100);
    description = `Strong selling pressure detected. ${bearishCount}/10 candles bearish with ${Math.round((1 - bullishRatio) * 100)}% volume.`;
  } else {
    bias = "neutral";
    strength = 50;
    description = "Mixed order flow. Institutions may be accumulating/distributing. Wait for clearer direction.";
  }
  
  return { bias, strength: Math.round(strength), description };
}

function findNextTarget(currentPrice: number, levels: InstitutionalLevel[], direction: "up" | "down"): number | undefined {
  const criticalLevels = levels.filter(l => l.significance === "critical" || l.significance === "major");
  
  if (direction === "up") {
    const aboveLevels = criticalLevels.filter(l => l.price > currentPrice).sort((a, b) => a.price - b.price);
    return aboveLevels[0]?.price;
  } else {
    const belowLevels = criticalLevels.filter(l => l.price < currentPrice).sort((a, b) => b.price - a.price);
    return belowLevels[0]?.price;
  }
}

// Multi-Timeframe Confluence Analysis
// Only take trades when multiple timeframes agree on direction
export interface MTFConfluence {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  strongConfluence: boolean;
  direction: "bullish" | "bearish" | "mixed";
  agreementPercent: number;
  timeframeDetails: { timeframe: string; direction: "up" | "down" | "sideways"; strength: number }[];
}

export function analyzeMTFConfluence(analyses: MarketAnalysis[]): MTFConfluence {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  const details: { timeframe: string; direction: "up" | "down" | "sideways"; strength: number }[] = [];
  
  for (const analysis of analyses) {
    // Weight by trend strength (stronger trends count more)
    const weight = analysis.trend.strength >= 60 ? 1 : 0.5;
    
    details.push({
      timeframe: analysis.timeframe,
      direction: analysis.trend.direction,
      strength: analysis.trend.strength,
    });
    
    if (analysis.trend.direction === "up" && analysis.trend.strength >= 50) {
      bullish += weight;
    } else if (analysis.trend.direction === "down" && analysis.trend.strength >= 50) {
      bearish += weight;
    } else {
      neutral += weight;
    }
  }
  
  const total = bullish + bearish + neutral;
  const strongConfluence = (bullish >= 2 && bearish === 0) || (bearish >= 2 && bullish === 0);
  const direction = bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : "mixed";
  const agreementPercent = total > 0 ? Math.round((Math.max(bullish, bearish) / total) * 100) : 0;
  
  return {
    bullishCount: Math.round(bullish),
    bearishCount: Math.round(bearish),
    neutralCount: Math.round(neutral),
    strongConfluence,
    direction,
    agreementPercent,
    timeframeDetails: details,
  };
}

export function generateSignal(analysis: MarketAnalysis, candles?: Candle[], mtfConfluence?: MTFConfluence): TradeSignal | null {
  if (analysis.marketState === "high_risk" || analysis.marketState === "no_trade") {
    return null;
  }

  const strategyParams = getStrategyParamsForInstrument(analysis.instrument, analysis.timeframe);

  const defaultBadTimeframes = ["1D", "1m"];
  if (defaultBadTimeframes.includes(analysis.timeframe) && !activeStrategyProfiles.has(analysis.timeframe)) {
    return null;
  }

  const isMetal = analysis.instrument === "XAUUSD" || analysis.instrument === "XAGUSD";
  const pipSize = analysis.instrument === "XAUUSD" ? 0.1 : isMetal ? 0.01 : 0.0001;
  
  let direction: TradeDirection = "stand_aside";
  let confidence = 50;
  const reasoning: string[] = [];
  let confluenceCount = 0;
  
  const shortMetalTimeframes = ["1m", "5m", "15m"];
  const isShortMetalTF = isMetal && shortMetalTimeframes.includes(analysis.timeframe);
  const effectiveMinTrendStrength = isShortMetalTF ? 50 : strategyParams.minTrendStrength;
  const strongTrend = analysis.trend.strength >= effectiveMinTrendStrength;
  const veryStrongTrend = analysis.trend.strength >= 80;
  
  const trendStateAligned = 
    (analysis.marketState === "uptrend" && analysis.trend.direction === "up") ||
    (analysis.marketState === "downtrend" && analysis.trend.direction === "down");
  
  const nearestSupport = analysis.supportLevels[0];
  const nearestResistance = analysis.resistanceLevels[0];
  const nearSupport = nearestSupport && analysis.currentPrice <= nearestSupport.price * 1.005;
  const nearResistance = nearestResistance && analysis.currentPrice >= nearestResistance.price * 0.995;
  
  let divergence: DivergenceSignal | null = null;
  if (candles && candles.length >= 35) {
    divergence = detectRSIDivergence(candles);
  }

  let orderFlowBias: "bullish" | "bearish" | "neutral" = "neutral";
  let momentumScore = 0;
  let rsiValue: number | null = null;

  if (candles && candles.length >= 10) {
    const recentCandles = candles.slice(0, 10);
    let bullishVol = 0;
    let bearishVol = 0;
    for (const c of recentCandles) {
      const bodySize = Math.abs(c.close - c.open);
      if (c.close > c.open) bullishVol += bodySize;
      else bearishVol += bodySize;
    }
    const total = bullishVol + bearishVol;
    if (total > 0) {
      const ratio = bullishVol / total;
      if (ratio > 0.62) orderFlowBias = "bullish";
      else if (ratio < 0.38) orderFlowBias = "bearish";
    }
  }

  if (candles && candles.length >= 20) {
    const recent5 = candles.slice(0, 5);
    const older5 = candles.slice(10, 15);
    const recentAvg = recent5.reduce((s, c) => s + c.close, 0) / recent5.length;
    const olderAvg = older5.reduce((s, c) => s + c.close, 0) / older5.length;
    momentumScore = ((recentAvg - olderAvg) / olderAvg) * 100;
  }

  if (candles && candles.length >= 20) {
    const closes = candles.slice(0, 20).map(c => c.close).reverse();
    const rsiValues = calculateRSI(closes);
    if (rsiValues.length > 0) rsiValue = rsiValues[rsiValues.length - 1];
  }
  
  let mtfBonus = 0;
  let mtfPenalty = 0;
  if (mtfConfluence) {
    if (mtfConfluence.strongConfluence) {
      mtfBonus = 15;
      reasoning.push(`MTF Confluence: ${mtfConfluence.agreementPercent}% agreement (${mtfConfluence.direction})`);
    } else if (mtfConfluence.agreementPercent >= 60) {
      mtfBonus = 8;
      reasoning.push(`Partial MTF alignment: ${mtfConfluence.agreementPercent}% agree`);
    } else if (mtfConfluence.direction === "mixed") {
      mtfPenalty = 10;
      reasoning.push("WARNING: Mixed MTF signals - reduced confidence");
    }
  }

  if (divergence) {
    const counterTrend = (divergence.type === "bearish" && analysis.trend.direction === "up" && strongTrend) ||
                         (divergence.type === "bullish" && analysis.trend.direction === "down" && strongTrend);
    
    if (counterTrend) {
      reasoning.push(`Divergence detected but skipped - never counter strong trends`);
    } else if (divergence.type === "bearish" && analysis.trend.direction === "down") {
      direction = "sell";
      confluenceCount += divergence.strength === "strong" ? 2 : 1;
      reasoning.push(`RSI divergence confirms downtrend (${divergence.strength})`);
      confidence += divergence.strength === "strong" ? 12 : 6;
    } else if (divergence.type === "bullish" && analysis.trend.direction === "up") {
      direction = "buy";
      confluenceCount += divergence.strength === "strong" ? 2 : 1;
      reasoning.push(`RSI divergence confirms uptrend (${divergence.strength})`);
      confidence += divergence.strength === "strong" ? 12 : 6;
    }
  }

  if (direction === "stand_aside" && trendStateAligned && strongTrend) {
    if (analysis.trend.direction === "up") {
      direction = "buy";
      confluenceCount += 2;
      reasoning.push(`Strong uptrend (${analysis.trend.strength}% strength)`);
      
      if (nearSupport) {
        confluenceCount++;
        reasoning.push("Pullback to support level - high probability entry");
        confidence += 10;
      }
      
      if (isMetal && veryStrongTrend) {
        confluenceCount++;
        reasoning.push("Metal in strong bullish momentum");
        confidence += 4;
      } else if (!isMetal && veryStrongTrend) {
        confluenceCount++;
        reasoning.push("Forex pair in strong bullish momentum");
        confidence += 3;
      }
    } else {
      direction = "sell";
      confluenceCount += 2;
      reasoning.push(`Strong downtrend (${analysis.trend.strength}% strength)`);
      
      if (nearResistance) {
        confluenceCount++;
        reasoning.push("Rejection from resistance - high probability entry");
        confidence += 10;
      }
    }
  } else if (direction === "stand_aside" && strongTrend && (analysis.trend.direction === "up" || analysis.trend.direction === "down")) {
    direction = analysis.trend.direction === "up" ? "buy" : "sell";
    confluenceCount += 1;
    reasoning.push(`Trend direction ${analysis.trend.direction} (${analysis.trend.strength}% strength)`);
  }

  if (direction === "buy" || direction === "sell") {
    if (direction === "buy" && nearestSupport && nearestSupport.strength === "strong") {
      confluenceCount++;
      confidence += 5;
      reasoning.push("Near strong support level");
    }
    if (direction === "sell" && nearestResistance && nearestResistance.strength === "strong") {
      confluenceCount++;
      confidence += 5;
      reasoning.push("Near strong resistance level");
    }

    if (orderFlowBias === "bullish" && direction === "buy") {
      confluenceCount++;
      confidence += 6;
      reasoning.push("Order flow confirms bullish bias");
    } else if (orderFlowBias === "bearish" && direction === "sell") {
      confluenceCount++;
      confidence += 6;
      reasoning.push("Order flow confirms bearish bias");
    } else if (
      (orderFlowBias === "bullish" && direction === "sell") ||
      (orderFlowBias === "bearish" && direction === "buy")
    ) {
      confluenceCount -= 1;
      confidence -= 5;
      reasoning.push("Order flow against signal direction");
    }

    const momentumAligned =
      (direction === "buy" && momentumScore > 0.1) ||
      (direction === "sell" && momentumScore < -0.1);
    if (momentumAligned) {
      confluenceCount++;
      confidence += Math.abs(momentumScore) > 0.3 ? 8 : 4;
      reasoning.push(`Momentum aligned (${momentumScore.toFixed(2)}%)`);
    }

    if (rsiValue !== null) {
      if (direction === "buy" && rsiValue < 35) {
        confluenceCount++;
        confidence += 6;
        reasoning.push(`RSI oversold (${rsiValue.toFixed(0)}) - buy opportunity`);
      } else if (direction === "sell" && rsiValue > 65) {
        confluenceCount++;
        confidence += 6;
        reasoning.push(`RSI overbought (${rsiValue.toFixed(0)}) - sell opportunity`);
      }
      if (direction === "buy" && rsiValue > 80) {
        confluenceCount -= 1;
        confidence -= 8;
        reasoning.push(`RSI extremely overbought - caution on buy`);
      } else if (direction === "sell" && rsiValue < 20) {
        confluenceCount -= 1;
        confidence -= 8;
        reasoning.push(`RSI extremely oversold - caution on sell`);
      }
    }
  }

  if (confluenceCount < strategyParams.minConfluence) {
    return null;
  }
  
  if (direction === "stand_aside") {
    return null;
  }

  confidence = 55 + (confluenceCount * 8);
  confidence += mtfBonus - mtfPenalty;
  
  if (mtfConfluence) {
    if (direction === "buy" && mtfConfluence.direction === "bearish" && mtfConfluence.agreementPercent >= 70) {
      return null;
    }
    if (direction === "sell" && mtfConfluence.direction === "bullish" && mtfConfluence.agreementPercent >= 70) {
      return null;
    }
  }
  
  if (analysis.volatility === "low") {
    confidence += 5;
    reasoning.push("Low volatility - cleaner price action");
  } else if (analysis.volatility === "high") {
    if (!isMetal) {
      confidence -= 2;
      reasoning.push("Elevated volatility - wider stops recommended");
    }
  }
  
  if (veryStrongTrend && trendStateAligned) {
    confidence += 5;
    reasoning.push("Very strong trend momentum");
  }

  const isBuy = direction === "buy";
  
  const tfMultipliers: Record<string, number> = {
    "1m": 0.4,
    "5m": 0.6,
    "15m": 0.8,
    "1h": 1.0,
    "4h": 1.5,
    "1D": 2.5,
    "1W": 4.0,
    "1M": 6.0,
  };
  const tfMult = tfMultipliers[analysis.timeframe] || 1.0;
  
  const isJPY = analysis.instrument.endsWith("JPY");
  const forexEntryBuffer = isJPY ? 0.05 : 0.0005;
  const forexBaseSlDistance = isJPY ? 0.2 : 0.002;
  const entryBuffer = (analysis.instrument === "XAUUSD" ? 2 : isMetal ? 0.2 : forexEntryBuffer) * tfMult;
  const baseSlDistance = (analysis.instrument === "XAUUSD" ? 15 : isMetal ? 1.5 : forexBaseSlDistance) * tfMult;
  const safeSlMultiplier = (strategyParams.slMultiplier && isFinite(strategyParams.slMultiplier)) ? strategyParams.slMultiplier : DEFAULT_STRATEGY_PARAMS.slMultiplier;
  const safeRrRatio = (strategyParams.rrRatio && isFinite(strategyParams.rrRatio)) ? strategyParams.rrRatio : DEFAULT_STRATEGY_PARAMS.rrRatio;
  const slDistance = baseSlDistance * safeSlMultiplier;
  const tpDistance1 = slDistance * safeRrRatio;
  const tpDistance2 = slDistance * (safeRrRatio + 1.0);

  const entryZone = {
    low: analysis.currentPrice - (isBuy ? entryBuffer : 0),
    high: analysis.currentPrice + (isBuy ? 0 : entryBuffer),
  };

  const stopLoss = isBuy 
    ? analysis.currentPrice - slDistance 
    : analysis.currentPrice + slDistance;

  const takeProfit1 = isBuy 
    ? analysis.currentPrice + tpDistance1 
    : analysis.currentPrice - tpDistance1;

  const takeProfit2 = isBuy 
    ? analysis.currentPrice + tpDistance2 
    : analysis.currentPrice - tpDistance2;

  if (isBuy && analysis.supportLevels.length > 0) {
    const nearest = analysis.supportLevels[0];
    if (nearest.price < stopLoss && nearest.price > analysis.currentPrice - slDistance * 1.5) {
      reasoning.push(`Stop loss placed below ${nearest.strength} support`);
    }
  }

  if (!isBuy && analysis.resistanceLevels.length > 0) {
    const nearest = analysis.resistanceLevels[0];
    if (nearest.price > stopLoss && nearest.price < analysis.currentPrice + slDistance * 1.5) {
      reasoning.push(`Stop loss placed above ${nearest.strength} resistance`);
    }
  }

  const riskRewardRatio = tpDistance1 / slDistance;

  if (!isFinite(takeProfit1) || !isFinite(riskRewardRatio) || !isFinite(stopLoss)) {
    console.warn(`[SignalGen] NaN detected for ${analysis.instrument} ${analysis.timeframe} — params: slMult=${strategyParams.slMultiplier}, rrRatio=${strategyParams.rrRatio}, price=${analysis.currentPrice}. Using defaults.`);
    return null;
  }

  return {
    instrument: analysis.instrument,
    timeframe: analysis.timeframe,
    direction,
    confidence: Math.round(Math.max(50, Math.min(95, confidence))),
    entryZone,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskRewardRatio,
    reasoning,
    timestamp: new Date().toISOString(),
  };
}
