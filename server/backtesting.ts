import { analyzeMarket, generateSignal } from './analysis';
import type { Candle, Instrument, Timeframe } from '../shared/schema';

interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface BacktestSignal {
  timestamp: Date;
  type: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reason: string;
}

interface BacktestTrade {
  signal: BacktestSignal;
  exitPrice: number;
  exitTime: Date;
  pnlPips: number;
  result: 'win' | 'loss';
  holdingBars: number;
}

interface BacktestResult {
  instrument: string;
  timeframe: string;
  period: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlPips: number;
  avgWinPips: number;
  avgLossPips: number;
  profitFactor: number;
  maxDrawdownPips: number;
  bestTrade: number;
  worstTrade: number;
  trades: BacktestTrade[];
  signalAccuracy: {
    byConfidence: Record<string, { total: number; wins: number; winRate: number }>;
    byReason: Record<string, { total: number; wins: number; winRate: number }>;
  };
}

export class BacktestingEngine {
  private pipMultiplier: Record<string, number> = {
    'XAUUSD': 10,
    'XAGUSD': 100,
    'EURUSD': 10000,
    'GBPUSD': 10000,
    'USDCHF': 10000,
    'AUDUSD': 10000,
    'NZDUSD': 10000,
  };

  async runBacktest(
    instrument: string,
    timeframe: string,
    data: OHLCV[],
    signalGenerator: (data: OHLCV[], index: number) => BacktestSignal | null
  ): Promise<BacktestResult> {
    const trades: BacktestTrade[] = [];
    const multiplier = this.pipMultiplier[instrument] || 10000;
    
    // Start from index 50 to have enough history for indicators
    for (let i = 50; i < data.length - 10; i++) {
      const historicalData = data.slice(0, i + 1);
      const signal = signalGenerator(historicalData, i);
      
      if (!signal) continue;

      // Simulate trade execution
      const trade = this.executeTrade(signal, data, i, multiplier);
      if (trade) {
        trades.push(trade);
        // Skip ahead to avoid overlapping trades
        i += trade.holdingBars;
      }
    }

    return this.calculateStats(instrument, timeframe, data, trades);
  }

  private executeTrade(
    signal: BacktestSignal,
    data: OHLCV[],
    entryIndex: number,
    multiplier: number
  ): BacktestTrade | null {
    const maxBars = 50; // Maximum holding period
    
    for (let i = entryIndex + 1; i < Math.min(entryIndex + maxBars, data.length); i++) {
      const candle = data[i];
      
      if (signal.type === 'buy') {
        // Check stop loss
        if (candle.low <= signal.stopLoss) {
          const pnlPips = (signal.stopLoss - signal.entryPrice) * multiplier;
          return {
            signal,
            exitPrice: signal.stopLoss,
            exitTime: candle.timestamp,
            pnlPips,
            result: 'loss',
            holdingBars: i - entryIndex,
          };
        }
        
        // Check take profit
        if (candle.high >= signal.takeProfit) {
          const pnlPips = (signal.takeProfit - signal.entryPrice) * multiplier;
          return {
            signal,
            exitPrice: signal.takeProfit,
            exitTime: candle.timestamp,
            pnlPips,
            result: 'win',
            holdingBars: i - entryIndex,
          };
        }
      } else {
        // Sell signal
        // Check stop loss
        if (candle.high >= signal.stopLoss) {
          const pnlPips = (signal.entryPrice - signal.stopLoss) * multiplier;
          return {
            signal,
            exitPrice: signal.stopLoss,
            exitTime: candle.timestamp,
            pnlPips,
            result: 'loss',
            holdingBars: i - entryIndex,
          };
        }
        
        // Check take profit
        if (candle.low <= signal.takeProfit) {
          const pnlPips = (signal.entryPrice - signal.takeProfit) * multiplier;
          return {
            signal,
            exitPrice: signal.takeProfit,
            exitTime: candle.timestamp,
            pnlPips,
            result: 'win',
            holdingBars: i - entryIndex,
          };
        }
      }
    }

    // Trade expired - exit at current price
    const exitCandle = data[Math.min(entryIndex + maxBars, data.length - 1)];
    const exitPrice = exitCandle.close;
    const pnlPips = signal.type === 'buy'
      ? (exitPrice - signal.entryPrice) * multiplier
      : (signal.entryPrice - exitPrice) * multiplier;

    return {
      signal,
      exitPrice,
      exitTime: exitCandle.timestamp,
      pnlPips,
      result: pnlPips > 0 ? 'win' : 'loss',
      holdingBars: Math.min(maxBars, data.length - 1 - entryIndex),
    };
  }

  private calculateStats(
    instrument: string,
    timeframe: string,
    data: OHLCV[],
    trades: BacktestTrade[]
  ): BacktestResult {
    const wins = trades.filter(t => t.result === 'win');
    const losses = trades.filter(t => t.result === 'loss');
    
    const totalPnlPips = trades.reduce((sum, t) => sum + t.pnlPips, 0);
    const avgWinPips = wins.length > 0 
      ? wins.reduce((sum, t) => sum + t.pnlPips, 0) / wins.length 
      : 0;
    const avgLossPips = losses.length > 0 
      ? Math.abs(losses.reduce((sum, t) => sum + t.pnlPips, 0) / losses.length)
      : 0;

    const grossProfit = wins.reduce((sum, t) => sum + t.pnlPips, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlPips, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Calculate max drawdown
    let runningPnl = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const trade of trades) {
      runningPnl += trade.pnlPips;
      if (runningPnl > peak) peak = runningPnl;
      const drawdown = peak - runningPnl;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Accuracy by confidence level
    const byConfidence: Record<string, { total: number; wins: number; winRate: number }> = {};
    const confidenceBuckets = ['low', 'medium', 'high'];
    
    for (const trade of trades) {
      const bucket = trade.signal.confidence < 50 ? 'low' 
        : trade.signal.confidence < 70 ? 'medium' 
        : 'high';
      
      if (!byConfidence[bucket]) {
        byConfidence[bucket] = { total: 0, wins: 0, winRate: 0 };
      }
      byConfidence[bucket].total++;
      if (trade.result === 'win') byConfidence[bucket].wins++;
    }
    
    for (const bucket of Object.keys(byConfidence)) {
      byConfidence[bucket].winRate = byConfidence[bucket].total > 0
        ? (byConfidence[bucket].wins / byConfidence[bucket].total) * 100
        : 0;
    }

    // Accuracy by signal reason
    const byReason: Record<string, { total: number; wins: number; winRate: number }> = {};
    for (const trade of trades) {
      const reason = trade.signal.reason;
      if (!byReason[reason]) {
        byReason[reason] = { total: 0, wins: 0, winRate: 0 };
      }
      byReason[reason].total++;
      if (trade.result === 'win') byReason[reason].wins++;
    }
    
    for (const reason of Object.keys(byReason)) {
      byReason[reason].winRate = byReason[reason].total > 0
        ? (byReason[reason].wins / byReason[reason].total) * 100
        : 0;
    }

    const period = data.length > 0 
      ? `${data[0].timestamp.toISOString().split('T')[0]} to ${data[data.length - 1].timestamp.toISOString().split('T')[0]}`
      : 'Unknown';

    return {
      instrument,
      timeframe,
      period,
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      totalPnlPips: Math.round(totalPnlPips * 10) / 10,
      avgWinPips: Math.round(avgWinPips * 10) / 10,
      avgLossPips: Math.round(avgLossPips * 10) / 10,
      profitFactor: Math.round(profitFactor * 100) / 100,
      maxDrawdownPips: Math.round(maxDrawdown * 10) / 10,
      bestTrade: trades.length > 0 ? Math.round(Math.max(...trades.map(t => t.pnlPips)) * 10) / 10 : 0,
      worstTrade: trades.length > 0 ? Math.round(Math.min(...trades.map(t => t.pnlPips)) * 10) / 10 : 0,
      trades,
      signalAccuracy: {
        byConfidence,
        byReason,
      },
    };
  }

  // Real signal generator using actual production strategy
  createDefaultSignalGenerator(instrument: string, timeframe: string = '1h') {
    return (data: OHLCV[], index: number): BacktestSignal | null => {
      if (index < 50) return null; // Need enough data for analysis

      // Convert OHLCV to Candle format for analyzeMarket
      const recent = data.slice(Math.max(0, index - 100), index + 1);
      const candles: Candle[] = recent.map(d => ({
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        timestamp: d.timestamp.toISOString(),
        volume: 0,
      }));

      const current = data[index];
      
      // Use the REAL production analysis and signal generation
      const analysis = analyzeMarket(
        instrument as Instrument, 
        timeframe as Timeframe, 
        candles, 
        current.close
      );
      
      const signal = generateSignal(analysis);
      
      if (!signal || signal.direction === 'stand_aside') {
        return null;
      }

      return {
        timestamp: current.timestamp,
        type: signal.direction as 'buy' | 'sell',
        entryPrice: (signal.entryZone.low + signal.entryZone.high) / 2,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit1,
        confidence: signal.confidence,
        reason: signal.reasoning.slice(0, 3).join(', '),
      };
    };
  }

  private calculateATR(data: OHLCV[], period: number = 14): number {
    if (data.length < period + 1) return 0;

    const trueRanges: number[] = [];
    for (let i = 1; i < data.length; i++) {
      const high = data[i].high;
      const low = data[i].low;
      const prevClose = data[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((a, b) => a + b, 0) / recentTR.length;
  }
}

export const backtestingEngine = new BacktestingEngine();
