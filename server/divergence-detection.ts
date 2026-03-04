interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Divergence {
  type: 'bullish' | 'bearish';
  indicator: 'RSI' | 'MACD' | 'momentum';
  strength: 'regular' | 'hidden';
  confidence: number;
  description: string;
  priceStart: number;
  priceEnd: number;
  indicatorStart: number;
  indicatorEnd: number;
}

interface SmartMoneyConcept {
  type: 'FVG' | 'liquiditySweep' | 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
  price: number;
  priceHigh?: number;
  priceLow?: number;
  confidence: number;
  description: string;
  timestamp: Date;
}

export class DivergenceDetectionService {
  
  detectDivergences(data: OHLCV[]): Divergence[] {
    const divergences: Divergence[] = [];
    
    if (data.length < 30) return divergences;

    // Calculate indicators
    const rsi = this.calculateRSI(data, 14);
    const macd = this.calculateMACD(data);
    const momentum = this.calculateMomentum(data, 10);

    // Detect RSI divergences
    const rsiDivergence = this.findDivergence(data, rsi, 'RSI');
    if (rsiDivergence) divergences.push(rsiDivergence);

    // Detect MACD divergences
    const macdDivergence = this.findDivergence(data, macd.histogram, 'MACD');
    if (macdDivergence) divergences.push(macdDivergence);

    // Detect momentum divergences
    const momDivergence = this.findDivergence(data, momentum, 'momentum');
    if (momDivergence) divergences.push(momDivergence);

    return divergences;
  }

  detectSmartMoneyConcepts(data: OHLCV[]): SmartMoneyConcept[] {
    const concepts: SmartMoneyConcept[] = [];
    
    if (data.length < 20) return concepts;

    // Detect Fair Value Gaps (FVG)
    const fvgs = this.detectFVG(data);
    concepts.push(...fvgs);

    // Detect Break of Structure (BOS)
    const bos = this.detectBOS(data);
    if (bos) concepts.push(bos);

    // Detect Change of Character (CHoCH)
    const choch = this.detectCHoCH(data);
    if (choch) concepts.push(choch);

    // Detect liquidity sweeps
    const sweeps = this.detectLiquiditySweeps(data);
    concepts.push(...sweeps);

    return concepts;
  }

  private calculateRSI(data: OHLCV[], period: number = 14): number[] {
    const rsi: number[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    for (let i = 0; i < data.length; i++) {
      if (i < period) {
        rsi.push(50); // Not enough data
        continue;
      }

      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }

    return rsi;
  }

  private calculateMACD(data: OHLCV[]): { macd: number[]; signal: number[]; histogram: number[] } {
    const closes = data.map(d => d.close);
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    
    const macd = ema12.map((v, i) => v - ema26[i]);
    const signal = this.calculateEMA(macd, 9);
    const histogram = macd.map((v, i) => v - signal[i]);

    return { macd, signal, histogram };
  }

  private calculateEMA(data: number[], period: number): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);

    for (let i = 0; i < data.length; i++) {
      if (i === 0) {
        ema.push(data[i]);
      } else {
        ema.push((data[i] - ema[i - 1]) * multiplier + ema[i - 1]);
      }
    }

    return ema;
  }

  private calculateMomentum(data: OHLCV[], period: number = 10): number[] {
    const momentum: number[] = [];
    
    for (let i = 0; i < data.length; i++) {
      if (i < period) {
        momentum.push(0);
      } else {
        momentum.push(data[i].close - data[i - period].close);
      }
    }

    return momentum;
  }

  private findDivergence(
    data: OHLCV[], 
    indicator: number[], 
    indicatorName: 'RSI' | 'MACD' | 'momentum'
  ): Divergence | null {
    if (data.length < 20 || indicator.length < 20) return null;

    const recentData = data.slice(-20);
    const recentIndicator = indicator.slice(-20);
    
    const pricePeaks = this.findPeaks(recentData.map(d => d.high));
    const priceTroughs = this.findTroughs(recentData.map(d => d.low));
    const indicatorPeaks = this.findPeaks(recentIndicator);
    const indicatorTroughs = this.findTroughs(recentIndicator);

    // Regular Bearish divergence: price makes higher high, indicator makes lower high
    if (pricePeaks.length >= 2 && indicatorPeaks.length >= 2) {
      const [pp1, pp2] = pricePeaks.slice(-2);
      const [ip1, ip2] = indicatorPeaks.slice(-2);
      
      if (recentData[pp2].high > recentData[pp1].high && 
          recentIndicator[ip2] < recentIndicator[ip1]) {
        return {
          type: 'bearish',
          indicator: indicatorName,
          strength: 'regular',
          confidence: 70,
          description: `Regular Bearish ${indicatorName} divergence: Price making higher highs while ${indicatorName} making lower highs`,
          priceStart: recentData[pp1].high,
          priceEnd: recentData[pp2].high,
          indicatorStart: recentIndicator[ip1],
          indicatorEnd: recentIndicator[ip2],
        };
      }
      
      // Hidden Bearish divergence: price makes lower high, indicator makes higher high
      if (recentData[pp2].high < recentData[pp1].high && 
          recentIndicator[ip2] > recentIndicator[ip1]) {
        return {
          type: 'bearish',
          indicator: indicatorName,
          strength: 'hidden',
          confidence: 60,
          description: `Hidden Bearish ${indicatorName} divergence: Price making lower highs while ${indicatorName} making higher highs (trend continuation)`,
          priceStart: recentData[pp1].high,
          priceEnd: recentData[pp2].high,
          indicatorStart: recentIndicator[ip1],
          indicatorEnd: recentIndicator[ip2],
        };
      }
    }

    // Regular Bullish divergence: price makes lower low, indicator makes higher low
    if (priceTroughs.length >= 2 && indicatorTroughs.length >= 2) {
      const [pt1, pt2] = priceTroughs.slice(-2);
      const [it1, it2] = indicatorTroughs.slice(-2);
      
      if (recentData[pt2].low < recentData[pt1].low && 
          recentIndicator[it2] > recentIndicator[it1]) {
        return {
          type: 'bullish',
          indicator: indicatorName,
          strength: 'regular',
          confidence: 70,
          description: `Regular Bullish ${indicatorName} divergence: Price making lower lows while ${indicatorName} making higher lows`,
          priceStart: recentData[pt1].low,
          priceEnd: recentData[pt2].low,
          indicatorStart: recentIndicator[it1],
          indicatorEnd: recentIndicator[it2],
        };
      }
      
      // Hidden Bullish divergence: price makes higher low, indicator makes lower low
      if (recentData[pt2].low > recentData[pt1].low && 
          recentIndicator[it2] < recentIndicator[it1]) {
        return {
          type: 'bullish',
          indicator: indicatorName,
          strength: 'hidden',
          confidence: 60,
          description: `Hidden Bullish ${indicatorName} divergence: Price making higher lows while ${indicatorName} making lower lows (trend continuation)`,
          priceStart: recentData[pt1].low,
          priceEnd: recentData[pt2].low,
          indicatorStart: recentIndicator[it1],
          indicatorEnd: recentIndicator[it2],
        };
      }
    }

    return null;
  }

  private detectFVG(data: OHLCV[]): SmartMoneyConcept[] {
    const fvgs: SmartMoneyConcept[] = [];
    
    for (let i = 2; i < data.length; i++) {
      const candle1 = data[i - 2];
      const candle2 = data[i - 1];
      const candle3 = data[i];

      // Bullish FVG: gap between candle 1 high and candle 3 low
      if (candle3.low > candle1.high) {
        fvgs.push({
          type: 'FVG',
          direction: 'bullish',
          price: (candle3.low + candle1.high) / 2,
          priceHigh: candle3.low,
          priceLow: candle1.high,
          confidence: 65,
          description: 'Bullish Fair Value Gap - price may return to fill',
          timestamp: candle3.timestamp,
        });
      }

      // Bearish FVG: gap between candle 1 low and candle 3 high
      if (candle3.high < candle1.low) {
        fvgs.push({
          type: 'FVG',
          direction: 'bearish',
          price: (candle1.low + candle3.high) / 2,
          priceHigh: candle1.low,
          priceLow: candle3.high,
          confidence: 65,
          description: 'Bearish Fair Value Gap - price may return to fill',
          timestamp: candle3.timestamp,
        });
      }
    }

    // Only return the most recent FVGs
    return fvgs.slice(-3);
  }

  private detectBOS(data: OHLCV[]): SmartMoneyConcept | null {
    if (data.length < 10) return null;

    const recent = data.slice(-10);
    const highs = recent.map(d => d.high);
    const lows = recent.map(d => d.low);
    
    const maxHigh = Math.max(...highs.slice(0, -1));
    const minLow = Math.min(...lows.slice(0, -1));
    const lastCandle = recent[recent.length - 1];

    // Bullish BOS: price breaks above previous swing high
    if (lastCandle.close > maxHigh) {
      return {
        type: 'BOS',
        direction: 'bullish',
        price: maxHigh,
        confidence: 75,
        description: 'Bullish Break of Structure - new higher high established',
        timestamp: lastCandle.timestamp,
      };
    }

    // Bearish BOS: price breaks below previous swing low
    if (lastCandle.close < minLow) {
      return {
        type: 'BOS',
        direction: 'bearish',
        price: minLow,
        confidence: 75,
        description: 'Bearish Break of Structure - new lower low established',
        timestamp: lastCandle.timestamp,
      };
    }

    return null;
  }

  private detectCHoCH(data: OHLCV[]): SmartMoneyConcept | null {
    if (data.length < 20) return null;

    // Determine overall trend direction
    const firstHalf = data.slice(0, data.length / 2);
    const secondHalf = data.slice(data.length / 2);
    
    const firstAvg = firstHalf.reduce((a, b) => a + b.close, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b.close, 0) / secondHalf.length;
    
    const wasBullish = secondAvg > firstAvg;
    
    // Check for trend reversal
    const recent = data.slice(-5);
    const recentTrend = recent[recent.length - 1].close - recent[0].close;
    
    const lastCandle = data[data.length - 1];

    if (wasBullish && recentTrend < 0) {
      return {
        type: 'CHoCH',
        direction: 'bearish',
        price: lastCandle.close,
        confidence: 60,
        description: 'Change of Character - potential trend reversal from bullish to bearish',
        timestamp: lastCandle.timestamp,
      };
    }

    if (!wasBullish && recentTrend > 0) {
      return {
        type: 'CHoCH',
        direction: 'bullish',
        price: lastCandle.close,
        confidence: 60,
        description: 'Change of Character - potential trend reversal from bearish to bullish',
        timestamp: lastCandle.timestamp,
      };
    }

    return null;
  }

  private detectLiquiditySweeps(data: OHLCV[]): SmartMoneyConcept[] {
    const sweeps: SmartMoneyConcept[] = [];
    
    if (data.length < 15) return sweeps;

    const recent = data.slice(-15);
    
    // Find previous swing points
    const swingHigh = Math.max(...recent.slice(0, -2).map(d => d.high));
    const swingLow = Math.min(...recent.slice(0, -2).map(d => d.low));
    
    const lastCandle = recent[recent.length - 1];
    const prevCandle = recent[recent.length - 2];

    // Bullish sweep: wick below swing low then close above
    if (lastCandle.low < swingLow && lastCandle.close > swingLow) {
      sweeps.push({
        type: 'liquiditySweep',
        direction: 'bullish',
        price: swingLow,
        confidence: 70,
        description: 'Bullish liquidity sweep - stops hunted below swing low',
        timestamp: lastCandle.timestamp,
      });
    }

    // Bearish sweep: wick above swing high then close below
    if (lastCandle.high > swingHigh && lastCandle.close < swingHigh) {
      sweeps.push({
        type: 'liquiditySweep',
        direction: 'bearish',
        price: swingHigh,
        confidence: 70,
        description: 'Bearish liquidity sweep - stops hunted above swing high',
        timestamp: lastCandle.timestamp,
      });
    }

    return sweeps;
  }

  private findPeaks(data: number[], minDistance: number = 2): number[] {
    const peaks: number[] = [];
    for (let i = minDistance; i < data.length - minDistance; i++) {
      let isPeak = true;
      for (let j = 1; j <= minDistance; j++) {
        if (data[i] <= data[i - j] || data[i] <= data[i + j]) {
          isPeak = false;
          break;
        }
      }
      if (isPeak) peaks.push(i);
    }
    return peaks;
  }

  private findTroughs(data: number[], minDistance: number = 2): number[] {
    const troughs: number[] = [];
    for (let i = minDistance; i < data.length - minDistance; i++) {
      let isTrough = true;
      for (let j = 1; j <= minDistance; j++) {
        if (data[i] >= data[i - j] || data[i] >= data[i + j]) {
          isTrough = false;
          break;
        }
      }
      if (isTrough) troughs.push(i);
    }
    return troughs;
  }
}

export const divergenceDetectionService = new DivergenceDetectionService();
